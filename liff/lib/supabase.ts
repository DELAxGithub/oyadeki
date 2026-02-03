import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

let client: SupabaseClient | null = null;

/**
 * Supabaseクライアント取得（anon key使用）
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

/**
 * ユーザー設定の型
 */
export interface UserContext {
  user_id: string;
  line_user_id: string | null;
  metaphor_theme: string;
  metaphor_enabled: boolean;
  tone: string;
  disliked_phrases: string[];
  timezone: string;
  consented_at: string | null;
  settings_version: number;
  updated_at: string;
}

/**
 * ユーザー設定を取得
 */
export async function getUserContext(
  lineUserId: string,
): Promise<UserContext | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("user_contexts")
    .select("*")
    .eq("line_user_id", lineUserId)
    .single();

  if (error) {
    console.error("Error fetching user context:", error);
    return null;
  }
  return data;
}

/**
 * ユーザー設定を更新
 */
export async function updateUserContext(
  lineUserId: string,
  updates: Partial<UserContext>,
): Promise<boolean> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("user_contexts")
    .update(updates)
    .eq("line_user_id", lineUserId);

  if (error) {
    console.error("Error updating user context:", error);
    return false;
  }
  return true;
}
