import { Handlers } from "$fresh/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export const handler: Handlers = {
  async GET(_req, ctx) {
    const { token } = ctx.params;

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 共有レコードを取得
    const { data: share, error: shareError } = await supabase
      .from("ledger_shares")
      .select("*")
      .eq("token", token)
      .single();

    if (shareError || !share) {
      return new Response(
        JSON.stringify({ error: "共有リンクが見つかりません" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 有効期限チェック
    if (new Date(share.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "この共有リンクは有効期限切れです" }),
        {
          status: 410,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 台帳を取得
    const { data: ledgers, error: ledgerError } = await supabase
      .from("ledgers")
      .select(
        "id, service_name, category, account_identifier, monthly_cost, note, last_confirmed_at, created_at",
      )
      .eq("line_user_id", share.line_user_id)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (ledgerError) {
      return new Response(
        JSON.stringify({ error: "台帳の取得に失敗しました" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // アクセスカウントを更新
    await supabase
      .from("ledger_shares")
      .update({ accessed_count: (share.accessed_count || 0) + 1 })
      .eq("id", share.id);

    // アクセスログを記録
    await supabase.from("share_access_logs").insert({
      share_id: share.id,
      accessed_at: new Date().toISOString(),
    });

    // 合計金額を計算
    const totalMonthlyCost =
      ledgers?.reduce((sum, item) => sum + (item.monthly_cost || 0), 0) || 0;

    return new Response(
      JSON.stringify({
        ledgers: ledgers || [],
        totalMonthlyCost,
        expiresAt: share.expires_at,
        accessedCount: share.accessed_count + 1,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  },
};
