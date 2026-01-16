import { Handlers } from "$fresh/server.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const handler: Handlers = {
  /**
   * GET: ユーザー設定を取得
   */
  async GET(req) {
    const url = new URL(req.url);
    const lineUserId = url.searchParams.get("line_user_id");

    if (!lineUserId) {
      return new Response(JSON.stringify({ error: "line_user_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("user_contexts")
      .select("*")
      .eq("line_user_id", lineUserId)
      .single();

    if (error) {
      return new Response(JSON.stringify(null), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  },

  /**
   * POST: ユーザー設定を更新
   */
  async POST(req) {
    const body = await req.json();
    const { line_user_id, ...updates } = body;

    if (!line_user_id) {
      return new Response(JSON.stringify({ error: "line_user_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabase();

    // upsert: 存在しなければ作成
    const { error } = await supabase
      .from("user_contexts")
      .upsert(
        { line_user_id, ...updates },
        { onConflict: "line_user_id" }
      );

    if (error) {
      console.error("Error updating user context:", error);
      return new Response(JSON.stringify({ error: "Update failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
