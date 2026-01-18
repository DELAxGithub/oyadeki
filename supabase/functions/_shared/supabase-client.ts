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

/**
 * ユーザー設定を取得
 */
export interface UserContext {
  line_user_id: string;
  metaphor_theme?: string;
  metaphor_enabled?: boolean;
  tone?: string;
  disliked_phrases?: string[];
  consented_at?: string;
}

export async function getUserContext(lineUserId: string): Promise<UserContext | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("user_contexts")
    .select("*")
    .eq("line_user_id", lineUserId)
    .single();

  if (error || !data) {
    return null;
  }
  return data as UserContext;
}
