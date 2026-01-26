import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const LINE_API_BASE = "https://api.line.me/v2/bot";

interface UserLedgerSummary {
  line_user_id: string;
  total_count: number;
  unconfirmed_count: number;
  total_monthly_cost: number;
}

/**
 * LINE Push APIでメッセージ送信
 */
async function pushMessage(userId: string, messages: unknown[]) {
  const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
  await fetch(`${LINE_API_BASE}/message/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ to: userId, messages }),
  });
}

/**
 * 週報用Flex Message
 */
function buildWeeklyReportFlexMessage(summary: UserLedgerSummary) {
  const hasUnconfirmed = summary.unconfirmed_count > 0;

  const contents: unknown[] = [
    { type: "text", text: "📊 週間レポート", weight: "bold", size: "lg" },
    { type: "separator", margin: "md" },
    {
      type: "box",
      layout: "vertical",
      margin: "md",
      spacing: "sm",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "登録件数", size: "sm", color: "#888888", flex: 4 },
            { type: "text", text: `${summary.total_count}件`, size: "sm", align: "end", flex: 5 },
          ],
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "月額合計", size: "sm", color: "#888888", flex: 4 },
            { type: "text", text: `¥${summary.total_monthly_cost.toLocaleString()}`, size: "sm", align: "end", flex: 5, weight: "bold" },
          ],
        },
      ],
    },
  ];

  // 未確認がある場合は警告表示
  if (hasUnconfirmed) {
    contents.push({ type: "separator", margin: "md" });
    contents.push({
      type: "box",
      layout: "vertical",
      margin: "md",
      backgroundColor: "#FFF3E0",
      cornerRadius: "md",
      paddingAll: "md",
      contents: [
        { type: "text", text: `⚠️ 未確認: ${summary.unconfirmed_count}件`, weight: "bold", size: "sm", color: "#E65100" },
        { type: "text", text: "1週間以上確認していない契約があります", size: "xs", color: "#E65100", wrap: true },
      ],
    });
  } else {
    contents.push({ type: "separator", margin: "md" });
    contents.push({
      type: "box",
      layout: "vertical",
      margin: "md",
      backgroundColor: "#E8F5E9",
      cornerRadius: "md",
      paddingAll: "md",
      contents: [
        { type: "text", text: "✅ すべて確認済み", weight: "bold", size: "sm", color: "#2E7D32" },
      ],
    });
  }

  return {
    type: "flex",
    altText: hasUnconfirmed ? `⚠️ 週間レポート: 未確認${summary.unconfirmed_count}件` : "📊 週間レポート",
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
            type: "button",
            style: hasUnconfirmed ? "primary" : "secondary",
            action: {
              type: "message",
              label: "台帳を確認する",
              text: "台帳",
            },
          },
        ],
      },
    },
  };
}

serve(async (req) => {
  // CORS対応
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Weekly ledger report started");

    // 未確認台帳ビューから対象ユーザーを取得（5件以上のユーザーのみ）
    const { data: summaries, error } = await supabase
      .from("unconfirmed_ledgers")
      .select("*")
      .gte("total_count", 5);

    if (error) {
      console.error("Error fetching summaries:", error);
      return new Response(JSON.stringify({ error: "Failed to fetch summaries" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!summaries || summaries.length === 0) {
      console.log("No users with 5+ ledgers found");
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${summaries.length} users with 5+ ledgers`);

    let sentCount = 0;
    for (const summary of summaries as UserLedgerSummary[]) {
      try {
        await pushMessage(summary.line_user_id, [buildWeeklyReportFlexMessage(summary)]);
        sentCount++;
        console.log(`Sent report to ${summary.line_user_id}`);

        // レート制限を考慮して少し待機
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (pushError) {
        console.error(`Failed to send to ${summary.line_user_id}:`, pushError);
      }
    }

    console.log(`Weekly report completed: ${sentCount}/${summaries.length} sent`);

    return new Response(JSON.stringify({ success: true, sent: sentCount, total: summaries.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Weekly report error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
