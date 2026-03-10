import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.177.0/encoding/base64.ts";
// import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts"; // Removed due to boot failure
import { corsHeaders } from "../_shared/cors.ts";
import { verifySignature } from "../_shared/line-signature.ts";
import { isDuplicate, isDuplicateAction } from "../_shared/dedup.ts";
import { logUsage, getUserContext, UserContext } from "../_shared/supabase-client.ts";
import { generateText, analyzeImage, extractLedgerInfo, LedgerItem, classifyImageIntent, identifyMedia, MediaInfo, MediaDialogueState, IdentifyMediaResult, generateListing, ListingInfo, analyzeProductImage, continueSellingDialogue, continueMediaDialogue, chatWithContext, enrichMediaInfo, identifyLedgerDocument, continueLedgerDialogue, LedgerDialogueState } from "../_shared/gemini-client.ts";
import { getSupabaseClient } from "../_shared/supabase-client.ts";

const LINE_API_BASE = "https://api.line.me/v2/bot";
const LINE_DATA_API_BASE = "https://api-data.line.me/v2/bot";
const TIMEOUT_MS = 3000;
// const MAX_IMAGE_BYTES = 2_000_000;
// const MAX_IMAGE_DIMENSION = 1280;
// const MAX_RESIZE_INPUT_BYTES = 10_000_000;
// const JPEG_QUALITY = 82;
// const JPEG_FALLBACK_QUALITY = 68;


interface LineEvent {
  type: string;
  replyToken?: string;
  webhookEventId?: string;
  timestamp?: number;
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
  const body = JSON.stringify({ replyToken, messages });
  console.log("replyMessage: sending", body.length, "bytes");
  const resp = await fetch(`${LINE_API_BASE}/message/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body,
  });
  if (!resp.ok) {
    const errorText = await resp.text();
    console.error("replyMessage FAILED:", resp.status, errorText);
    console.error("Payload preview:", JSON.stringify(messages).slice(0, 500));
    throw new Error(`LINE reply failed: ${resp.status} - ${errorText}`);
  }
  console.log("replyMessage: success");
}

/**
 * LINE Messaging APIでプッシュ送信（replyToken失効時の保険）
 */
async function pushMessage(userId: string, messages: unknown[]) {
  const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
  const body = JSON.stringify({ to: userId, messages });
  console.log("pushMessage: sending", body.length, "bytes");
  const resp = await fetch(`${LINE_API_BASE}/message/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body,
  });
  if (!resp.ok) {
    const errorText = await resp.text();
    console.error("pushMessage FAILED:", resp.status, errorText);
    throw new Error(`LINE push failed: ${resp.status} - ${errorText}`);
  }
  console.log("pushMessage: success");
}

/**
 * reply失敗時に、replyToken失効系エラーならpushへフォールバック
 */
async function replyOrPush(replyToken: string, userId: string, messages: unknown[]) {
  try {
    await replyMessage(replyToken, messages);
  } catch (error) {
    const text = String(error);
    const isReplyTokenIssue =
      text.includes("LINE reply failed: 400") ||
      /reply token|invalid reply token|expired/i.test(text);
    if (!isReplyTokenIssue) throw error;

    console.warn("reply failed due to token issue, falling back to push:", text);
    await pushMessage(userId, messages);
  }
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
 * LINE APIから画像を取得してBase64変換
 */
async function fetchLineImageBytes(
  messageId: string,
  variant: "content" | "preview"
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
  const suffix = variant === "preview" ? "/content/preview" : "/content";
  const response = await fetch(`${LINE_DATA_API_BASE}/message/${messageId}${suffix}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch image (${variant}): ${response.status}`);
  }

  const contentType = response.headers.get("Content-Type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  return { bytes: new Uint8Array(arrayBuffer), mimeType: contentType };
}

function toBase64Buffer(bytes: Uint8Array): ArrayBuffer {
  // Ensure we pass a strict ArrayBuffer to std/base64 encode.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

// Simplified: Always use preview image to avoid OOM and dependencies
async function getImageContent(messageId: string): Promise<{ base64: string; mimeType: string }> {
  try {
    // Prefer preview image for safety (smaller size)
    const preview = await fetchLineImageBytes(messageId, "preview");
    console.log("Using preview image size:", preview.bytes.length);
    return { base64: encodeBase64(toBase64Buffer(preview.bytes)), mimeType: preview.mimeType };
  } catch (error) {
    console.error("Failed to fetch preview, trying original content:", error);
    // Fallback to original content (risky but better than nothing)
    const original = await fetchLineImageBytes(messageId, "content");
    return { base64: encodeBase64(toBase64Buffer(original.bytes)), mimeType: original.mimeType };
  }
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
 * メインメニューFlex Message生成
 */
function buildMainMenuFlexMessage() {
  return {
    type: "flex",
    altText: "基本メニュー",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: "https://oyadeki-liff.deno.dev/logo.svg", // ロゴがあれば
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover",
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "オヤデキ メニュー",
            weight: "bold",
            size: "xl",
            align: "center",
          },
          {
            type: "text",
            text: "何をしますか？",
            size: "sm",
            color: "#666666",
            align: "center",
          },
          {
            type: "separator",
            margin: "lg",
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "md",
            margin: "lg",
            contents: [
              {
                type: "button",
                style: "secondary",
                color: "#F0F0F0",
                height: "sm",
                action: { type: "message", label: "📑 契約台帳", text: "台帳" },
                flex: 1,
              },
              {
                type: "button",
                style: "secondary",
                color: "#F0F0F0",
                height: "sm",
                action: { type: "message", label: "📺 見たもの", text: "見た" },
                flex: 1,
              },
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "md",
            margin: "md",
            contents: [
              {
                type: "button",
                style: "secondary",
                color: "#F0F0F0",
                height: "sm",
                action: { type: "message", label: "📦 出品", text: "出品" },
                flex: 1,
              },
              {
                type: "button",
                style: "secondary",
                color: "#F0F0F0",
                height: "sm",
                action: { type: "uri", label: "⚙️ 設定", uri: "https://oyadeki-liff.deno.dev/settings" },
                flex: 1,
              },
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            action: { type: "postback", label: "使い方のヒント", data: "action=show_help_tips" },
            style: "link",
            height: "sm",
          }
        ]
      }
    },
  };
}

/**
 * 出品サポートFlex Message
 */
function buildSellSupportFlexMessage() {
  return {
    type: "flex",
    altText: "メルカリ出品サポート",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "📦 出品サポート", weight: "bold", size: "lg", color: "#E53935" },
          { type: "text", text: "売りたい物の写真を送ってください。\nAIがタイトルと説明文を作ります！", wrap: true, size: "sm" },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            margin: "md",
            contents: [
              { type: "text", text: "💡 撮影のヒント", size: "xs", color: "#888888", weight: "bold" },
              { type: "text", text: "・全体が明るく写るように", size: "xs", color: "#888888" },
              { type: "text", text: "・傷や汚れがあればアップで", size: "xs", color: "#888888" }
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
            style: "link",
            height: "sm",
            action: { type: "message", label: "≡ メニューに戻る", text: "メニュー" },
            margin: "sm"
          }
        ]
      }
    },
    quickReply: {
      items: [
        {
          type: "action",
          action: { type: "camera", label: "📷 カメラで撮る" }
        },
        {
          type: "action",
          action: { type: "cameraRoll", label: "🖼️ ライブラリ" }
        }
      ]
    }
  };
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
      backgroundColor: "#FFEBEB",
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
                flex: 2,
              },
              {
                type: "button",
                style: "secondary",
                height: "sm",
                action: { type: "postback", label: "電話で聞く", data: `vision=${helpId}&result=call` },
                flex: 1,
              },
            ],
          },
          { type: "separator", margin: "md" },
          {
            type: "text",
            text: "もし別の要件なら...",
            size: "xs",
            color: "#aaaaaa",
            align: "center",
            margin: "md",
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "button",
                style: "secondary",
                height: "sm",
                action: { type: "postback", label: "📑 台帳へ", data: `action=propose_ledger&msgId=${messageId}` },
                flex: 1,
              },
              {
                type: "button",
                style: "secondary",
                height: "sm",
                action: { type: "message", label: "📺 記録へ", text: "見た" }, // 簡易的にテキスト発火で誘導
                flex: 1,
              },
            ],
          },
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
          { type: "text", text: "📝 台帳登録案", weight: "bold", color: "#06C755", size: "xs" },
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

// ==================== メディアログ関連 ====================

const mediaTypeLabels: Record<string, string> = {
  movie: "🎬 映画",
  tv_show: "📺 テレビ",
  anime: "📺 アニメ",
  sports: "⚽ スポーツ",
  music: "🎵 音楽",
  book: "📚 本",
  other: "📝 その他",
};

const mediaTypeEmoji: Record<string, string> = {
  movie: "🎬",
  tv_show: "📺",
  anime: "📺",
  sports: "⚽",
  music: "🎵",
  book: "📚",
  other: "📝",
};

/**
 * メディア識別結果の確認用Flex Message（評価ボタン付き）
 */
function buildMediaConfirmFlexMessage(media: MediaInfo) {
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
      label: `${star} ⭐`,
      data: `action=rate_media&type=${media.media_type}&title=${encodeURIComponent(media.title.substring(0, 12))}&sub=${encodeURIComponent((media.subtitle || "").substring(0, 5))}&cast=${encodeURIComponent((media.artist_or_cast || "").substring(0, 8))}&year=${media.year || 0}&rating=${star}`,
    },
  }));

  // スコア表示
  const scoreText = media.score ? `${media.score.toFixed(1)}` : "";

  return {
    type: "flex",
    altText: `${typeLabel}「${media.title}」- 評価をつけてください`,
    contents: {
      type: "bubble",
      // ポスター画像があればヒーロー表示
      ...(media.poster_url ? {
        hero: {
          type: "image",
          url: media.poster_url,
          size: "full",
          aspectRatio: "2:3",
          aspectMode: "cover",
        },
      } : {}),
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "box", layout: "horizontal", contents: [
              { type: "text", text: typeLabel, size: "sm", color: "#06C755", weight: "bold", flex: 0 },
              ...(scoreText ? [{
                type: "text", text: `★ ${scoreText}`, size: "sm", color: "#ff8c00", weight: "bold",
                align: "end" as const, flex: 0,
              }] : []),
            ],
          },
          { type: "text", text: `${media.title} ${subtitleText}`, weight: "bold", size: "lg", wrap: true },
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
                  data: `action=skip_media`,
                },
              },
            ],
          },
          { type: "separator", margin: "sm" },
          {
            type: "button", // 修正：他のメニューに戻る動線を追加
            style: "link",
            height: "sm",
            action: { type: "message", label: "≡ メニューに戻る", text: "メニュー" },
          }
        ],
      },
    },
  };
}

// ==================== 台帳関連（既存） ====================

/**
 * 視聴記録(見た)モードかどうかを確認（直近のアクションがmedia_mode_triggerで、かつ5分以内か）
 */
async function isInMediaMode(userId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const fiveMinutesAgoMs = Date.now() - 5 * 60 * 1000;
  const fiveMinutesAgoIso = new Date(fiveMinutesAgoMs).toISOString();

  const { data, error } = await supabase
    .from("usage_logs")
    .select("created_at")
    .eq("line_user_id", userId)
    .eq("action_type", "media_mode_trigger")
    .gte("created_at", fiveMinutesAgoIso)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("isInMediaMode query error:", error);
    return false;
  }

  const latest = data?.[0]?.created_at;
  if (!latest) return false;

  const latestMs = Date.parse(latest);
  if (Number.isNaN(latestMs)) {
    console.warn("isInMediaMode: invalid created_at", latest);
    return false;
  }

  return latestMs >= fiveMinutesAgoMs;
}

/**
 * 台帳モードかどうかを確認（直近のアクションがledger_mode_triggerで、かつ5分以内か）
 */
async function isInLedgerMode(userId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const fiveMinutesAgoMs = Date.now() - 5 * 60 * 1000;
  const fiveMinutesAgoIso = new Date(fiveMinutesAgoMs).toISOString();

  const { data, error } = await supabase
    .from("usage_logs")
    .select("created_at")
    .eq("line_user_id", userId)
    .eq("action_type", "ledger_mode_trigger")
    .gte("created_at", fiveMinutesAgoIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("isInLedgerMode query error:", error);
    return false;
  }

  if (!data) return false;

  const latestMs = Date.parse(data.created_at);
  if (Number.isNaN(latestMs)) {
    console.warn("isInLedgerMode: invalid created_at", data.created_at);
    return false;
  }

  return latestMs >= fiveMinutesAgoMs;
}

/**
 * 出品モードかどうかを確認（5分以内にsell_mode_startがあるか）
 */
/**
 * 出品モードかどうかを確認（直近のアクションがsell_mode_startで、かつ5分以内か）
 */
async function isInSellMode(userId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const fiveMinutesAgoMs = Date.now() - 5 * 60 * 1000;
  const fiveMinutesAgoIso = new Date(fiveMinutesAgoMs).toISOString();

  const { data, error } = await supabase
    .from("usage_logs")
    .select("created_at")
    .eq("line_user_id", userId)
    .eq("action_type", "sell_mode_start")
    .gte("created_at", fiveMinutesAgoIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("isInSellMode query error:", error);
    return false;
  }

  if (!data) return false;

  const latestMs = Date.parse(data.created_at);
  if (Number.isNaN(latestMs)) {
    console.warn("isInSellMode: invalid created_at", data.created_at);
    return false;
  }

  return latestMs >= fiveMinutesAgoMs;
}

/**
 * 進行中の出品取引を取得
 */
async function getActiveSellItem(userId: string) {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("sell_items")
    .select("*")
    .eq("line_user_id", userId)
    .in("status", ["analyzing", "questioning"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * 出品取引を更新
 */
async function updateSellItem(id: string, updates: any) {
  const supabase = getSupabaseClient();
  await supabase.from("sell_items").update(updates).eq("id", id);
}

/**
 * 直近のメディアログ取得（コンテキスト会話用）
 */
async function getRecentMediaLog(userId: string) {
  const supabase = getSupabaseClient();
  // 30分以内のログを検索
  const timeLimit = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("media_logs")
    .select("*")
    .eq("line_user_id", userId)
    .gt("created_at", timeLimit)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * 直近の出品完了アイテム取得（コンテキスト会話用）
 */
async function getRecentCompletedSellItem(userId: string) {
  const supabase = getSupabaseClient();
  const timeLimit = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("sell_items")
    .select("*")
    .eq("line_user_id", userId)
    .eq("status", "completed")
    .gt("updated_at", timeLimit)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (!data || data.length === 0) return null;

  for (const item of data) {
    const type = (item.extracted_info as any)?.type;
    if (type === "media_dialogue" || type === "media_confirm" || type === "ledger_dialogue") {
      continue;
    }
    return item;
  }
  return null;
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
    const text = message.text?.toLowerCase().trim() || "";
    // 呼びかけキーワード。モード開始コマンドも含める。
    const keywords = [
      "オヤデキ", "おやでき", "使い方", "ヘルプ", "help", "台帳", "設定", "menu", "メニュー",
      "見た", "見たもの", "メディアログ", "視聴記録", "売る", "出品", "メルカリ",
    ];
    const isCalled = keywords.some(k => text.includes(k));

    if (!isCalled) {
      // ただし、すでに対話中/モード中なら短文応答（「はい」「違います」等）を通す。
      try {
        const [activeItem, mediaMode, sellMode, ledgerMode] = await Promise.all([
          getActiveSellItem(userId),
          isInMediaMode(userId),
          isInSellMode(userId),
          isInLedgerMode(userId),
        ]);
        const hasActiveDialogue = !!activeItem;
        const hasActiveMode = mediaMode || sellMode || ledgerMode;
        if (!hasActiveDialogue && !hasActiveMode) {
          console.log("Group message ignored (no keyword/mode/dialogue match)");
          return;
        }
        console.log("Group message allowed due to active dialogue/mode");
      } catch (e) {
        // 判定に失敗した場合は fail-open で処理を継続（無反応を避ける）
        console.warn("Group filter check failed; allowing message:", e);
      }
    }
  }

  try {
    if (message.type === "text" && message.text) {
      console.log("Processing text message:", message.text);
      const lowerText = message.text.toLowerCase().trim();

      // Priority Check: Sell Mode
      // Priority Check: Sell Mode
      if (lowerText === "売る" || lowerText === "出品" || lowerText === "メルカリ") {
        try {
          await logUsage(userId, "sell_mode_start", {});
          const flexMsg = buildSellSupportFlexMessage();
          // @ts-ignore: line message type
          await replyMessage(replyToken, [flexMsg]);
        } catch (e) {
          console.error("Sell mode error:", e);
          await replyMessage(replyToken, [{ type: "text", text: "すみません、出品メニューの表示に失敗しました。\n(エラー: " + String(e) + ")" }]);
        }
        return;
      }

      // 特殊コマンド処理

      // メインメニュー表示
      // グループで「オヤデキ」と呼ばれたときもここに来る
      if (["メニュー", "menu", "オヤデキ", "おやでき"].includes(lowerText)) {
        try { await logUsage(userId, "main_menu_trigger", {}); } catch (e) { console.error("logUsage failed", e); }
        await replyMessage(replyToken, [buildMainMenuFlexMessage()]);
        return;
      }

      // メディアログ閲覧
      // メディアログ (見たものモード)
      if (lowerText === "見た" || lowerText === "見たもの" || lowerText === "メディアログ" || lowerText === "視聴記録") {
        try { await logUsage(userId, "media_mode_trigger", {}); } catch (e) { console.error("logUsage media failed", e); }

        await replyMessage(replyToken, [{
          type: "text",
          text: "今見ているテレビや映画の画面を\n写真で送ってください！\n作品名を記録します。",
          quickReply: {
            items: [
              { type: "action", action: { type: "cameraRoll", label: "ライブラリ" } },
              { type: "action", action: { type: "camera", label: "カメラ" } },
              { type: "action", action: { type: "postback", label: "📖 履歴を見る", data: "action=view_media_history" } }
            ]
          }
        }]);
        return;
      }

      // 台帳モード
      if (lowerText === "台帳" || lowerText === "契約台帳" || lowerText.includes("ledger")) {
        try { await logUsage(userId, "ledger_mode_trigger", {}); } catch (e) { console.error("logUsage ledger failed", e); }

        await replyMessage(replyToken, [{
          type: "text",
          text: "契約書や請求書の写真を送ると\nAIが内容を読み取って登録します。",
          quickReply: {
            items: [
              { type: "action", action: { type: "cameraRoll", label: "ライブラリ" } },
              { type: "action", action: { type: "camera", label: "カメラ" } },
              { type: "action", action: { type: "postback", label: "📋 登録済一覧", data: "action=view_ledger_list" } }
            ]
          }
        }]);
        return;
      }

      // 設定画面
      if (lowerText === "設定") {
        const settingsUrl = `https://oyadeki-liff.deno.dev/settings`;
        await replyMessage(replyToken, [{
          type: "text",
          text: `⚙️ 設定画面はこちら\n${settingsUrl}\n\n話し方や趣味のテーマ、保管場所などを変更できます。`,
        }]);
        return;
      }

      // タスク一覧
      if (lowerText === "タスク" || lowerText === "やること" || lowerText === "todo") {
        console.log("Fetching tasks for user:", userId);
        const supabase = getSupabaseClient();

        // 今日配信すべきタスクを取得
        const today = new Date().toISOString().split("T")[0];
        const { data: tasks, error } = await supabase
          .from("tasks")
          .select("id, title, note, phase, project, priority")
          .eq("line_user_id", userId)
          .eq("status", "pending")
          .or(`scheduled_date.is.null,scheduled_date.lte.${today}`)
          .order("priority", { ascending: false })
          .order("sort_order", { ascending: true })
          .limit(5);

        if (error) {
          console.error("Task fetch error:", error);
          await replyMessage(replyToken, [{ type: "text", text: "エラーが発生しました。時間をおいて試してください。" }]);
          return;
        }

        if (!tasks || tasks.length === 0) {
          await replyMessage(replyToken, [{
            type: "flex",
            altText: "今日のタスクはありません",
            contents: {
              type: "bubble",
              body: {
                type: "box",
                layout: "vertical",
                contents: [
                  { type: "text", text: "🎉 今日のタスクはありません！", weight: "bold", size: "md" },
                  { type: "text", text: "ゆっくり過ごしてくださいね。", size: "sm", color: "#888888", margin: "md" },
                ],
                paddingAll: "lg",
              },
              footer: {
                type: "box",
                layout: "vertical",
                contents: [
                  {
                    type: "button",
                    style: "secondary",
                    action: {
                      type: "uri",
                      label: "一覧を見る",
                      uri: `https://oyadeki-liff.deno.dev/tasks/${userId}`,
                    },
                  },
                ],
                paddingAll: "lg",
              },
            },
          }]);
          return;
        }

        await logUsage(userId, "task_list", { count: tasks.length });

        // 全件数を取得
        const { count: totalCount } = await supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("line_user_id", userId)
          .eq("status", "pending");

        // Flex Message作成
        const taskBoxes = tasks.slice(0, 3).map((task: any, idx: number) => ({
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: `${idx + 1}.`, size: "sm", color: "#06C755", flex: 0 },
            {
              type: "box",
              layout: "vertical",
              flex: 1,
              paddingStart: "md",
              contents: [
                { type: "text", text: task.title, size: "sm", weight: "bold", wrap: true },
                ...(task.note ? [{ type: "text", text: task.note, size: "xs", color: "#888888", wrap: true }] : []),
              ],
            },
          ],
          paddingBottom: "md",
        }));

        const remaining = (totalCount || 0) - 3;
        const firstTask = tasks[0];

        const flexMessage = {
          type: "flex",
          altText: `今日のやること（${tasks.length}件）`,
          contents: {
            type: "bubble",
            header: {
              type: "box",
              layout: "vertical",
              contents: [
                { type: "text", text: "📋 今日のやること", weight: "bold", size: "lg", color: "#1A1A1A" },
                ...(firstTask?.phase ? [{ type: "text", text: firstTask.phase, size: "xs", color: "#888888" }] : []),
              ],
              backgroundColor: "#F5F5F5",
              paddingAll: "lg",
            },
            body: {
              type: "box",
              layout: "vertical",
              contents: [
                ...taskBoxes,
                ...(remaining > 0 ? [{ type: "text", text: `...他 ${remaining}件`, size: "xs", color: "#888888", align: "end" }] : []),
              ],
              paddingAll: "lg",
            },
            footer: {
              type: "box",
              layout: "vertical",
              spacing: "sm",
              contents: [
                {
                  type: "button",
                  style: "primary",
                  color: "#06C755",
                  action: {
                    type: "postback",
                    label: "1つ完了！",
                    data: `action=task_complete&task_id=${firstTask?.id || ""}`,
                    displayText: "完了しました！",
                  },
                },
                {
                  type: "button",
                  style: "secondary",
                  action: {
                    type: "uri",
                    label: "全部見る",
                    uri: `https://oyadeki-liff.deno.dev/tasks/${userId}`,
                  },
                },
              ],
              paddingAll: "lg",
            },
          },
        };

        await replyMessage(replyToken, [flexMessage]);
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
              "【メルカリ出品（パス出し）】\n📦「売る」と送ってから商品の写真を送ってね！\n→ AI店員が詳しく質問するよ（対話モード）\n\n" +
              "【コマンド一覧】\n「タスク」「台帳」「見た」「売る」「設定」「使い方」",
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

      // ==================== 出品対話 & メディア対話モード処理 ====================
      const activeSellItem = await getActiveSellItem(userId);
      console.log("activeSellItem check:", activeSellItem ? `found (id=${activeSellItem.id}, status=${activeSellItem.status})` : "none");

      // ユーザー設定取得（対話用）
      const userContext = await getUserContext(userId);

      if (activeSellItem) {
        // キャンセル処理
        if (lowerText === "キャンセル" || lowerText === "やめる" || lowerText === "終了") {
          await updateSellItem(activeSellItem.id, { status: "cancelled" });
          await replyMessage(replyToken, [{ type: "text", text: "対話モードを終了しました。" }]);
          return;
        }

        // extracted_info の type でモード分岐
        const info = activeSellItem.extracted_info as any;

        if (info && info.type === "media_confirm") {
          // -------- メディア確認ステップ（ユーザーの最終確認） --------
          console.log("Media confirm step for item:", activeSellItem.id);
          const confirmedMedia = info.confirmed_media as MediaInfo;
          const lowerReply = message.text.trim();

          // 肯定判定
          const isPositive = /^(はい|うん|そう|そうです|合ってる|あってる|正解|ok|yes|おk|それ|それです)$/i.test(lowerReply)
            || lowerReply.includes("合って") || lowerReply.includes("それ");

          if (isPositive && confirmedMedia) {
            // 確定！→ 評価フェーズへ
            console.log("  User confirmed:", confirmedMedia.title);

            await updateSellItem(activeSellItem.id, { status: "completed" });

            await logUsage(userId, "media_identify_dialogue_success", {
              media_type: confirmedMedia.media_type,
              title: confirmedMedia.title
            });

            await replyMessage(replyToken, [
              { type: "text", text: `🎉 「${confirmedMedia.title}」ですね！` },
              buildMediaConfirmFlexMessage(confirmedMedia)
            ]);
          } else {
            // 否定 → 対話モードに戻す
            console.log("  User denied, reverting to dialogue mode");

            const history = (activeSellItem.dialogue_history || []) as { role: string; text: string }[];
            history.push({ role: "user", text: message.text });

            await updateSellItem(activeSellItem.id, {
              extracted_info: {
                type: "media_dialogue",
                visual_clues: info.visual_clues || "",
                media_candidate: null, // 候補リセット
              },
              dialogue_history: history,
              status: "questioning"
            });

            // Geminiで別の候補を探す
            const result = await continueMediaDialogue(
              info.visual_clues || "",
              history,
              message.text,
              null, // 候補リセット
              userContext
            );

            if (result && "visual_clues" in result) {
              const nextState = result as MediaDialogueState;
              history.push({ role: "assistant", text: nextState.question });

              await updateSellItem(activeSellItem.id, {
                extracted_info: {
                  type: "media_dialogue",
                  visual_clues: nextState.visual_clues,
                  media_candidate: nextState.media_candidate || null,
                },
                dialogue_history: history,
              });

              await replyOrPush(replyToken, userId, [{
                type: "text",
                text: "🎬 " + nextState.question
              }]);
            } else {
              await replyOrPush(replyToken, userId, [{
                type: "text",
                text: "🤔 もう少し詳しく教えてもらえますか？\n（例：出演者、ストーリー、放送局など）"
              }]);
            }
          }

        } else if (info && info.type === "media_dialogue") {
          // -------- メディア対話（二段階フロー） --------
          console.log("Continuing media dialogue for item:", activeSellItem.id);
          console.log("  extracted_info:", JSON.stringify(info));

          try {
            // ユーザーの回答を履歴に追加
            const history = (activeSellItem.dialogue_history || []) as { role: string; text: string }[];
            history.push({ role: "user", text: message.text });

            // 保存されている候補情報を渡す
            const storedCandidate = info.media_candidate || null;
            console.log("  storedCandidate:", storedCandidate ? storedCandidate.title : "null");

            // Geminiで対話継続（候補情報付き）
            const result = await continueMediaDialogue(
              info.visual_clues || "",
              history,
              message.text,
              storedCandidate,
              userContext
            );

            console.log("  continueMediaDialogue result:", result ? JSON.stringify(result).substring(0, 200) : "null");

            if (result) {
              if ("visual_clues" in result) {
                // まだ確定していない → 対話継続
                const nextState = result as MediaDialogueState;
                history.push({ role: "assistant", text: nextState.question });

                await updateSellItem(activeSellItem.id, {
                  extracted_info: {
                    type: "media_dialogue",
                    visual_clues: nextState.visual_clues,
                    media_candidate: nextState.media_candidate || storedCandidate,
                  },
                  dialogue_history: history,
                  status: "questioning"
                });

                await replyOrPush(replyToken, userId, [{
                  type: "text",
                  text: "🎬 " + nextState.question
                }]);

              } else {
                // AIが特定した → 外部DBで補完 → 確認ステップへ
                let mediaInfo = result as MediaInfo;
                console.log("  Media candidate identified:", mediaInfo.title);

                // 外部DB（TMDB/Jikan/iTunes）で情報補完
                try {
                  mediaInfo = await enrichMediaInfo(mediaInfo);
                  console.log("  Enriched:", mediaInfo.external_source, mediaInfo.score, mediaInfo.poster_url ? "has poster" : "no poster");
                } catch (e) {
                  console.warn("  Enrich failed (non-critical):", e);
                }

                // media_confirm 状態に遷移（ユーザーの最終確認待ち）
                await updateSellItem(activeSellItem.id, {
                  extracted_info: {
                    type: "media_confirm",
                    visual_clues: info.visual_clues,
                    media_candidate: storedCandidate,
                    confirmed_media: mediaInfo,
                  },
                  dialogue_history: history,
                  status: "questioning"
                });

                // 確認メッセージ（外部DB情報付き）
                const castLine = mediaInfo.artist_or_cast ? `\n出演: ${mediaInfo.artist_or_cast}` : "";
                const yearLine = mediaInfo.year ? ` (${mediaInfo.year})` : "";
                const scoreLine = mediaInfo.score ? `\n評価: ${mediaInfo.score.toFixed(1)}/10` : "";
                const genreLine = mediaInfo.genres?.length ? `\nジャンル: ${mediaInfo.genres.join(", ")}` : "";
                const synopsisLine = mediaInfo.synopsis ? `\n\n📖 ${mediaInfo.synopsis}` : "";

                const confirmMessages: any[] = [];
                // ポスター画像があれば送信
                if (mediaInfo.poster_url) {
                  confirmMessages.push({
                    type: "image",
                    originalContentUrl: mediaInfo.poster_url,
                    previewImageUrl: mediaInfo.poster_url,
                  });
                }
                confirmMessages.push({
                  type: "text",
                  text: `🎬 「${mediaInfo.title}」${yearLine}${castLine}${scoreLine}${genreLine}${synopsisLine}\n\n💡 ${mediaInfo.trivia || ""}\n\nこの作品で合っていますか？\n→「はい」で評価へ\n→「違う」でやり直し`
                });

                await replyOrPush(replyToken, userId, confirmMessages);
              }
            } else {
              // エラーまたは会話終了 (nullの場合)
              // すぐに諦めず、ユーザーに入力を促す
              await replyOrPush(replyToken, userId, [{
                type: "text",
                text: "🤔 うーん、まだピンときていません...\n\nもう少し詳しく教えてもらえますか？\n（例：出演者、ストーリー、放送局など）"
              }]);
              // ステータスは変えず、対話継続
            }
          } catch (dialogueError) {
            console.error("Media dialogue error:", dialogueError);
            // エラー時もユーザーに返信する（沈黙防止）
            try {
              await replyOrPush(replyToken, userId, [{
                type: "text",
                text: "すみません、処理中にエラーが発生しました。\nもう一度写真を送ってみてください📷"
              }]);
            } catch (replyErr) {
              console.error("Fallback reply also failed:", replyErr);
            }
          }

        } else if (info && info.type === "ledger_dialogue") {
          // -------- 台帳特定対話（最短特定） --------
          console.log("Continuing ledger dialogue for item:", activeSellItem.id);

          try {
            const history = (activeSellItem.dialogue_history || []) as { role: string; text: string }[];
            history.push({ role: "user", text: message.text });

            const storedCandidate = (info.ledger_candidate || null) as LedgerItem | null;
            const result = await continueLedgerDialogue(
              info.document_clues || activeSellItem.image_summary || "",
              history,
              message.text,
              storedCandidate,
              userContext
            );

            if (result) {
              if ("document_clues" in result) {
                // まだ特定継続
                const nextState = result as LedgerDialogueState;
                history.push({ role: "assistant", text: nextState.question });

                await updateSellItem(activeSellItem.id, {
                  extracted_info: {
                    type: "ledger_dialogue",
                    document_clues: nextState.document_clues,
                    ledger_candidate: nextState.ledger_candidate || storedCandidate,
                    source_message_id: info.source_message_id || null,
                  },
                  dialogue_history: history,
                  status: "questioning",
                });

                await replyOrPush(replyToken, userId, [{
                  type: "text",
                  text: "🧾 " + nextState.question
                }]);
              } else {
                // 特定完了 -> 登録確認カードを即提示
                const identified = result as LedgerItem;
                const sourceMessageId = typeof info.source_message_id === "string" && info.source_message_id
                  ? info.source_message_id
                  : `manual-${Date.now()}`;

                await updateSellItem(activeSellItem.id, {
                  extracted_info: {
                    type: "ledger_dialogue",
                    document_clues: info.document_clues || activeSellItem.image_summary || "",
                    ledger_candidate: identified,
                    source_message_id: sourceMessageId,
                  },
                  dialogue_history: history,
                  status: "completed",
                });

                await logUsage(userId, "ledger_propose", { count: 1, source: "dialogue" });

                const confirmCard = buildLedgerConfirmFlexMessage([identified], sourceMessageId);
                await replyOrPush(replyToken, userId, [
                  {
                    type: "text",
                    text: `🧾 「${identified.service_name}」として特定しました。\n内容を確認して、問題なければ「この内容で登録」を押してください。`
                  },
                  confirmCard as any
                ]);
              }
            } else {
              await replyOrPush(replyToken, userId, [{
                type: "text",
                text: "🧾 まだ特定しきれていません。\nサービス名や請求先名を短く教えてください。"
              }]);
            }
          } catch (ledgerDialogueError) {
            console.error("Ledger dialogue error:", ledgerDialogueError);
            await replyOrPush(replyToken, userId, [{
              type: "text",
              text: "🧾 台帳の特定中にエラーが発生しました。\nもう一度写真を送ってください。"
            }]);
          }

        } else {
          // -------- 出品対話 (既存) --------
          console.log("Continuing selling dialogue for item:", activeSellItem.id);

          // ユーザーの回答を履歴に追加
          const history = (activeSellItem.dialogue_history || []) as { role: string; text: string }[];
          history.push({ role: "user", text: message.text });

          // Geminiで次のステップを生成
          const nextState = await continueSellingDialogue(
            activeSellItem.extracted_info,
            activeSellItem.image_summary || "",
            history,
            message.text,
            userContext
          );

          if (nextState) {
            // 履歴にAIの応答を追加（質問または完了メッセージ）
            const aiReplyText = nextState.is_sufficient
              ? "ありがとうございます！出品文を作成しました。"
              : (nextState.next_question || "詳細を教えてください。");

            history.push({ role: "assistant", text: aiReplyText });

            // DB更新
            await updateSellItem(activeSellItem.id, {
              extracted_info: nextState.extracted_info,
              dialogue_history: history,
              status: nextState.is_sufficient ? "completed" : "questioning"
            });

            if (nextState.is_sufficient && nextState.listing) {
              // 完了 -> 出品文送信
              await replyMessage(replyToken, [
                { type: "text", text: "聞き取りありがとうございました！\nこちらで出品文を作成しました👇" },
                buildListingFlexMessage(nextState.listing),
                { type: "text", text: nextState.listing.title },
                { type: "text", text: nextState.listing.description },
              ]);
              // 感想戦へ移行するため、statusはcompletedだが、感想戦タイマーを始動させてもよい
              // ここでは一旦完了とする
            } else {
              // 質問継続
              await replyMessage(replyToken, [
                { type: "text", text: nextState.next_question || "詳細を教えてください。" }
              ]);
            }
          } else {
            // エラー
            await replyMessage(replyToken, [{ type: "text", text: "すみません、うまく処理できませんでした。もう一度教えてください。" }]);
          }
        }
        return;
      }


      // ==================== コンテキスト会話（見た感想戦 & 売る感想戦） ====================
      // 明示的なコマンドではなく、かつ出品モードでもない場合

      // 1. 直近の出品完了アイテムがあるか？（完了後の「いくらで売れる？」などに対応）
      const recentSellItem = await getRecentCompletedSellItem(userId);
      if (recentSellItem) {
        console.log("Found recent sell item context:", recentSellItem.image_summary);
        await logUsage(userId, "sell_chat", { id: recentSellItem.id });

        // 出品アイテム情報をコンテキスト用に整形
        const itemContext = {
          title: recentSellItem.extracted_info?.product_name || "商品",
          media_type: "item", // 便宜上
          trivia: `この商品の特徴: ${JSON.stringify(recentSellItem.extracted_info || {})}. ユーザーの質問には、出品の補足情報や相場感などを答えてあげてください。`
        };

        const replyText = await chatWithContext(message.text || "", "media", itemContext as any);
        await replyMessage(replyToken, [{ type: "text", text: replyText }]);
        return;
      }

      // 2. 直近のメディアログがあるか？
      const recentMedia = await getRecentMediaLog(userId);
      if (recentMedia) {
        // 直近30分以内にメディアを見ている -> その話をしたい可能性が高い
        // ただし挨拶などは除外したいが、Geminiに任せる
        console.log("Found recent media context:", recentMedia.title);

        await logUsage(userId, "media_chat", { title: recentMedia.title });
        const replyText = await chatWithContext(message.text || "", "media", recentMedia);

        await replyMessage(replyToken, [{ type: "text", text: replyText }]);
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
            "・テレビや映画の画面なら → 視聴記録に保存\n" +
            "・売りたいものなら → 出品文作成\n\n" +
            "下のボタンからメニューも開けます👇",
          quickReply: {
            items: [
              {
                type: "action",
                action: { type: "message", label: "≡ メニューを開く", text: "メニュー" }
              },
              {
                type: "action",
                action: { type: "camera", label: "📷 写真を撮る" }
              }
            ]
          }
        },
      ]);
      await logUsage(userId, "message", { text_length: message.text.length });
    } else if (message.type === "image") {
      console.log("Processing image message:", message.id);

      const startTime = Date.now();

      // LINE Loading Animation（処理中インジケータ）を送信
      try {
        const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
        await fetch("https://api.line.me/v2/bot/chat/loading", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ chatId: userId, loadingSeconds: 20 }),
        });
      } catch (e) {
        console.warn("Loading animation failed (non-critical):", e);
      }

      try {
        // ユーザー設定を取得
        const userContext = await getUserContext(userId);

        // 画像を取得
        console.log("Fetching image from LINE...");
        const { base64, mimeType } = await getImageContent(message.id);
        console.log("Image fetched, size:", base64.length, "mimeType:", mimeType);

        // ==================== 出品モードチェック ====================

        // 既存の「5分以内」ルールは、初期画像送信のトリガーとしてのみ使用
        // すでに会話中の場合は、画像を送っても「新しい出品」として扱うか、
        // あるいは「追加画像」として扱うかが問題だが、
        // ここではシンプルに「会話中でも画像が来たら新しい出品解析スタート」とする（リセット）

        const isSellModeStart = await isInSellMode(userId); // "売る" と言ってから5分以内

        if (isSellModeStart) {
          console.log("Sell mode image received. Starting interactive analysis...");

          // LINEの仕様上、replyTokenは1回のみ有効。
          // 先にメッセージを送ると結果を送れなくなるため、何も送らず解析を待つ。
          const analysis = await analyzeProductImage(base64, mimeType, userContext);

          if (analysis) {
            // DBに保存
            const supabase = getSupabaseClient();

            // 既存の進行中があればキャンセル扱いに
            const activeItem = await getActiveSellItem(userId);
            if (activeItem) {
              await updateSellItem(activeItem.id, { status: "cancelled" });
            }

            const dialogueHistory = [
              { role: "assistant", text: analysis.next_question || "これは何ですか？" }
            ];

            await supabase.from("sell_items").insert({
              line_user_id: userId,
              status: "questioning",
              image_summary: analysis.image_summary,
              extracted_info: analysis.extracted_info,
              dialogue_history: dialogueHistory
            });

            await logUsage(userId, "sell_dialogue_start", {
              product: analysis.extracted_info.product_name
            });

            // 最初の質問を送信 (pushメッセージが必要だが、replyTokenは1回しか使えないため、ローディングメッセージを送ってしまった場合はアウト)
            // LINEの仕様上、replyTokenは1往復のみ。
            // 先に "画像を解析しています..." を送ってしまうと、結果を送れない。
            // したがって、解析メッセージは送らず、少し待たせてから結果を送るのが正解。
            // または Loading Animation API を使う。
            // ここではシンプルにするため、上の "解析しています" を削除し、いきなり結果を送る。

            // Re-implement without early reply:
            await replyMessage(replyToken, [
              {
                type: "text",
                text: analysis.next_question || "商品の詳細を教えてください。"
              }
            ]);

          } else {
            await replyMessage(replyToken, [{
              type: "text",
              text: "📦 うまく読み取れませんでした...\n\nもう少し明るい場所で、商品全体が見えるように撮ってみてね！",
            }]);
          }
          return;
        }

        // ==================== 通常フロー（Intent判定） ====================
        // 直近のアクションでモード指定があれば、AI判定をスキップして強制的にIntentを決定
        let intent = "";
        const forcedMediaMode = await isInMediaMode(userId);

        if (forcedMediaMode) {
          console.log("Forcing intent: media (active mode)");
          intent = "media";
        } else if (await isInLedgerMode(userId)) {
          console.log("Forcing intent: ledger (active mode)");
          intent = "ledger";
        } else {
          console.log("Classifying image intent...");
          intent = await classifyImageIntent(base64, mimeType);
        }

        console.log("Image intent:", intent);

        if (intent === "media") {
          // ==================== メディアログフロー（二段階：対話→確定→評価） ====================
          console.log("Processing as media content (two-stage dialogue)...");
          const dialogueState = await identifyMedia(base64, mimeType, userContext);

          if (dialogueState) {
            console.log("Media dialogue started:", dialogueState.visual_clues);

            // 常に対話モードで開始（identifyMediaは常にMediaDialogueStateを返す）
            const supabase = getSupabaseClient();

            // 既存のセッションがあればキャンセル
            const activeItem = await getActiveSellItem(userId);
            if (activeItem) {
              await updateSellItem(activeItem.id, { status: "cancelled" });
            }

            const dialogueHistory = [
              { role: "assistant", text: dialogueState.question }
            ];

            const { error: insertError } = await supabase.from("sell_items").insert({
              line_user_id: userId,
              status: "questioning",
              image_summary: dialogueState.visual_clues,
              extracted_info: {
                type: "media_dialogue",
                visual_clues: dialogueState.visual_clues,
                media_candidate: dialogueState.media_candidate || null,
              },
              dialogue_history: dialogueHistory
            });
            if (insertError) {
              console.error("sell_items insert error:", insertError);
            }

            await logUsage(userId, "media_dialogue_start", {
              has_candidate: !!dialogueState.media_candidate,
            });

            // 質問メッセージを送信
            await replyMessage(replyToken, [{
              type: "text",
              text: "🎬 " + dialogueState.question
            }]);
          } else {
            if (forcedMediaMode) {
              console.warn("identifyMedia returned null during forced media mode");
              await replyMessage(replyToken, [{
                type: "text",
                text: "🎬 うまく作品を読み取れませんでした。\nもう一度、画面全体がはっきり見える写真を送ってください。"
              }]);
            } else {
              // 通常判定時のみ救急箱へフォールバック
              console.log("Media not identified, falling back to help flow");
              await handleHelpImageFlow(replyToken, userId, base64, mimeType, message.id, userContext, startTime);
            }
          }
        } else if (intent === "ledger") {
          // ==================== 台帳特定フロー（最短確認） ====================
          console.log("Processing as ledger content (identify-first)...");
          const ledgerState = await identifyLedgerDocument(base64, mimeType, userContext);

          if (ledgerState) {
            const supabase = getSupabaseClient();

            // 既存のセッションがあればキャンセル
            const activeItem = await getActiveSellItem(userId);
            if (activeItem) {
              await updateSellItem(activeItem.id, { status: "cancelled" });
            }

            const dialogueHistory = [
              { role: "assistant", text: ledgerState.question }
            ];

            const { error: insertError } = await supabase.from("sell_items").insert({
              line_user_id: userId,
              status: "questioning",
              image_summary: ledgerState.document_clues,
              extracted_info: {
                type: "ledger_dialogue",
                document_clues: ledgerState.document_clues,
                ledger_candidate: ledgerState.ledger_candidate || null,
                source_message_id: message.id,
              },
              dialogue_history: dialogueHistory
            });
            if (insertError) {
              console.error("sell_items insert error (ledger):", insertError);
            }

            await replyOrPush(replyToken, userId, [{
              type: "text",
              text: "🧾 " + ledgerState.question
            }]);
          } else {
            await replyOrPush(replyToken, userId, [{
              type: "text",
              text: "🧾 書類の内容をうまく特定できませんでした。\n請求先やサービス名が見える写真でもう一度送ってください。"
            }]);
          }
        } else if (intent === "sell") {
          // ==================== 出品提案フロー ====================
          // 商品っぽいが、"売る"と言っていない場合 -> 確認する
          await replyMessage(replyToken, [{
            type: "template",
            altText: "出品しますか？",
            template: {
              type: "confirm",
              text: "これは商品ですか？\n出品用のタイトルと説明文を作成しますか？",
              actions: [
                { type: "message", label: "はい、出品する", text: "売る" },
                { type: "message", label: "いいえ", text: "いいえ" }
              ]
            }
          }]);
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
    // 沈黙防止: エラー時もユーザーに返信する
    try {
      if (replyToken) {
        await replyMessage(replyToken, [{
          type: "text",
          text: "⚠️ 処理中にエラーが発生しました。\nもう一度試してみてください。"
        }]);
      }
    } catch (replyErr) {
      console.error("Error fallback reply also failed:", replyErr);
    }
  }
}

/**
 * Postbackイベント処理（コピーボタン・Vision結果）
 */
async function handlePostbackEvent(event: LineEvent & { postback?: { data: string } }) {
  const userId = event.source.userId;
  const data = event.postback?.data ?? "";
  const params = new URLSearchParams(data);

  // ボタン連打ガード（同一ユーザー+同一アクションを10秒間ブロック）
  if (isDuplicateAction(userId, data)) {
    console.log("Duplicate action blocked:", userId, data);
    return;
  }

  const action = params.get("action");

  // ==================== メディアログ関連 ====================

  // メディア履歴閲覧 (action=view_media_history)
  if (action === "view_media_history") {
    console.log("Opening media log page for user:", userId);
    const mediaUrl = `https://oyadeki-liff.deno.dev/media/${userId}`;

    await logUsage(userId, "media_list", {});
    if (event.replyToken) {
      await replyMessage(event.replyToken, [{
        type: "text",
        text: `📖 視聴記録はこちら\n${mediaUrl}`,
      }]);
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

  // ==================== メディアログ関連 (評価・スキップ) ====================

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

  // ==================== タスク関連 ====================

  // タスク完了 (action=task_complete)
  if (action === "task_complete") {
    const taskId = params.get("task_id");
    if (!taskId) {
      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "エラー：タスクIDが見つかりません。" }]);
      return;
    }

    const supabase = getSupabaseClient();

    // タスクを完了にする
    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("line_user_id", userId)
      .select("title")
      .single();

    if (updateError) {
      console.error("Task complete error:", updateError);
      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "タスクの完了に失敗しました。" }]);
      return;
    }

    await logUsage(userId, "task_complete", { task_id: taskId });

    // 次のタスクを取得
    const today = new Date().toISOString().split("T")[0];
    const { data: nextTasks } = await supabase
      .from("tasks")
      .select("id, title, note")
      .eq("line_user_id", userId)
      .eq("status", "pending")
      .or(`scheduled_date.is.null,scheduled_date.lte.${today}`)
      .order("priority", { ascending: false })
      .order("sort_order", { ascending: true })
      .limit(1);

    const nextTask = nextTasks?.[0];
    const taskTitle = updatedTask?.title || "タスク";

    if (nextTask) {
      // 次のタスクがある場合
      const flexMessage = {
        type: "flex",
        altText: "ナイス！次のタスク",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: `✅「${taskTitle}」完了！`, weight: "bold", size: "md", color: "#06C755" },
              { type: "separator", margin: "md" },
              { type: "text", text: "次のやること:", size: "xs", color: "#888888", margin: "md" },
              { type: "text", text: nextTask.title, weight: "bold", size: "sm", wrap: true, margin: "sm" },
              ...(nextTask.note ? [{ type: "text", text: nextTask.note, size: "xs", color: "#888888", wrap: true }] : []),
            ],
            paddingAll: "lg",
          },
          footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              {
                type: "button",
                style: "primary",
                color: "#06C755",
                action: {
                  type: "postback",
                  label: "これも完了！",
                  data: `action=task_complete&task_id=${nextTask.id}`,
                  displayText: "完了しました！",
                },
              },
              {
                type: "button",
                style: "link",
                action: {
                  type: "uri",
                  label: "全部見る",
                  uri: `https://oyadeki-liff.deno.dev/tasks/${userId}`,
                },
              },
            ],
            paddingAll: "lg",
          },
        },
      };
      if (event.replyToken) await replyMessage(event.replyToken, [flexMessage]);
    } else {
      // 全て完了
      if (event.replyToken) {
        await replyMessage(event.replyToken, [{
          type: "text",
          text: `🎉「${taskTitle}」完了！\n\n今日のタスクは全部終わりました！\nお疲れさまでした✨`,
        }]);
      }
    }
    return;
  }

  // ==================== 台帳関連（既存） ====================

  // 台帳一覧表示 (action=view_ledger_list)
  if (action === "view_ledger_list") {
    console.log("Fetching ledger for user:", userId);
    const supabase = getSupabaseClient();

    const { data: items, error } = await supabase
      .from("ledgers")
      .select("*")
      .eq("line_user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Ledger fetch error:", error);
      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "エラーが発生しました。時間をおいて試してください。" }]);
      return;
    }

    if (!items || items.length === 0) {
      if (event.replyToken) await replyMessage(event.replyToken, [{
        type: "text",
        text: "📭 台帳はまだ空です。\n\n契約書や請求書の写真を送ると、AIが内容を読み取って登録できますよ！"
      }]);
      return;
    }

    await logUsage(userId, "ledger_list", { count: items.length });

    const total = items.reduce((sum: number, item: any) => sum + (item.monthly_cost || 0), 0);

    const supabase2 = getSupabaseClient();
    const token = generateShareToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await supabase2.from("ledger_shares").insert({
      line_user_id: userId,
      token,
      expires_at: expiresAt.toISOString(),
    });
    const listUrl = `https://oyadeki-liff.deno.dev/share/${token}`;

    if (event.replyToken) await replyMessage(event.replyToken, [{
      type: "text",
      text: `📑 契約台帳\n\n${items.length}件 / 月額合計 ¥${total.toLocaleString()}\n\n👇 タップして一覧を開く\n${listUrl}`
    }]);
    return;
  }

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
    // ユーザー登録があれば取得（なければnull）
    const { data: userCtx } = await supabase.from("user_contexts").select("user_id, storage_locations").eq("line_user_id", userId).single();

    // ユーザー登録がなくても台帳には保存する（line_user_idで紐付け）
    const { data: inserted, error: insertError } = await supabase.from("ledgers").insert({
      user_id: userCtx?.user_id,
      line_user_id: userId,
      service_name: serviceName,
      category,
      monthly_cost: cost,
      status: 'active'
    }).select("id").single();

    if (insertError) {
      console.error("Ledger insert error:", insertError);
      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "台帳の登録に失敗しました。もう一度試してください。" }]);
    } else {
      await logUsage(userId, "ledger_confirm", { service: serviceName });

      const locations: string[] = userCtx?.storage_locations || [];
      if (inserted && locations.length > 0 && event.replyToken) {
        // 保管場所を聞く
        const locationButtons = locations.slice(0, 4).map((loc: string) => ({
          type: "button",
          style: "secondary",
          height: "sm",
          action: {
            type: "postback",
            label: loc.substring(0, 20),
            data: `action=set_storage&id=${inserted.id}&loc=${encodeURIComponent(loc.substring(0, 30))}`,
          },
        }));
        locationButtons.push({
          type: "button",
          style: "link",
          height: "sm",
          action: {
            type: "postback",
            label: "スキップ",
            data: `action=set_storage&id=${inserted.id}&loc=`,
          },
        });

        await replyMessage(event.replyToken, [
          { type: "text", text: `「${serviceName}」を台帳に登録しました！✅` },
          {
            type: "flex",
            altText: "紙はどこにしまいましたか？",
            contents: {
              type: "bubble",
              body: {
                type: "box",
                layout: "vertical",
                spacing: "md",
                contents: [
                  { type: "text", text: "📂 紙はどこにしまいましたか？", weight: "bold", size: "md" },
                  { type: "text", text: "後で探すときに便利です", size: "xs", color: "#888888" },
                ],
              },
              footer: {
                type: "box",
                layout: "vertical",
                spacing: "xs",
                contents: locationButtons,
              },
            },
          },
        ]);
      } else {
        if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: `「${serviceName}」を台帳に登録しました！✅\n\n後でお子さんが確認してくれます。` }]);
      }
    }
    return;
  }

  // 台帳の保管場所設定 (action=set_storage)
  if (action === "set_storage") {
    const ledgerId = params.get("id");
    const location = decodeURIComponent(params.get("loc") || "");

    if (ledgerId && location) {
      const supabase = getSupabaseClient();
      await supabase
        .from("ledgers")
        .update({ storage_location: location })
        .eq("id", ledgerId)
        .eq("line_user_id", userId);

      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: `📂「${location}」に保管ですね。記録しました！\n\n後でお子さんが確認してくれます。` }]);
    } else {
      if (event.replyToken) await replyMessage(event.replyToken, [{ type: "text", text: "👌 スキップしました。\n\n後でお子さんが確認してくれます。" }]);
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
      // 重複排除（LINE webhookEventId or fallback）
      const eventId = event.webhookEventId || `${event.source?.userId}-${event.timestamp}`;
      if (isDuplicate(eventId)) {
        console.log("Duplicate event, skipping:", eventId);
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
