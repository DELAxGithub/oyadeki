import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { verifySignature } from "../_shared/line-signature.ts";
import { isDuplicate } from "../_shared/dedup.ts";
import { logUsage, getUserContext, UserContext } from "../_shared/supabase-client.ts";
import { generateText, analyzeImage, extractLedgerInfo, LedgerItem, classifyImageIntent, identifyMedia, MediaInfo, generateListing, ListingInfo } from "../_shared/gemini-client.ts";
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

// 下書き提案機能は削除されました（W6でメディアログ機能に置き換え）

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
 * 共有トークン生成（16文字の安全な文字列）
 */
function generateShareToken(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // O/I/L/0/1除外
  let token = "";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 16; i++) {
    token += chars[bytes[i] % chars.length];
  }
  return token;
}

/**
 * 台帳一覧用Flex Message（共有ボタン付き）
 */
function buildLedgerListFlexMessage(items: any[], includeShareButton: boolean = true) {
  // アイテム数が多い場合は先頭10件に制限 (カルーセル上限)
  const displayItems = items.slice(0, 10);

  // 7日以上前の日付
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const bubbles = displayItems.map((item) => {
    const footerContents: unknown[] = [];

    // 未確認チェック
    const lastConfirmed = item.last_confirmed_at ? new Date(item.last_confirmed_at) : null;
    const isUnconfirmed = !lastConfirmed || lastConfirmed < sevenDaysAgo;

    // 確認ボタン
    footerContents.push({
      type: "button",
      style: isUnconfirmed ? "primary" : "secondary",
      height: "sm",
      action: {
        type: "postback",
        label: isUnconfirmed ? "⚠️ 確認する" : "✅ 確認済み",
        data: `action=confirm_ledger&id=${item.id}`
      }
    });

    // ヘッダー部分（未確認バッジ付き）
    const headerContents: unknown[] = [
      { type: "text", text: "📑", size: "md" },
      { type: "text", text: item.category || "その他", size: "xs", color: "#888888", margin: "sm", offsetBottom: "2px" }
    ];

    if (isUnconfirmed) {
      headerContents.push({
        type: "text",
        text: "未確認",
        size: "xs",
        color: "#FFFFFF",
        backgroundColor: "#E65100",
        margin: "sm",
        offsetBottom: "2px",
        decoration: "none"
      });
    }

    return {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: isUnconfirmed ? "#FFF8E1" : "#FFFFFF",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: headerContents,
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
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: footerContents
      },
      styles: {
        footer: { separator: true }
      }
    };
  });

  // 共有ボタン付きサマリーバブルを先頭に追加
  if (includeShareButton && items.length > 0) {
    const total = items.reduce((sum: number, item: any) => sum + (item.monthly_cost || 0), 0);
    const summaryBubble = {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "📊 台帳サマリー", weight: "bold", size: "lg" },
          { type: "separator", margin: "md" },
          {
            type: "box", layout: "vertical", margin: "md", spacing: "sm",
            contents: [
              { type: "text", text: `登録件数: ${items.length}件`, size: "md" },
              { type: "text", text: `月額合計: ¥${total.toLocaleString()}`, size: "md", weight: "bold", color: "#1DB446" },
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
              label: "🔗 グループに共有",
              data: "action=share_ledger"
            }
          },
          {
            type: "button",
            style: "secondary",
            action: {
              type: "postback",
              label: "📥 エクスポート",
              data: "action=export_ledger"
            }
          }
        ]
      }
    };
    bubbles.unshift(summaryBubble);
  }

  return {
    type: "flex",
    altText: "契約台帳リスト",
    contents: {
      type: "carousel",
      contents: bubbles
    }
  };
}

// ==================== メディアログ関連 ====================

const mediaTypeLabels: Record<string, string> = {
  movie: "🎬 映画",
  tv_show: "📺 テレビ",
  sports: "⚽ スポーツ",
  music: "🎵 音楽",
  book: "📚 本",
  other: "📝 その他",
};

const mediaTypeEmoji: Record<string, string> = {
  movie: "🎬",
  tv_show: "📺",
  sports: "⚽",
  music: "🎵",
  book: "📚",
  other: "📝",
};

/**
 * メディア識別結果の確認用Flex Message（評価ボタン付き）
 */
function buildMediaConfirmFlexMessage(media: MediaInfo, messageId: string) {
  const typeLabel = mediaTypeLabels[media.media_type] || "📝 その他";
  const castText = media.artist_or_cast ? `出演: ${media.artist_or_cast}` : "";
  const yearText = media.year ? `(${media.year})` : "";
  const subtitleText = media.subtitle ? `- ${media.subtitle}` : "";

  const ratingButtons = [1, 2, 3, 4, 5].map((star) => ({
    type: "button",
    style: "secondary",
    height: "sm",
    flex: 1,
    action: {
      type: "postback",
      label: "⭐".repeat(star),
      data: `action=rate_media&msgId=${messageId}&type=${media.media_type}&title=${encodeURIComponent(media.title.substring(0, 30))}&sub=${encodeURIComponent((media.subtitle || "").substring(0, 20))}&cast=${encodeURIComponent((media.artist_or_cast || "").substring(0, 20))}&year=${media.year || 0}&rating=${star}`,
    },
  }));

  return {
    type: "flex",
    altText: `${typeLabel}「${media.title}」を見ましたか？`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: typeLabel, size: "sm", color: "#1DB954", weight: "bold" },
          { type: "text", text: `${media.title} ${subtitleText}`, weight: "bold", size: "xl", wrap: true },
          ...(castText ? [{ type: "text", text: castText, size: "sm", color: "#666666", wrap: true }] : []),
          ...(yearText ? [{ type: "text", text: yearText, size: "xs", color: "#888888" }] : []),
          { type: "separator", margin: "md" },
          { type: "text", text: "⭐ 評価をつけてください", size: "sm", margin: "md" },
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
            spacing: "xs",
            contents: ratingButtons.slice(0, 3),
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "xs",
            contents: [
              ...ratingButtons.slice(3),
              {
                type: "button",
                style: "link",
                height: "sm",
                flex: 1,
                action: {
                  type: "postback",
                  label: "スキップ",
                  data: `action=skip_media&msgId=${messageId}`,
                },
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * メディアログ一覧用Flex Message（カルーセル）
 */
function buildMediaListFlexMessage(items: any[]) {
  const displayItems = items.slice(0, 10);

  if (displayItems.length === 0) {
    return {
      type: "text",
      text: "📭 まだ何も記録していません。\n\nテレビや映画の画面を写真で送ると、見たものを記録できますよ！",
    };
  }

  const bubbles = displayItems.map((item) => {
    const emoji = mediaTypeEmoji[item.media_type] || "📝";
    const stars = item.rating ? "⭐".repeat(item.rating) : "未評価";
    const watchedDate = item.watched_at
      ? new Date(item.watched_at).toLocaleDateString("ja-JP", { month: "short", day: "numeric" })
      : "";

    return {
      type: "bubble",
      size: "micro",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: emoji, size: "sm", flex: 0 },
              { type: "text", text: item.title, weight: "bold", size: "sm", wrap: true, flex: 1, margin: "sm" },
            ],
          },
          ...(item.subtitle ? [{ type: "text", text: item.subtitle, size: "xs", color: "#666666", wrap: true }] : []),
          { type: "text", text: stars, size: "sm", margin: "md" },
          { type: "text", text: watchedDate, size: "xxs", color: "#888888", align: "end" },
        ],
        paddingAll: "12px",
      },
    };
  });

  // サマリーバブルを先頭に追加
  const summaryBubble = {
    type: "bubble",
    size: "micro",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: "📖 見たもの", weight: "bold", size: "md" },
        { type: "text", text: `${items.length}件の記録`, size: "sm", color: "#666666", margin: "sm" },
        { type: "separator", margin: "md" },
        {
          type: "box",
          layout: "vertical",
          margin: "md",
          spacing: "xs",
          contents: [
            { type: "text", text: `🎬 ${items.filter((i: any) => i.media_type === "movie").length}`, size: "xs" },
            { type: "text", text: `📺 ${items.filter((i: any) => i.media_type === "tv_show").length}`, size: "xs" },
            { type: "text", text: `⚽ ${items.filter((i: any) => i.media_type === "sports").length}`, size: "xs" },
          ],
        },
      ],
      paddingAll: "12px",
      backgroundColor: "#F0FFF4",
    },
  };

  return {
    type: "flex",
    altText: `📖 見たもの（${items.length}件）`,
    contents: {
      type: "carousel",
      contents: [summaryBubble, ...bubbles],
    },
  };
}

// ==================== 台帳関連（既存） ====================

/**
 * グループ共有用サマリーメッセージ
 */
function buildGroupShareMessage(items: any[], shareUrl: string, expiresAt: Date) {
  const total = items.reduce((sum: number, item: any) => sum + (item.monthly_cost || 0), 0);
  const serviceList = items.slice(0, 5).map((i: any) =>
    `・${i.service_name} (${i.monthly_cost ? "¥" + i.monthly_cost.toLocaleString() : "不明"})`
  ).join("\n");
  const moreText = items.length > 5 ? `\n...他${items.length - 5}件` : "";

  const expiryText = `${expiresAt.getMonth() + 1}/${expiresAt.getDate()}まで有効`;

  return {
    type: "flex",
    altText: "契約台帳サマリー",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "📑 契約台帳サマリー", weight: "bold", size: "lg" },
          { type: "separator", margin: "md" },
          {
            type: "box", layout: "vertical", margin: "md", spacing: "sm",
            contents: [
              { type: "text", text: `登録件数: ${items.length}件`, size: "sm" },
              { type: "text", text: `月額合計: 約¥${total.toLocaleString()}`, size: "md", weight: "bold" },
              { type: "separator", margin: "md" },
              { type: "text", text: serviceList + moreText, size: "sm", wrap: true, margin: "md" }
            ]
          },
          { type: "text", text: `⏰ ${expiryText}`, size: "xs", color: "#888888", margin: "md" }
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
              type: "uri",
              label: "📋 詳細を見る",
              uri: shareUrl
            }
          }
        ]
      }
    }
  };
}

/**
 * 出品モードかどうかを確認（5分以内にsell_mode_startがあるか）
 */
async function isInSellMode(userId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("usage_logs")
    .select("id")
    .eq("line_user_id", userId)
    .eq("action_type", "sell_mode_start")
    .gte("created_at", fiveMinutesAgo)
    .limit(1);

  return (data?.length ?? 0) > 0;
}

/**
 * 出品文生成用Flex Message
 */
function buildListingFlexMessage(listing: ListingInfo) {
  return {
    type: "flex",
    altText: "📦 出品文が完成しました！",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "📦 出品文が完成！", weight: "bold", size: "lg", color: "#E53935" },
          { type: "separator", margin: "md" },
          { type: "text", text: "【タイトル】", weight: "bold", size: "sm", margin: "md", color: "#666666" },
          { type: "text", text: listing.title, wrap: true, size: "md" },
          { type: "separator", margin: "md" },
          { type: "text", text: "【説明文】", weight: "bold", size: "sm", margin: "md", color: "#666666" },
          { type: "text", text: listing.description, wrap: true, size: "sm" },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "horizontal",
            margin: "md",
            contents: [
              { type: "text", text: `📁 ${listing.category}`, size: "xs", color: "#888888", flex: 1, wrap: true },
              { type: "text", text: `📋 ${listing.condition}`, size: "xs", color: "#888888", flex: 1 },
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: "↑ タイトルと説明文を長押しでコピー！", size: "xs", color: "#888888", align: "center" },
          { type: "text", text: "メルカリアプリに貼り付けてね 📱", size: "xs", color: "#888888", align: "center" },
        ],
      },
    },
  };
}

/**
 * 救急箱フロー（画像解析ヘルパー）
 */
async function handleHelpImageFlow(
  replyToken: string,
  userId: string,
  base64: string,
  mimeType: string,
  messageId: string,
  userContext: UserContext | null,
  startTime: number
) {
  const helpId = crypto.randomUUID();

  // Vision解析
  const prompt = buildVisionPrompt(userContext);
  console.log("Calling Gemini Vision API for help...");
  const response = await analyzeImage(base64, mimeType, prompt);
  console.log("Vision response received");

  const latencyMs = Date.now() - startTime;
  const parsed = parseVisionResponse(response);
  console.log("Parsed vision response:", parsed);

  // Flex Messageで返信
  await replyMessage(replyToken, [
    buildVisionFlexMessage(
      parsed.warning,
      parsed.situation,
      parsed.step1,
      parsed.step2,
      parsed.step3,
      parsed.callAdvice,
      helpId,
      messageId
    ),
  ]);
  console.log("Vision message sent, latency:", latencyMs, "ms");

  // usage_logsにログ記録
  await logUsage(userId, "vision_help", {
    help_id: helpId,
    latency_ms: latencyMs,
    has_warning: parsed.warning !== "なし" && parsed.warning !== "-",
  });
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

      // メルカリ出品モード
      if (lowerText === "売る" || lowerText === "出品" || lowerText === "メルカリ") {
        await logUsage(userId, "sell_mode_start", {});
        await replyMessage(replyToken, [
          {
            type: "text",
            text: "📦 出品サポートモード！\n\n売りたいものの写真を送ってね。\nタイトルと説明文を作るよ！\n\n💡 ヒント：\n・全体が見える写真がベスト\n・傷や汚れがあれば、そこも撮ってね",
          },
        ]);
        return;
      }

      // メディアログ閲覧
      if (lowerText === "見た" || lowerText === "見たもの" || lowerText === "メディアログ" || lowerText === "視聴記録") {
        console.log("Fetching media logs for user:", userId);
        const supabase = getSupabaseClient();

        const { data: items, error } = await supabase
          .from("media_logs")
          .select("*")
          .eq("line_user_id", userId)
          .order("watched_at", { ascending: false })
          .limit(20);

        if (error) {
          console.error("Media logs fetch error:", error);
          await replyMessage(replyToken, [{ type: "text", text: "エラーが発生しました。時間をおいて試してください。" }]);
          return;
        }

        await logUsage(userId, "media_list", { count: items?.length || 0 });
        await replyMessage(replyToken, [buildMediaListFlexMessage(items || [])]);
        return;
      }

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
              "【見たものを記録（メディアログ）】\n📺 テレビや映画の画面を送ってね！\n→ 番組を特定して記録するよ\n→「見た」で履歴が見られるよ\n\n" +
              "【メルカリ出品（パス出し）】\n📦「売る」と送ってから商品の写真を送ってね！\n→ タイトルと説明文を作るよ\n\n" +
              "【コマンド一覧】\n「台帳」「見た」「売る」「使い方」",
          },
          {
            type: "text",
            text: "📸 スクショの撮り方\n\n" +
              "iPhone → 電源+音量上を同時押し\n" +
              "Android → 電源+音量下を同時押し\n\n" +
              "撮ったらそのまま送ってね！",
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

      // テキストメッセージへの一般的な応答
      // 下書き提案機能は廃止 → 写真を送るよう促す
      await replyMessage(replyToken, [
        {
          type: "text",
          text: "📷 写真を送ってみてください！\n\n" +
            "・スマホ画面で困ったことがあれば → 操作を案内\n" +
            "・テレビや映画の画面なら → 視聴記録に保存\n\n" +
            "コマンド一覧：\n" +
            "「台帳」→ 契約情報\n" +
            "「見た」→ 視聴記録\n" +
            "「使い方」→ ヘルプ",
        },
      ]);
      await logUsage(userId, "message", { text_length: message.text.length });
    } else if (message.type === "image") {
      console.log("Processing image message:", message.id);

      const startTime = Date.now();

      try {
        // ユーザー設定を取得
        const userContext = await getUserContext(userId);

        // 画像を取得
        console.log("Fetching image from LINE...");
        const { base64, mimeType } = await getImageContent(message.id);
        console.log("Image fetched, size:", base64.length, "mimeType:", mimeType);

        // ==================== 出品モードチェック ====================
        const sellMode = await isInSellMode(userId);
        if (sellMode) {
          console.log("User is in sell mode, generating listing...");
          const listing = await generateListing(base64, mimeType);

          if (listing) {
            await logUsage(userId, "listing_generate", {
              title: listing.title,
              latency_ms: Date.now() - startTime,
            });
            await replyMessage(replyToken, [buildListingFlexMessage(listing)]);
          } else {
            await replyMessage(replyToken, [{
              type: "text",
              text: "📦 うまく読み取れませんでした...\n\nもう少し明るい場所で、商品全体が見えるように撮ってみてね！",
            }]);
          }
          return;
        }

        // ==================== 通常フロー（Intent判定） ====================
        console.log("Classifying image intent...");
        const intent = await classifyImageIntent(base64, mimeType);
        console.log("Image intent:", intent);

        if (intent === "media") {
          // ==================== メディアログフロー ====================
          console.log("Processing as media content...");
          const mediaInfo = await identifyMedia(base64, mimeType);

          if (mediaInfo) {
            console.log("Media identified:", mediaInfo);

            await logUsage(userId, "media_identify", {
              media_type: mediaInfo.media_type,
              title: mediaInfo.title,
              latency_ms: Date.now() - startTime,
            });

            // 評価ボタン付きFlex Messageで返信
            await replyMessage(replyToken, [buildMediaConfirmFlexMessage(mediaInfo, message.id)]);
          } else {
            // メディアが特定できなかった場合 → 救急箱フローにフォールバック
            console.log("Media not identified, falling back to help flow");
            await handleHelpImageFlow(replyToken, userId, base64, mimeType, message.id, userContext, startTime);
          }
        } else {
          // ==================== 救急箱フロー（既存） ====================
          await handleHelpImageFlow(replyToken, userId, base64, mimeType, message.id, userContext, startTime);
        }

      } catch (error) {
        console.error("Error processing image:", error);
        await replyWithSafeFallback(replyToken);
        try {
          await logUsage(userId, "error", { error: String(error), context: "image_process" });
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

  // 下書きコピー処理は廃止（メディアログに置き換え）

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

  const action = params.get("action");

  // ==================== メディアログ関連 ====================

  // メディア評価保存 (action=rate_media)
  if (action === "rate_media") {
    const mediaType = params.get("type") || "other";
    const title = decodeURIComponent(params.get("title") || "不明");
    const subtitle = decodeURIComponent(params.get("sub") || "") || null;
    const cast = decodeURIComponent(params.get("cast") || "") || null;
    const year = parseInt(params.get("year") || "0") || null;
    const rating = parseInt(params.get("rating") || "3");

    const supabase = getSupabaseClient();

    // ユーザーIDを取得（user_contextsから）
    const { data: userCtx } = await supabase.from("user_contexts").select("user_id").eq("line_user_id", userId).single();

    // media_logsに保存
    const { error } = await supabase.from("media_logs").insert({
      user_id: userCtx?.user_id || null,
      line_user_id: userId,
      media_type: mediaType,
      title,
      subtitle,
      artist_or_cast: cast,
      year,
      rating,
      watched_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Failed to save media log:", error);
      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "エラーが発生しました。" }]);
      return;
    }

    await logUsage(userId, "media_rate", { title, rating });

    const stars = "⭐".repeat(rating);
    const emoji = mediaTypeEmoji[mediaType] || "📝";
    if (event.replyToken) {
      await replyMessage(event.replyToken, [{
        type: "text",
        text: `${emoji}「${title}」を ${stars} で記録しました！\n\n「見た」と送ると、これまでの記録が見られますよ📖`,
      }]);
    }
    return;
  }

  // メディアスキップ (action=skip_media)
  if (action === "skip_media") {
    if (event.replyToken) {
      await replyMessage(event.replyToken, [{
        type: "text",
        text: "スキップしました👌\n\nまた記録したいものがあれば、写真を送ってくださいね！",
      }]);
    }
    return;
  }

  // ==================== 台帳関連（既存） ====================

  // 台帳登録提案 (action=propose_ledger)
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

  // 台帳確認済み (action=confirm_ledger)
  if (action === "confirm_ledger") {
    const ledgerId = params.get("id");
    if (!ledgerId) {
      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "エラー：台帳IDが見つかりません。" }]);
      return;
    }

    const supabase = getSupabaseClient();
    await supabase
      .from("ledgers")
      .update({ last_confirmed_at: new Date().toISOString() })
      .eq("id", ledgerId)
      .eq("line_user_id", userId);

    if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "✅ 確認済みにしました！" }]);
    return;
  }

  // 台帳共有リンク作成 (action=share_ledger)
  if (action === "share_ledger") {
    const supabase = getSupabaseClient();

    // ユーザーの台帳を取得
    const { data: items } = await supabase
      .from("ledgers")
      .select("*")
      .eq("line_user_id", userId)
      .eq("status", "active");

    if (!items || items.length === 0) {
      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "共有できる台帳がありません。" }]);
      return;
    }

    // 共有トークン生成
    const token = generateShareToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30日後

    // グループIDを取得（グループからの呼び出しの場合）
    const groupId = event.source.groupId || null;

    // 共有レコード作成
    await supabase.from("ledger_shares").insert({
      line_user_id: userId,
      group_id: groupId,
      token,
      expires_at: expiresAt.toISOString()
    });

    await logUsage(userId, "ledger_share_create", { token, expires_days: 30 });

    // 共有URL
    const shareUrl = `https://oyadeki-liff.deno.dev/share/${token}`;

    // グループの場合はグループにサマリーを送信
    if (groupId) {
      const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
      await fetch(`${LINE_API_BASE}/message/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          to: groupId,
          messages: [buildGroupShareMessage(items, shareUrl, expiresAt)]
        }),
      });

      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "グループに台帳サマリーを共有しました！📤" }]);
    } else {
      // 個人チャットの場合は共有用メッセージを返信
      if (event.replyToken) await replyMessage(event.replyToken, [
        {
          type: "text",
          text: `📋 台帳共有リンクを作成しました\n\n${shareUrl}\n\n⏰ ${expiresAt.getMonth() + 1}/${expiresAt.getDate()}まで有効\n\nこのリンクをグループに貼ると、お子さんが詳細を確認できます。`
        }
      ]);
    }
    return;
  }

  // 台帳エクスポート (action=export_ledger)
  if (action === "export_ledger") {
    const supabase = getSupabaseClient();

    // ユーザーの台帳を取得
    const { data: items } = await supabase
      .from("ledgers")
      .select("*")
      .eq("line_user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (!items || items.length === 0) {
      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "エクスポートできる台帳がありません。" }]);
      return;
    }

    // CSVデータ作成
    const csvHeader = "サービス名,種類,月額,ID等,メモ,最終確認日";
    const csvRows = items.map((item: any) => {
      const confirmed = item.last_confirmed_at ? new Date(item.last_confirmed_at).toLocaleDateString("ja-JP") : "-";
      return `"${item.service_name || ""}","${item.category || ""}","${item.monthly_cost || ""}","${item.account_identifier || ""}","${(item.note || "").replace(/"/g, '""')}","${confirmed}"`;
    });
    const csvContent = [csvHeader, ...csvRows].join("\n");

    // 合計金額
    const total = items.reduce((sum: number, item: any) => sum + (item.monthly_cost || 0), 0);

    await logUsage(userId, "ledger_export", { count: items.length, format: "csv" });

    // CSVはLINEでは送れないので、サマリーとコピー用テキストを返信
    if (event.replyToken) await replyMessage(event.replyToken, [
      {
        type: "text",
        text: `📥 台帳エクスポート\n\n登録件数: ${items.length}件\n月額合計: ¥${total.toLocaleString()}\n\n⚠️ パスワードは含まれていません\n\n以下をコピーしてメモ帳などに貼り付けてください👇`
      },
      {
        type: "text",
        text: csvContent
      }
    ]);
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
