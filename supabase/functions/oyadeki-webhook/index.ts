import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { verifySignature } from "../_shared/line-signature.ts";
import { isDuplicate } from "../_shared/dedup.ts";
import { logUsage } from "../_shared/supabase-client.ts";
import { generateText } from "../_shared/gemini-client.ts";

const LINE_API_BASE = "https://api.line.me/v2/bot";
const TIMEOUT_MS = 3000;

interface LineEvent {
  type: string;
  replyToken?: string;
  source: { userId: string };
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
 * 下書き生成プロンプト
 */
function buildDraftPrompt(userText: string): string {
  return `あなたは親子コミュニケーションを支援するアシスタントです。
以下のメッセージに対して、親が子どもに送る返信の下書きを3案作成してください。

【ルール】
- 各案は80字以内
- 文頭に【AI下書き】をつけない（後で追加します）
- 代理送信ではなく「こう書いたらどうですか？」という提案
- メタファーは最大1つまで
- 最後に1つ「開かれた質問」を提案
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
 * メッセージイベント処理
 */
async function handleMessageEvent(event: LineEvent) {
  const userId = event.source.userId;
  const replyToken = event.replyToken!;
  const message = event.message!;

  console.log("handleMessageEvent called:", { userId, messageType: message.type });

  try {
    if (message.type === "text" && message.text) {
      console.log("Processing text message:", message.text);

      const startTime = Date.now();
      const draftId = crypto.randomUUID();

      try {
        const prompt = buildDraftPrompt(message.text);
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
        await replyMessage(replyToken, [
          { type: "text", text: "申し訳ありません、エラーが発生しました。もう一度お試しください。" },
        ]);
      }
    } else if (message.type === "image") {
      await replyMessage(replyToken, [
        { type: "text", text: "画像機能は準備中です。" },
      ]);
    }
  } catch (error) {
    console.error("handleMessageEvent error:", error);
  }
}

/**
 * Postbackイベント処理（コピーボタン）
 */
async function handlePostbackEvent(event: LineEvent & { postback?: { data: string } }) {
  const userId = event.source.userId;
  const data = event.postback?.data ?? "";
  const params = new URLSearchParams(data);
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

    // 署名検証（本番有効）
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
