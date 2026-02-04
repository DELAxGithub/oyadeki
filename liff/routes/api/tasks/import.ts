import { Handlers } from "$fresh/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface ImportTask {
  title: string;
  note?: string;
  project?: string;
  phase?: string;
  category?: string;
  assignee?: string;
  due_date?: string;
  scheduled_date?: string;
  priority?: number;
  sort_order?: number;
}

interface ImportRequest {
  line_user_id: string;
  tasks: ImportTask[];
  // オプション: 既存タスクをクリアしてからインポート
  clear_existing?: boolean;
  // オプション: 特定プロジェクトのみクリア
  clear_project?: string;
}

export const handler: Handlers = {
  /**
   * POST: タスク一括インポート
   */
  async POST(req) {
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    let body: ImportRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const { line_user_id, tasks, clear_existing, clear_project } = body;

    if (!line_user_id || line_user_id.length < 10) {
      return new Response(
        JSON.stringify({ error: "Invalid line_user_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return new Response(
        JSON.stringify({ error: "tasks array is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 最大500件まで
    if (tasks.length > 500) {
      return new Response(
        JSON.stringify({ error: "Maximum 500 tasks per import" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 既存タスクのクリア（オプション）
    if (clear_existing) {
      let deleteQuery = supabase
        .from("tasks")
        .delete()
        .eq("line_user_id", line_user_id);

      if (clear_project) {
        deleteQuery = deleteQuery.eq("project", clear_project);
      }

      const { error: deleteError } = await deleteQuery;
      if (deleteError) {
        console.error("Error clearing tasks:", deleteError);
        return new Response(
          JSON.stringify({ error: "Failed to clear existing tasks" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    // バリデーション & 変換
    const errors: { index: number; error: string }[] = [];
    const validTasks: Record<string, unknown>[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];

      if (!t.title || typeof t.title !== "string" || t.title.trim() === "") {
        errors.push({ index: i, error: "title is required" });
        continue;
      }

      // 日付フォーマット検証
      if (t.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(t.due_date)) {
        errors.push({ index: i, error: "due_date must be YYYY-MM-DD format" });
        continue;
      }
      if (t.scheduled_date && !/^\d{4}-\d{2}-\d{2}$/.test(t.scheduled_date)) {
        errors.push({
          index: i,
          error: "scheduled_date must be YYYY-MM-DD format",
        });
        continue;
      }

      validTasks.push({
        line_user_id,
        title: t.title.trim(),
        note: t.note?.trim() || null,
        project: t.project?.trim() || null,
        phase: t.phase?.trim() || null,
        category: t.category?.trim() || null,
        assignee: t.assignee?.trim() || null,
        due_date: t.due_date || null,
        scheduled_date: t.scheduled_date || null,
        priority: typeof t.priority === "number" ? t.priority : 0,
        sort_order: typeof t.sort_order === "number" ? t.sort_order : i,
        status: "pending",
      });
    }

    if (validTasks.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No valid tasks to import",
          errors,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 一括挿入
    const { data, error } = await supabase
      .from("tasks")
      .insert(validTasks)
      .select("id");

    if (error) {
      console.error("Error inserting tasks:", error);
      return new Response(
        JSON.stringify({ error: "Failed to insert tasks" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        imported: data?.length || 0,
        skipped: errors.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  },
};
