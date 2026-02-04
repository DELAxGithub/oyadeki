import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const LINE_API_BASE = "https://api.line.me/v2/bot";
const LIFF_BASE_URL = "https://oyadeki-liff.deno.dev";

interface TaskItem {
  id: string;
  title: string;
  note: string | null;
  phase: string | null;
  project: string | null;
}

interface UserTasks {
  line_user_id: string;
  tasks: TaskItem[];
  totalPending: number;
}

/**
 * LINE Push APIでメッセージ送信
 */
async function pushMessage(userId: string, messages: unknown[]) {
  const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
  const resp = await fetch(`${LINE_API_BASE}/message/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ to: userId, messages }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`Push failed for ${userId}:`, resp.status, errText);
    throw new Error(`LINE push failed: ${resp.status}`);
  }
}

/**
 * 日次タスク配信用 Flex Message
 */
function buildDailyTaskFlexMessage(data: UserTasks) {
  const { tasks, totalPending, line_user_id } = data;

  // タスクごとのボックス
  const taskBoxes = tasks.map((task, idx) => ({
    type: "box",
    layout: "horizontal",
    contents: [
      {
        type: "text",
        text: `${idx + 1}.`,
        size: "sm",
        color: "#06C755",
        flex: 0,
      },
      {
        type: "box",
        layout: "vertical",
        flex: 1,
        paddingStart: "md",
        contents: [
          {
            type: "text",
            text: task.title,
            size: "sm",
            weight: "bold",
            wrap: true,
          },
          ...(task.note
            ? [
                {
                  type: "text",
                  text: task.note,
                  size: "xs",
                  color: "#888888",
                  wrap: true,
                },
              ]
            : []),
        ],
      },
    ],
    paddingBottom: "md",
  }));

  // 残りタスク数
  const remaining = totalPending - tasks.length;

  return {
    type: "flex",
    altText: `今日のやること（${tasks.length}件）`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "☀️ 今日のやること",
            weight: "bold",
            size: "lg",
            color: "#1A1A1A",
          },
          ...(tasks[0]?.phase
            ? [
                {
                  type: "text",
                  text: tasks[0].phase,
                  size: "xs",
                  color: "#888888",
                },
              ]
            : []),
        ],
        backgroundColor: "#F5F5F5",
        paddingAll: "lg",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          ...taskBoxes,
          ...(remaining > 0
            ? [
                {
                  type: "text",
                  text: `...他 ${remaining}件`,
                  size: "xs",
                  color: "#888888",
                  align: "end",
                },
              ]
            : []),
        ],
        paddingAll: "lg",
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#06C755",
            action: {
              type: "postback",
              label: "1つ完了！",
              data: `action=task_complete&task_id=${tasks[0]?.id || ""}`,
              displayText: "完了しました！",
            },
          },
          {
            type: "button",
            style: "secondary",
            action: {
              type: "uri",
              label: "全部見る",
              uri: `${LIFF_BASE_URL}/tasks/${line_user_id}`,
            },
          },
        ],
        paddingAll: "lg",
      },
    },
  };
}

/**
 * タスクがないユーザー向けメッセージ
 */
function buildNoTaskMessage() {
  return {
    type: "text",
    text: "☀️ おはようございます！\n\n今日のタスクはありません。ゆっくり過ごしてくださいね。",
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

    console.log("Daily task push started");

    // 今日配信すべきタスクを持つユーザーを取得
    // scheduled_date が今日以前、または NULL のpendingタスク
    const today = new Date().toISOString().split("T")[0];

    const { data: allTasks, error } = await supabase
      .from("tasks")
      .select("id, line_user_id, title, note, phase, project, priority")
      .eq("status", "pending")
      .or(`scheduled_date.is.null,scheduled_date.lte.${today}`)
      .order("priority", { ascending: false })
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("Error fetching tasks:", error);
      return new Response(JSON.stringify({ error: "Failed to fetch tasks" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!allTasks || allTasks.length === 0) {
      console.log("No pending tasks found");
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ユーザーごとにグループ化
    const userTasksMap = new Map<string, TaskItem[]>();
    for (const task of allTasks) {
      const userId = task.line_user_id;
      if (!userTasksMap.has(userId)) {
        userTasksMap.set(userId, []);
      }
      userTasksMap.get(userId)!.push(task);
    }

    console.log(`Found ${userTasksMap.size} users with pending tasks`);

    let sentCount = 0;
    for (const [userId, tasks] of userTasksMap) {
      try {
        // 上位3件を配信
        const topTasks = tasks.slice(0, 3);
        const userTaskData: UserTasks = {
          line_user_id: userId,
          tasks: topTasks,
          totalPending: tasks.length,
        };

        await pushMessage(userId, [buildDailyTaskFlexMessage(userTaskData)]);
        sentCount++;

        // ログ記録
        await supabase.from("usage_logs").insert({
          line_user_id: userId,
          action_type: "task_daily_push",
          meta: {
            task_count: topTasks.length,
            total_pending: tasks.length,
          },
        });

        console.log(`Sent daily tasks to ${userId}: ${topTasks.length} tasks`);

        // レート制限対策
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (pushError) {
        console.error(`Failed to send to ${userId}:`, pushError);
      }
    }

    console.log(`Daily task push completed: ${sentCount}/${userTasksMap.size} sent`);

    return new Response(
      JSON.stringify({
        success: true,
        sent: sentCount,
        total: userTasksMap.size,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Daily task push error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
