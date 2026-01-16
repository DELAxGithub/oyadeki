import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

/**
 * Supabaseサービスロールクライアント
 * Edge Functionsからのみ使用（RLSバイパス）
 */
export function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * 利用ログを記録
 */
export async function logUsage(
  lineUserId: string,
  actionType: string,
  meta: Record<string, unknown> = {}
) {
  const supabase = getSupabaseClient();
  await supabase.from("usage_logs").insert({
    line_user_id: lineUserId,
    action_type: actionType,
    meta,
  });
}
