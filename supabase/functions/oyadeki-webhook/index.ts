import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { verifySignature } from "../_shared/line-signature.ts";
import { isDuplicate } from "../_shared/dedup.ts";
import { logUsage, getUserContext, UserContext } from "../_shared/supabase-client.ts";
import { generateText, analyzeImage, extractLedgerInfo, LedgerItem } from "../_shared/gemini-client.ts";
import { getSupabaseClient } from "../_shared/supabase-client.ts";

const LINE_API_BASE = "https://api.line.me/v2/bot";
const LINE_DATA_API_BASE = "https://api-data.line.me/v2/bot";
const TIMEOUT_MS = 3000;

interface LineEvent {
  type: string;
  replyToken?: string;
  source: {
    type: "user" | "group" | "room";
    userId: string;
    groupId?: string;
    roomId?: string;
  };
  message?: {
    type: string;
    id: string;
    text?: string;
  };
}

interface LineWebhookBody {
  events: LineEvent[];
}

/**
 * LINE Messaging APIで返信
 */
async function replyMessage(replyToken: string, messages: unknown[]) {
  const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
  await fetch(`${LINE_API_BASE}/message/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}

/**
 * タイムアウトフォールバック用テンプレート返信
 */
async function replyWithFallback(replyToken: string) {
  await replyMessage(replyToken, [
    {
      type: "text",
      text: "少々お待ちください...（考え中）",
    },
  ]);
}

/**
 * 安全退避用メッセージ（エラー時）
 */
async function replyWithSafeFallback(replyToken: string) {
  await replyMessage(replyToken, [
    {
      type: "text",
      text: "⚠️ すみません、うまく考えられませんでした（ハーフタイム）。\n\nもう一度送ってもらうか、緊急の場合はお子さんに直接電話してみてください！",
    },
  ]);
}

/**
 * 下書き生成プロンプト（ユーザー設定反映）
 */
function buildDraftPrompt(userText: string, context: UserContext | null): string {
  // トーン設定
  const toneMap: Record<string, string> = {
    polite: "丁寧語で",
    casual: "親しみやすい話し言葉で（です・ます調は崩さずに）",
    warm: "実家の親と話すような温かい言葉で",
  };
  const toneInstruction = context?.tone ? toneMap[context.tone] || "温かい言葉で" : "温かい言葉で";

  // メタファー設定
  let metaphorInstruction = "- メタファーは使わない";
  if (context?.metaphor_enabled && context?.metaphor_theme) {
    metaphorInstruction = `- 「${context.metaphor_theme}」に関連したメタファーを1つだけ使う`;
  }

  // NG語設定
  let ngInstruction = "";
  if (context?.disliked_phrases && context.disliked_phrases.length > 0) {
    ngInstruction = `- 以下の言葉は絶対に使わない: ${context.disliked_phrases.join("、")}`;
  }

  return `あなたは親子コミュニケーションを支援するアシスタントです。
以下のメッセージに対して、親が子どもに送る返信の下書きを3案作成してください。

【ルール】
- 各案は80字以内

- ${toneInstruction}書く
- 基本的に「〜だね！」「〜だよ」のような親しみやすい語尾を使う（冷たいロボット口調はNG）
- 文頭に【AI下書き】をつけない（後で追加します）
- 代理送信ではなく「こう書いたらどうですか？」という提案
${metaphorInstruction}
${ngInstruction ? ngInstruction + "\n" : ""}- 最後に1つ「開かれた質問」を提案
- 最後に通話誘導文を1つ追加

【メッセージ】
${userText}

【出力形式】
A: (80字以内の返信案)
B: (80字以内の返信案)
C: (80字以内の返信案)
質問: (相手の話を広げる質問)
通話: (通話を促す一言)`;
}

/**
 * Flex Messageで下書きカードを生成
 */
function buildDraftFlexMessage(
  draftA: string,
  draftB: string,
  draftC: string,
  question: string,
  callSuggest: string,
  draftId: string
) {
  return {
    type: "flex",
    altText: "下書き提案",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "【AI下書き】", weight: "bold", size: "sm", color: "#888888" },
          { type: "text", text: `A: ${draftA}`, wrap: true, size: "sm" },
          { type: "text", text: `B: ${draftB}`, wrap: true, size: "sm" },
          { type: "text", text: `C: ${draftC}`, wrap: true, size: "sm" },
          { type: "separator", margin: "md" },
          { type: "text", text: `💬 ${question}`, wrap: true, size: "sm", color: "#666666" },
          { type: "text", text: `📞 ${callSuggest}`, wrap: true, size: "sm", color: "#666666" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "button",
                style: "primary",
                height: "sm",
                action: { type: "postback", label: "Aをコピー", data: `copy=${draftId}&choice=A` },
              },
              {
                type: "button",
                style: "primary",
                height: "sm",
                action: { type: "postback", label: "Bをコピー", data: `copy=${draftId}&choice=B` },
              },
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "button",
                style: "primary",
                height: "sm",
                action: { type: "postback", label: "Cをコピー", data: `copy=${draftId}&choice=C` },
              },
              {
                type: "button",
                style: "secondary",
                height: "sm",
                action: { type: "postback", label: "自分で書く", data: `copy=${draftId}&choice=self` },
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * Geminiレスポンスをパース
 */
function parseDraftResponse(text: string): {
  draftA: string;
  draftB: string;
  draftC: string;
  question: string;
  callSuggest: string;
} {
  const lines = text.split("\n").filter((l) => l.trim());
  let draftA = "",
    draftB = "",
    draftC = "",
    question = "",
    callSuggest = "";

  for (const line of lines) {
    if (line.startsWith("A:")) draftA = line.slice(2).trim();
    else if (line.startsWith("B:")) draftB = line.slice(2).trim();
    else if (line.startsWith("C:")) draftC = line.slice(2).trim();
    else if (line.startsWith("質問:")) question = line.slice(3).trim();
    else if (line.startsWith("通話:")) callSuggest = line.slice(3).trim();
  }

  return { draftA, draftB, draftC, question, callSuggest };
}

/**
 * LINE APIから画像を取得してBase64変換
 */
async function getImageContent(messageId: string): Promise<{ base64: string; mimeType: string }> {
  const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
  const response = await fetch(`${LINE_DATA_API_BASE}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const contentType = response.headers.get("Content-Type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();

  // 大きい画像に対応したBase64エンコード
  const uint8Array = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 = btoa(binary);

  return { base64, mimeType: contentType };
}

/**
 * 救急箱Vision用プロンプト（メタファー対応）
 */
function buildVisionPrompt(context: UserContext | null): string {
  // メタファー設定
  let metaphorStyle = "";
  // デフォルトでソフトなサッカーメタファー（ツェーゲン金沢風）を少し混ぜる
  const defaultMetaphor = `
【キャラクター設定：ツェーゲン金沢サポーター】
語尾や雰囲気に少しだけ活気を持たせる。
- 危険な時（詐欺警告）：「レッドカード！」「一発退場！」
- 注意が必要な時：「イエローカード！気をつけて」
- 何かをする時：「キックオフ！」「ハーフタイム（休憩）」
- 成功/安全：「ナイスゴール！」「VAR判定の結果、セーフです」
`;

  if (context?.metaphor_enabled && context?.metaphor_theme) {
    const theme = context.metaphor_theme;
    if (theme.includes("相撲") || theme.includes("大相撲")) {
      metaphorStyle = `
【例え話スタイル：大相撲】
- 詐欺警告時は「これは待ったなしの危険な立ち合いです！」「土俵際で踏ん張って！無視してOK」
- 安心な時は「この画面は横綱級に安全です」「まわしを取られていません、大丈夫」
- 操作説明時は「まずは仕切り直し（×ボタンを押す）」のような表現`;
    } else if (theme.includes("サッカー") || theme.includes("ツェーゲン")) {
      // Explicitly set, use stronger version if needed, but default is already soccer-ish
      metaphorStyle = defaultMetaphor;
    } else {
      metaphorStyle = `
【例え話スタイル】
「${theme}」に関連した親しみやすい例えを1つ使ってください。`;
    }
  } else {
    // Default to mild soccer flavor if no specific metaphor is set, or mix it in
    metaphorStyle = defaultMetaphor;
  }

  return `あなたは「オヤデキ」というスマホ操作を助ける温かいアシスタントです。
親御さん（60代以上）が送ってきた画面を見て、何が起きているかわかりやすく説明してください。
**冷たい言い方は絶対NG。友達のように温かく、でも簡潔に。**

【最優先ルール：詐欺・危険の検知】
以下のパターンを見つけたら「警告」に記載してください：
- 「ウイルスに感染しました」「今すぐ電話してください」→ 詐欺確定（レッドカード！）
- 見知らぬ番号への発信を促すポップアップ → 詐欺（オフサイド！）
- 「当選しました」「懸賞に当たりました」→ フィッシング詐欺（シミュレーション！）
- 個人情報やクレジットカード番号の入力要求 → 要注意（VAR判定！）
→ 詐欺の場合は「レッドカードです！無視して×で閉じれば試合続行できます！」と明るく安心させる
（「エラーです」などの冷たい機械的な言葉は禁止。「ハーフタイム（一時的な不具合）」などと言い換える）

【アプリ更新・パスワード要求・SMS認証について】
- 「アップデートしてください」→ 「更新ボタンを押せばOK！」と促す
- パスワード入力画面 → 「お子さんにメモを見せてもらうか、聞いてみましょう（パス出し！）」と通話誘導
- 「認証コード」「SMS」→ 「ショートメッセージ（SMS）のアプリを見て数字を入れてみて！」と案内


【テレビ・動画画面の場合】
番組名や出演者がわかれば「おっ！〇〇の△△さんですね！ナイスプレー！」とサポーターのように共感する。
（例：大河ドラマなら「光る君へですね！吉高由里子さん、ナイス演技！」など）
操作方法を聞かれていなければ、手順は「-」でOK。

【操作説明ルール】
- 手順は最大3ステップ。シンプルに
- 4ステップ以上必要なら「お子さんに電話で聞いてみましょう！」
- ボタンの色や位置を具体的に（「右上の青いボタン」など）
- 専門用語は使わない（「タップ」→「押す」など）
${metaphorStyle}

【出力形式】
警告: (詐欺・危険があれば記載、なければ「なし」)
状況: (画面から読み取れる状況を1文で、温かく)
手順1: (最初にやること、不要なら「-」)
手順2: (次にやること、不要なら「-」)
手順3: (その次、不要なら「-」)
通話誘導: (複雑な場合のアドバイス、簡単なら「-」)`;
}

/**
 * Visionレスポンスをパース
 */
function parseVisionResponse(text: string): {
  warning: string;
  situation: string;
  step1: string;
  step2: string;
  step3: string;
  callAdvice: string;
} {
  const lines = text.split("\n").filter((l) => l.trim());
  let warning = "なし",
    situation = "",
    step1 = "",
    step2 = "",
    step3 = "",
    callAdvice = "";

  for (const line of lines) {
    if (line.startsWith("警告:")) warning = line.slice(3).trim();
    else if (line.startsWith("状況:")) situation = line.slice(3).trim();
    else if (line.startsWith("手順1:")) step1 = line.slice(4).trim();
    else if (line.startsWith("手順2:")) step2 = line.slice(4).trim();
    else if (line.startsWith("手順3:")) step3 = line.slice(4).trim();
    else if (line.startsWith("通話誘導:")) callAdvice = line.slice(5).trim();
  }

  return { warning, situation, step1, step2, step3, callAdvice };
}

/**
 * Vision結果用Flex Message
 */
function buildVisionFlexMessage(
  warning: string,
  situation: string,
  step1: string,
  step2: string,
  step3: string,
  callAdvice: string,
  helpId: string,
  messageId: string // 追加
) {
  const hasWarning = warning && warning !== "なし" && warning !== "-";
  const contents: unknown[] = [];

  // 警告がある場合は目立たせる
  if (hasWarning) {
    contents.push({
      type: "box",
      layout: "vertical",
      backgroundColor: "#FFE0E0",
      cornerRadius: "md",
      paddingAll: "md",
      contents: [
        { type: "text", text: "⚠️ 警告", weight: "bold", size: "md", color: "#CC0000" },
        { type: "text", text: warning, wrap: true, size: "sm", color: "#CC0000" },
      ],
    });
    contents.push({ type: "separator", margin: "md" });
  }

  // 状況説明
  contents.push({ type: "text", text: "📱 " + situation, wrap: true, size: "sm", margin: "md" });
  contents.push({ type: "separator", margin: "md" });

  // 手順
  contents.push({ type: "text", text: "【やること】", weight: "bold", size: "sm", margin: "md" });
  if (step1 && step1 !== "-") {
    contents.push({ type: "text", text: `1️⃣ ${step1}`, wrap: true, size: "sm" });
  }
  if (step2 && step2 !== "-") {
    contents.push({ type: "text", text: `2️⃣ ${step2}`, wrap: true, size: "sm" });
  }
  if (step3 && step3 !== "-") {
    contents.push({ type: "text", text: `3️⃣ ${step3}`, wrap: true, size: "sm" });
  }

  // 通話誘導
  if (callAdvice && callAdvice !== "-") {
    contents.push({ type: "separator", margin: "md" });
    contents.push({ type: "text", text: `📞 ${callAdvice}`, wrap: true, size: "sm", color: "#666666", margin: "md" });
  }

  // 契約台帳への登録ボタン（常に表示してみる、または状況から判定してもよい）
  // messageIdが必要だが、ここには渡されていない。
  // 引数に追加する必要があるが、影響範囲が大きいので、Postbackのdataに仕込むのは諦め、
  // visionId (helpId) をキーにして再度画像を取りに行くか、
  // あるいはこのFlex Messageの呼び出し元でmessageIdをdataに入れる。
  // ここでは helpId を渡しているので、呼び出し側で helpId と messageId を紐付けるDB保存等はしていないため、
  // シンプルに messageId を引数に追加する修正を行う。

  return {
    type: "flex",
    altText: hasWarning ? "⚠️ 警告があります" : "救急箱からの回答",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents,
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "button",
                style: "primary",
                height: "sm",
                action: { type: "postback", label: "わかった！", data: `vision=${helpId}&result=understood` },
              },
              {
                type: "button",
                style: "secondary",
                height: "sm",
                action: { type: "postback", label: "電話で聞く", data: `vision=${helpId}&result=call` },
              },
            ],
          },
          {
            type: "button",
            style: "link",
            height: "sm",
            action: { type: "postback", label: "📑 これを台帳に登録", data: `action=propose_ledger&msgId=${messageId}` },
            margin: "sm"
          }
        ],
      },
    },
  };
}

/**
 * 台帳登録確認用Flex Message
 */
function buildLedgerConfirmFlexMessage(items: LedgerItem[], messageId: string) {
  if (items.length === 0) {
    return {
      type: "text",
      text: "契約情報は読み取れませんでした。別の画像で試してください。"
    };
  }

  const bubbles = items.map((item, index) => {
    return {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "📝 台帳登録案", weight: "bold", color: "#1DB446", size: "xs" },
          { type: "text", text: item.service_name, weight: "bold", size: "xl", margin: "md", wrap: true },
          {
            type: "box", layout: "vertical", margin: "md", spacing: "sm",
            contents: [
              { type: "text", text: `種類: ${item.category}`, size: "sm", color: "#666666" },
              { type: "text", text: `月額: ${item.monthly_cost ? "¥" + item.monthly_cost.toLocaleString() : "不明"}`, size: "sm", color: "#666666" },
              { type: "text", text: `ID等: ${item.account_identifier || "-"}`, size: "sm", color: "#666666", wrap: true },
              { type: "text", text: `メモ: ${item.note || "-"}`, size: "sm", color: "#666666", wrap: true },
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "postback",
              label: "この内容で登録",
              data: `action=register_ledger&msg=${messageId}&idx=${index}&svc=${encodeURIComponent(item.service_name.substring(0, 20))}&cat=${item.category}&cst=${item.monthly_cost || 0}`
            }
          }
        ]
      }
    };
  });

  return {
    type: "flex",
    altText: "台帳登録の確認",
    contents: {
      type: "carousel",
      contents: bubbles
    }
  };
}



/**
 * 台帳一覧用Flex Message
 */
function buildLedgerListFlexMessage(items: any[]) {
  // アイテム数が多い場合は先頭10件に制限 (カルーセル上限)
  const displayItems = items.slice(0, 10);

  const bubbles = displayItems.map((item) => {
    return {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "📑", size: "md" },
              { type: "text", text: item.category || "その他", size: "xs", color: "#888888", margin: "sm", offsetBottom: "2px" }
            ],
            alignItems: "center"
          },
          { type: "text", text: item.service_name, weight: "bold", size: "xl", margin: "sm", wrap: true },
          {
            type: "box", layout: "vertical", margin: "md", spacing: "sm",
            contents: [
              {
                type: "box", layout: "horizontal",
                contents: [
                  { type: "text", text: "月額", size: "sm", color: "#888888", flex: 2 },
                  { type: "text", text: item.monthly_cost ? `¥${item.monthly_cost.toLocaleString()}` : "不明", size: "sm", align: "end", flex: 5 }
                ]
              },
              {
                type: "box", layout: "horizontal",
                contents: [
                  { type: "text", text: "ID等", size: "sm", color: "#888888", flex: 2 },
                  { type: "text", text: item.account_identifier || "-", size: "sm", align: "end", flex: 5, wrap: true }
                ]
              },
              {
                type: "box", layout: "horizontal",
                contents: [
                  { type: "text", text: "メモ", size: "sm", color: "#888888", flex: 2 },
                  { type: "text", text: item.note || "-", size: "sm", align: "end", flex: 5, wrap: true }
                ]
              },
            ]
          }
        ]
      },
      styles: {
        footer: { separator: true }
      }
    };
  });

  return {
    type: "flex",
    altText: "契約台帳リスト",
    contents: {
      type: "carousel",
      contents: bubbles
    }
  };
}

/**
 * メッセージイベント処理
 */
async function handleMessageEvent(event: LineEvent) {
  const userId = event.source.userId;
  const replyToken = event.replyToken!;
  const message = event.message!;
  const sourceType = event.source.type;

  console.log("handleMessageEvent called:", { userId, messageType: message.type, sourceType });

  // グループ/ルームでの静音設定
  // 画像は常に反応、テキストは「呼びかけ」のみ反応
  if ((sourceType === "group" || sourceType === "room") && message.type === "text") {
    const text = message.text?.toLowerCase() || "";
    const keywords = ["オヤデキ", "おやでき", "使い方", "ヘルプ", "help", "台帳"];
    const isCalled = keywords.some(k => text.includes(k));

    if (!isCalled) {
      console.log("Group message ignored (no keyword match)");
      return;
    }
  }

  try {
    if (message.type === "text" && message.text) {
      console.log("Processing text message:", message.text);

      // 特殊コマンド処理
      const lowerText = message.text.toLowerCase().trim();

      // 台帳閲覧
      if (lowerText === "台帳" || lowerText === "契約台帳" || lowerText.includes("ledger")) {
        console.log("Fetching ledger for user:", userId);
        const supabase = getSupabaseClient();

        // ユーザーIDに紐づく台帳を取得
        const { data: items, error } = await supabase
          .from("ledgers")
          .select("*")
          .eq("line_user_id", userId) // LINEユーザーIDで検索 (もし共有機能でグループID等を使う場合は調整が必要)
          .eq("status", "active")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Ledger fetch error:", error);
          await replyMessage(replyToken, [{ type: "text", text: "エラーが発生しました。時間をおいて試してください。" }]);
          return;
        }

        if (!items || items.length === 0) {
          await replyMessage(replyToken, [{
            type: "text",
            text: "📭 台帳はまだ空です。\n\n契約書や請求書の写真を送って、「台帳に登録」ボタンを押すと追加できますよ！"
          }]);
          return;
        }

        await logUsage(userId, "ledger_list", { count: items.length });

        // グループの場合はサマリーのみ
        if (sourceType === "group" || sourceType === "room") {
          const total = items.reduce((sum: number, item: any) => sum + (item.monthly_cost || 0), 0);
          const serviceList = items.map((i: any) => `- ${i.service_name} (${i.monthly_cost ? "¥" + i.monthly_cost.toLocaleString() : "不明"})`).join("\n");

          await replyMessage(replyToken, [{
            type: "text",
            text: `📑 **契約台帳サマリー**\n\n登録件数: ${items.length}件\n月額合計: 約¥${total.toLocaleString()}\n\n${serviceList}\n\n※詳細は個人のトーク画面で「台帳」と打つと確認できます。`
          }]);
        } else {
          // 個人チャットは詳細カルーセル
          await replyMessage(replyToken, [buildLedgerListFlexMessage(items)]);
        }
        return;
      }

      // 使い方
      if (lowerText === "使い方" || lowerText === "ヘルプ" || lowerText === "help") {
        await replyMessage(replyToken, [
          {
            type: "text",
            text: "⚽️ オヤデキの使い方 ⚽️\n\n" +
              "【困った時（VAR判定）】\n📷 スマホ画面のスクショを送ってね！\n→ 詐欺かどうか／操作方法を解説するよ！\n\n" +
              "【返信に困った時（パス出し）】\n💬 子どもからのLINEをコピペして送ってね！\n→ ナイスな返信を3つ提案するよ\n\n" +
              "【作戦会議】\n⚙️ 下のメニューから「設定」や「台帳」が見れるよ",
          },
        ]);
        return;
      }

      // 挨拶への応答
      if (/^(こんにちは|こんばんは|おはよう|ありがとう|はじめまして|よろしく)/i.test(lowerText)) {
        await replyMessage(replyToken, [
          {
            type: "text",
            text: "こんにちは！オヤデキです😊\n\n" +
              "スマホで困ったことがあれば、\n📷 画面のスクショを送ってね！\n\n" +
              "お子さんへの返信で悩んだら、\n💬 メッセージをそのまま送ってね！",
          },
        ]);
        return;
      }

      const startTime = Date.now();
      const draftId = crypto.randomUUID();

      try {
        // ユーザー設定を取得
        const userContext = await getUserContext(userId);
        console.log("User context:", userContext ? "found" : "not found");

        const prompt = buildDraftPrompt(message.text, userContext);
        console.log("Calling Gemini API...");
        const response = await generateText(prompt);
        console.log("Gemini response received");

        const latencyMs = Date.now() - startTime;
        const parsed = parseDraftResponse(response);
        console.log("Parsed response:", parsed);

        await replyMessage(replyToken, [
          buildDraftFlexMessage(
            parsed.draftA,
            parsed.draftB,
            parsed.draftC,
            parsed.question,
            parsed.callSuggest,
            draftId
          ),
        ]);
        console.log("Draft message sent, latency:", latencyMs, "ms");

        // usage_logsにログ記録
        await logUsage(userId, "draft_gen", {
          draft_id: draftId,
          latency_ms: latencyMs,
          input_length: message.text.length,
        });

      } catch (error) {
        console.error("Error generating draft:", error);
        await replyWithSafeFallback(replyToken);
        // Reply sent, now try to log
        try {
          await logUsage(userId, "error", { error: String(error), context: "draft_gen" });
        } catch (logError) {
          console.error("Failed to log error:", logError);
        }
      }
    } else if (message.type === "image") {
      console.log("Processing image message:", message.id);

      const startTime = Date.now();
      const helpId = crypto.randomUUID();

      try {
        // ユーザー設定を取得
        const userContext = await getUserContext(userId);

        // 画像を取得
        console.log("Fetching image from LINE...");
        const { base64, mimeType } = await getImageContent(message.id);
        console.log("Image fetched, size:", base64.length, "mimeType:", mimeType);

        // Vision解析
        const prompt = buildVisionPrompt(userContext);
        console.log("Calling Gemini Vision API...");
        const response = await analyzeImage(base64, mimeType, prompt);
        console.log("Vision response received");

        const latencyMs = Date.now() - startTime;
        const parsed = parseVisionResponse(response);
        console.log("Parsed vision response:", parsed);

        // Flex Messageで返信
        // msgIdをPostbackに埋め込むために引数追加
        await replyMessage(replyToken, [
          buildVisionFlexMessage(
            parsed.warning,
            parsed.situation,
            parsed.step1,
            parsed.step2,
            parsed.step3,
            parsed.callAdvice,
            helpId,
            message.id // 追加
          ),
        ]);
        console.log("Vision message sent, latency:", latencyMs, "ms");

        // usage_logsにログ記録
        await logUsage(userId, "vision_help", {
          help_id: helpId,
          latency_ms: latencyMs,
          has_warning: parsed.warning !== "なし" && parsed.warning !== "-",
        });

      } catch (error) {
        console.error("Error processing image:", error);
        await replyWithSafeFallback(replyToken);
        // Reply sent, now try to log
        try {
          await logUsage(userId, "error", { error: String(error), context: "vision_help" });
        } catch (logError) {
          console.error("Failed to log error:", logError);
        }
      }
    }
  } catch (error) {
    console.error("handleMessageEvent error:", error);
  }
}

/**
 * Postbackイベント処理（コピーボタン・Vision結果）
 */
async function handlePostbackEvent(event: LineEvent & { postback?: { data: string } }) {
  const userId = event.source.userId;
  const data = event.postback?.data ?? "";
  const params = new URLSearchParams(data);

  // 下書きコピー処理
  const draftId = params.get("copy");
  const choice = params.get("choice");
  if (draftId && choice) {
    await logUsage(userId, "draft_gen_copy", {
      draft_id: draftId,
      copy: choice !== "self",
      choice,
    });

    if (event.replyToken) {
      const message =
        choice === "self"
          ? "自分の言葉で書くの、いいですね！"
          : `${choice}をコピーしました。LINEに貼り付けて送ってみてください。`;
      await replyMessage(event.replyToken, [{ type: "text", text: message }]);
    }
    return;
  }

  // Vision結果処理
  const visionId = params.get("vision");
  const result = params.get("result");
  if (visionId && result) {
    await logUsage(userId, "vision_help_feedback", {
      help_id: visionId,
      result,
    });

    if (event.replyToken) {
      const message =
        result === "understood"
          ? "よかったです！また困ったことがあれば、画像を送ってくださいね。"
          : "お子さんに電話してみてください。きっと助けてくれますよ！";
      await replyMessage(event.replyToken, [{ type: "text", text: message }]);
    }
    return;
  }

  // 台帳登録提案 (action=propose_ledger)
  const action = params.get("action");
  if (action === "propose_ledger") {
    const messageId = params.get("msgId");
    if (!messageId) {
      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "エラー：画像のIDが見つかりません。" }]);
      return;
    }

    try {
      // 画像再取得
      const { base64, mimeType } = await getImageContent(messageId);
      // 抽出 (Gemini 2.0 Flash)
      const items = await extractLedgerInfo("", base64, mimeType);

      await logUsage(userId, "ledger_propose", { count: items.length });

      // 確認メッセージ送信
      const flex = buildLedgerConfirmFlexMessage(items, messageId);
      // @ts-ignore: flex message format
      if (event.replyToken) await replyMessage(event.replyToken, [flex]);

    } catch (e) {
      console.error(e);
      if (event.replyToken) await replyWithSafeFallback(event.replyToken);
    }
    return;
  }

  // 台帳登録確定 (action=register_ledger)
  if (action === "register_ledger") {
    const serviceName = decodeURIComponent(params.get("svc") || "");
    const category = params.get("cat") || "other";
    const cost = parseInt(params.get("cst") || "0");

    const supabase = getSupabaseClient();
    const { data: userCtx } = await supabase.from("user_contexts").select("user_id").eq("line_user_id", userId).single();

    if (userCtx) {
      await supabase.from("ledgers").insert({
        user_id: userCtx.user_id,
        line_user_id: userId,
        service_name: serviceName,
        category,
        monthly_cost: cost,
        status: 'active'
      });

      await logUsage(userId, "ledger_confirm", { service: serviceName });
      // 成功メッセージ
      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: `「${serviceName}」を台帳に登録しました！✅\n\n後でお子さんが確認してくれます。` }]);
    } else {
      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "ユーザー登録が見つかりません。設定画面から登録してください。" }]);
    }
    return;
  }
}



serve(async (req) => {
  console.log("Webhook function started");

  // CORS対応
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET");
    const signature = req.headers.get("x-line-signature") ?? "";
    const body = await req.text();

    console.log("Request received, body length:", body.length);

    // シークレットが設定されていない場合
    if (!channelSecret) {
      console.error("LINE_CHANNEL_SECRET is not set");
      return new Response("Server configuration error", { status: 500 });
    }

    // 署名検証
    const isValid = await verifySignature(body, signature, channelSecret);
    if (!isValid) {
      console.error("Invalid signature");
      return new Response("Invalid signature", { status: 401 });
    }

    console.log("Signature verified, parsing body");
    const webhookBody: LineWebhookBody = JSON.parse(body);

    // イベントがない場合（検証リクエスト）は即座に200を返す
    if (webhookBody.events.length === 0) {
      console.log("Verification request - returning 200");
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const event of webhookBody.events) {
      // 重複排除
      const eventId = `${event.source.userId}-${Date.now()}`;
      if (isDuplicate(eventId)) {
        console.log("Duplicate event, skipping");
        continue;
      }

      if (event.type === "message") {
        await handleMessageEvent(event);
      } else if (event.type === "postback") {
        await handlePostbackEvent(event as LineEvent & { postback: { data: string } });
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
