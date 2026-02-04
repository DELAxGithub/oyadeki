import { Handlers } from "$fresh/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface TaskItem {
  id: string;
  title: string;
  note: string | null;
  project: string | null;
  phase: string | null;
  category: string | null;
  assignee: string | null;
  status: string;
  due_date: string | null;
  scheduled_date: string | null;
  priority: number;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
}

export const handler: Handlers = {
  /**
   * GET: タスク一覧取得
   * Query params:
   *   - status: 'pending' | 'done' | 'all' (default: 'all')
   *   - project: string (filter by project)
   *   - phase: string (filter by phase)
   *   - limit: number (default: 100)
   *   - offset: number (default: 0)
   */
  async GET(req, ctx) {
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

    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "all";
    const project = url.searchParams.get("project");
    const phase = url.searchParams.get("phase");
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let query = supabase
      .from("tasks")
      .select("*", { count: "exact" })
      .eq("line_user_id", userId);

    // ステータスフィルタ
    if (status === "pending") {
      query = query.in("status", ["pending", "in_progress"]);
    } else if (status === "done") {
      query = query.in("status", ["done", "skipped"]);
    }
    // 'all' の場合はフィルタなし

    // プロジェクト・フェーズフィルタ
    if (project) {
      query = query.eq("project", project);
    }
    if (phase) {
      query = query.eq("phase", phase);
    }

    // ソート: priority DESC, sort_order ASC, created_at ASC
    query = query
      .order("priority", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);

    const { data: items, error, count } = await query;

    if (error) {
      console.error("Error fetching tasks:", error);
      return new Response(
        JSON.stringify({ error: "データの取得に失敗しました" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const tasks = (items || []) as TaskItem[];

    // 集計
    const { data: statsData } = await supabase
      .from("tasks")
      .select("status, project, phase")
      .eq("line_user_id", userId);

    const stats = statsData || [];
    const totalCount = stats.length;
    const doneCount = stats.filter((t) =>
      t.status === "done" || t.status === "skipped"
    ).length;
    const pendingCount = totalCount - doneCount;

    // プロジェクト一覧
    const projects = [...new Set(stats.map((t) => t.project).filter(Boolean))];

    // フェーズ別カウント
    const phaseCounts: Record<string, { total: number; done: number }> = {};
    for (const t of stats) {
      const p = t.phase || "(未分類)";
      if (!phaseCounts[p]) {
        phaseCounts[p] = { total: 0, done: 0 };
      }
      phaseCounts[p].total++;
      if (t.status === "done" || t.status === "skipped") {
        phaseCounts[p].done++;
      }
    }

    return new Response(
      JSON.stringify({
        items: tasks,
        totalCount,
        doneCount,
        pendingCount,
        projects,
        phaseCounts,
        pagination: {
          limit,
          offset,
          hasMore: (count || 0) > offset + limit,
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  },

  /**
   * PATCH: タスク更新（ステータス変更など）
   * Body: { id: string, updates: Partial<Task> }
   */
  async PATCH(req, ctx) {
    const { userId } = ctx.params;

    if (!userId || userId.length < 10) {
      return new Response(
        JSON.stringify({ error: "Invalid user ID" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { id, updates } = body;

    if (!id || !updates) {
      return new Response(
        JSON.stringify({ error: "id and updates required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // completed_at を自動設定
    const patchData = { ...updates };
    if (updates.status === "done" && !updates.completed_at) {
      patchData.completed_at = new Date().toISOString();
    } else if (updates.status === "pending") {
      patchData.completed_at = null;
    }

    const { data, error } = await supabase
      .from("tasks")
      .update(patchData)
      .eq("id", id)
      .eq("line_user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating task:", error);
      return new Response(
        JSON.stringify({ error: "更新に失敗しました" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, task: data }),
      { headers: { "Content-Type": "application/json" } },
    );
  },

  /**
   * DELETE: タスク削除
   * Query: ?id=<task_id>
   */
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
      .from("tasks")
      .delete()
      .eq("id", itemId)
      .eq("line_user_id", userId);

    if (error) {
      console.error("Error deleting task:", error);
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
