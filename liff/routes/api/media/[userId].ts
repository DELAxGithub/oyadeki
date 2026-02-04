import { Handlers } from "$fresh/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export const handler: Handlers = {
  async GET(_req, ctx) {
    const { userId } = ctx.params;

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!userId || userId.length < 10) {
      return new Response(
        JSON.stringify({ error: "Invalid user ID" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: items, error } = await supabase
      .from("media_logs")
      .select("id, media_type, title, subtitle, artist_or_cast, year, rating, watched_at, image_url")
      .eq("line_user_id", userId)
      .order("watched_at", { ascending: false });

    if (error) {
      return new Response(
        JSON.stringify({ error: "データの取得に失敗しました" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const logs = items || [];

    // メディアタイプ別カウント
    const typeCounts: Record<string, number> = {};
    for (const item of logs) {
      typeCounts[item.media_type] = (typeCounts[item.media_type] || 0) + 1;
    }

    return new Response(
      JSON.stringify({
        items: logs,
        totalCount: logs.length,
        typeCounts,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  },

  async DELETE(req, ctx) {
    const { userId } = ctx.params;
    const url = new URL(req.url);
    const itemId = url.searchParams.get("id");

    if (!userId || !itemId) {
      return new Response(
        JSON.stringify({ error: "userId and id required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error } = await supabase
      .from("media_logs")
      .delete()
      .eq("id", itemId)
      .eq("line_user_id", userId);

    if (error) {
      return new Response(
        JSON.stringify({ error: "削除に失敗しました" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { "Content-Type": "application/json" } },
    );
  },
};
