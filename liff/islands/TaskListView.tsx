import { useEffect, useRef, useState } from "preact/hooks";

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
  completed_at: string | null;
  created_at: string;
}

interface TaskData {
  items: TaskItem[];
  totalCount: number;
  doneCount: number;
  pendingCount: number;
  projects: string[];
  phaseCounts: Record<string, { total: number; done: number }>;
}

interface TaskListViewProps {
  userId: string;
}

const statusEmoji: Record<string, string> = {
  pending: "⬜",
  in_progress: "🔄",
  done: "✅",
  skipped: "⏭️",
};

export default function TaskListView({ userId }: TaskListViewProps) {
  const [data, setData] = useState<TaskData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [editingNote, setEditingNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // フィルタ状態
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "done">(
    "all",
  );
  const [phaseFilter, setPhaseFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (phaseFilter) params.set("phase", phaseFilter);
      if (projectFilter) params.set("project", projectFilter);

      const res = await fetch(`/api/tasks/${userId}?${params}`);
      if (!res.ok) {
        const errData = await res.json();
        setError(errData.error || "エラーが発生しました");
        return;
      }
      const taskData = await res.json();
      setData(taskData);
    } catch (_e) {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Mock data for testing
    if (userId === "mock-user" || userId.startsWith("mock-")) {
      setData({
        items: [
          {
            id: "1",
            title: "電気の検針票を探す",
            note: "見つけたら写真を撮って送る",
            project: "ライフライン棚卸し",
            phase: "電気・ガス・水道",
            category: null,
            assignee: "お父さん",
            status: "done",
            due_date: "2026-02-07",
            scheduled_date: "2026-02-05",
            priority: 10,
            completed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          },
          {
            id: "2",
            title: "ガスの請求書を確認",
            note: "同じ棚にあるかも",
            project: "ライフライン棚卸し",
            phase: "電気・ガス・水道",
            category: null,
            assignee: "お父さん",
            status: "pending",
            due_date: "2026-02-07",
            scheduled_date: "2026-02-05",
            priority: 9,
            completed_at: null,
            created_at: new Date().toISOString(),
          },
          {
            id: "3",
            title: "水道の契約番号をメモ",
            note: "検針票の右上に記載",
            project: "ライフライン棚卸し",
            phase: "電気・ガス・水道",
            category: null,
            assignee: "お父さん",
            status: "pending",
            due_date: null,
            scheduled_date: "2026-02-06",
            priority: 8,
            completed_at: null,
            created_at: new Date().toISOString(),
          },
          {
            id: "4",
            title: "スマホの契約内容を確認",
            note: null,
            project: "ライフライン棚卸し",
            phase: "通信・放送",
            category: null,
            assignee: "お父さん",
            status: "pending",
            due_date: null,
            scheduled_date: null,
            priority: 5,
            completed_at: null,
            created_at: new Date().toISOString(),
          },
          {
            id: "5",
            title: "NHKの契約を確認",
            note: null,
            project: "ライフライン棚卸し",
            phase: "通信・放送",
            category: null,
            assignee: "お父さん",
            status: "pending",
            due_date: null,
            scheduled_date: null,
            priority: 4,
            completed_at: null,
            created_at: new Date().toISOString(),
          },
        ],
        totalCount: 5,
        doneCount: 1,
        pendingCount: 4,
        projects: ["ライフライン棚卸し"],
        phaseCounts: {
          "電気・ガス・水道": { total: 3, done: 1 },
          "通信・放送": { total: 2, done: 0 },
        },
      });
      setLoading(false);
      return;
    }

    fetchData();
  }, [userId, statusFilter, phaseFilter, projectFilter]);

  const handleToggle = async (task: TaskItem) => {
    const newStatus = task.status === "done" ? "pending" : "done";
    setUpdating(task.id);

    try {
      const res = await fetch(`/api/tasks/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: task.id,
          updates: { status: newStatus },
        }),
      });

      if (res.ok && data) {
        // ローカル更新
        const updatedItems = data.items.map((t) =>
          t.id === task.id
            ? {
              ...t,
              status: newStatus,
              completed_at: newStatus === "done"
                ? new Date().toISOString()
                : null,
            }
            : t
        );
        const newDone = updatedItems.filter((t) =>
          t.status === "done" || t.status === "skipped"
        ).length;
        setData({
          ...data,
          items: updatedItems,
          doneCount: newDone,
          pendingCount: data.totalCount - newDone,
        });
      }
    } catch (_e) {
      alert("更新に失敗しました");
    } finally {
      setUpdating(null);
    }
  };

  const openDetail = (task: TaskItem) => {
    setSelectedTask(task);
    setEditingNote(task.note || "");
  };

  const handleSaveNote = async () => {
    if (!selectedTask || !data) return;
    const newNote = editingNote.trim() || null;
    if (newNote === (selectedTask.note || null)) return;

    setSavingNote(true);
    try {
      const res = await fetch(`/api/tasks/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedTask.id,
          updates: { note: newNote },
        }),
      });

      if (res.ok) {
        const updatedItems = data.items.map((t) =>
          t.id === selectedTask.id ? { ...t, note: newNote } : t
        );
        setData({ ...data, items: updatedItems });
        setSelectedTask({ ...selectedTask, note: newNote });
      }
    } catch (_e) {
      alert("保存に失敗しました");
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) {
    return (
      <div class="flex flex-col gap-4 items-center justify-center min-h-screen bg-background-muted">
        <div class="animate-spin w-10 h-10 border-4 border-gray-200 border-t-primary rounded-full">
        </div>
        <p class="text-gray-500 font-medium">読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div class="flex flex-col gap-4 items-center justify-center min-h-screen bg-background-muted p-6 text-center">
        <div class="text-4xl">⚠️</div>
        <h2 class="text-xl font-bold text-gray-800">エラー</h2>
        <p class="text-gray-500">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  if (data.totalCount === 0) {
    return (
      <div class="flex flex-col gap-4 items-center justify-center min-h-screen bg-background-muted p-6 text-center">
        <div class="text-5xl">📋</div>
        <h2 class="text-lg font-bold text-gray-800">タスクがありません</h2>
        <p class="text-gray-500 text-sm">
          タスクをインポートすると
          <br />
          ここに表示されます
        </p>
      </div>
    );
  }

  // フェーズ別にグループ化
  const grouped: Record<string, TaskItem[]> = {};
  for (const item of data.items) {
    const key = item.phase || "(未分類)";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }

  // 進捗率
  const progressPercent = data.totalCount > 0
    ? Math.round((data.doneCount / data.totalCount) * 100)
    : 0;

  // フェーズ一覧（フィルタ用）
  const phases = Object.keys(data.phaseCounts);

  return (
    <div class="min-h-screen bg-background-muted font-sans pb-12">
      <div class="max-w-2xl mx-auto p-4 space-y-4">
        {/* Header */}
        <div class="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div class="flex items-center justify-center gap-2 mb-2">
            <span class="text-2xl">📋</span>
            <h1 class="text-lg font-bold text-gray-800">
              {projectFilter || data.projects[0] || "タスク一覧"}
            </h1>
          </div>

          {/* 進捗バー */}
          <div class="my-4">
            <div class="flex justify-between text-sm text-gray-500 mb-1">
              <span>進捗</span>
              <span>
                {data.doneCount} / {data.totalCount} 完了
              </span>
            </div>
            <div class="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                class="h-full bg-primary transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              >
              </div>
            </div>
            <div class="text-center mt-1">
              <span class="text-2xl font-bold text-primary">
                {progressPercent}%
              </span>
            </div>
          </div>

          {/* フェーズ別バッジ */}
          <div class="flex flex-wrap justify-center gap-2">
            {Object.entries(data.phaseCounts).map(([phase, counts]) => (
              <span
                key={phase}
                class="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 rounded-full text-xs font-medium text-gray-700"
              >
                {phase} {counts.done}/{counts.total}
              </span>
            ))}
          </div>
        </div>

        {/* プロジェクト切替 */}
        {data.projects.length > 1 && (
          <select
            value={projectFilter || ""}
            onChange={(e) => {
              setProjectFilter((e.target as HTMLSelectElement).value || null);
              setPhaseFilter(null);
            }}
            class="w-full px-4 py-3 text-sm font-medium rounded-xl border border-gray-200 bg-white text-gray-800"
          >
            <option value="">全プロジェクト ({data.totalCount}件)</option>
            {data.projects.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}

        {/* フィルタ */}
        <div class="flex gap-2 flex-wrap">
          {/* ステータスフィルタ */}
          <div class="flex rounded-lg overflow-hidden border border-gray-200 bg-white">
            {(["all", "pending", "done"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                class={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-primary text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {s === "all" ? "全て" : s === "pending" ? "未完了" : "完了"}
              </button>
            ))}
          </div>

          {/* フェーズフィルタ */}
          {phases.length > 1 && (
            <select
              value={phaseFilter || ""}
              onChange={(e) =>
                setPhaseFilter(
                  (e.target as HTMLSelectElement).value || null,
                )}
              class="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white text-gray-600"
            >
              <option value="">全フェーズ</option>
              {phases.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* グループ別リスト */}
        {Object.entries(grouped).map(([phase, items]) => (
          <div key={phase}>
            <div class="flex items-center gap-2 mb-2 mt-4">
              <div class="h-px flex-1 bg-gray-300"></div>
              <span class="text-xs font-bold text-gray-500 px-2">
                {phase}
                <span class="ml-1 font-normal">
                  ({items.filter((t) => t.status === "done").length}/
                  {items.length})
                </span>
              </span>
              <div class="h-px flex-1 bg-gray-300"></div>
            </div>

            <div class="space-y-2">
              {items.map((task) => {
                const isDone =
                  task.status === "done" || task.status === "skipped";
                const emoji = statusEmoji[task.status] || "⬜";

                return (
                  <div
                    key={task.id}
                    class={`bg-white rounded-xl border p-4 shadow-sm transition-all cursor-pointer active:scale-[0.98] ${
                      isDone
                        ? "border-gray-100 opacity-60"
                        : "border-gray-200"
                    }`}
                    onClick={() => openDetail(task)}
                  >
                    <div class="flex items-start gap-3">
                      {/* チェックボックス */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggle(task);
                        }}
                        disabled={updating === task.id}
                        class="text-xl mt-0.5 hover:scale-110 transition-transform disabled:opacity-50"
                      >
                        {updating === task.id ? "⏳" : emoji}
                      </button>

                      <div class="flex-1 min-w-0">
                        <h3
                          class={`font-bold leading-tight ${
                            isDone
                              ? "text-gray-400 line-through"
                              : "text-gray-800"
                          }`}
                        >
                          {task.title}
                        </h3>
                        {task.note && (
                          <p class="text-xs text-gray-500 mt-0.5 truncate">
                            {task.note}
                          </p>
                        )}
                        <div class="flex items-center gap-2 mt-1.5 flex-wrap">
                          {task.assignee && (
                            <span class="text-[11px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                              👤 {task.assignee}
                            </span>
                          )}
                          {task.due_date && (
                            <span class="text-[11px] text-gray-400">
                              📅 {task.due_date}
                            </span>
                          )}
                          {task.scheduled_date && (
                            <span class="text-[11px] text-gray-400">
                              🔔 {task.scheduled_date}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 優先度バッジ */}
                      {task.priority > 5 && (
                        <span class="text-xs px-1.5 py-0.5 bg-red-50 text-red-500 rounded font-medium">
                          優先
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div class="mt-8 text-center">
          <p class="text-xs text-gray-400">Powered by Oyadeki</p>
        </div>
      </div>

      {/* 詳細モーダル */}
      {selectedTask && (
        <div
          class="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"
          onClick={() => setSelectedTask(null)}
        >
          <div
            class="bg-white rounded-t-2xl w-full max-w-2xl min-h-[75vh] max-h-[90vh] overflow-y-auto animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* モーダルヘッダー */}
            <div class="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between rounded-t-2xl">
              <button
                onClick={() => setSelectedTask(null)}
                class="text-sm text-gray-500 px-2 py-1"
              >
                閉じる
              </button>
              <div class="w-10 h-1 bg-gray-300 rounded-full absolute left-1/2 -translate-x-1/2 top-2" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggle(selectedTask);
                  setSelectedTask(null);
                }}
                class={`text-sm font-medium px-3 py-1 rounded-lg ${
                  selectedTask.status === "done"
                    ? "bg-gray-100 text-gray-600"
                    : "bg-primary text-white"
                }`}
              >
                {selectedTask.status === "done" ? "未完了に戻す" : "完了にする"}
              </button>
            </div>

            <div class="px-5 py-4 space-y-4">
              {/* タイトル */}
              <div>
                <h2 class="text-lg font-bold text-gray-800">
                  {statusEmoji[selectedTask.status] || "⬜"}{" "}
                  {selectedTask.title}
                </h2>
              </div>

              {/* 詳細情報 */}
              <div class="space-y-2">
                {selectedTask.project && (
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-gray-400 w-20">プロジェクト</span>
                    <span class="text-gray-700">{selectedTask.project}</span>
                  </div>
                )}
                {selectedTask.phase && (
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-gray-400 w-20">フェーズ</span>
                    <span class="text-gray-700">{selectedTask.phase}</span>
                  </div>
                )}
                {selectedTask.assignee && (
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-gray-400 w-20">担当</span>
                    <span class="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">
                      👤 {selectedTask.assignee}
                    </span>
                  </div>
                )}
                {selectedTask.due_date && (
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-gray-400 w-20">期限</span>
                    <span class="text-gray-700">📅 {selectedTask.due_date}</span>
                  </div>
                )}
                {selectedTask.scheduled_date && (
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-gray-400 w-20">予定日</span>
                    <span class="text-gray-700">🔔 {selectedTask.scheduled_date}</span>
                  </div>
                )}
                {selectedTask.priority > 0 && (
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-gray-400 w-20">優先度</span>
                    <span class={`text-xs px-2 py-0.5 rounded font-medium ${
                      selectedTask.priority > 5
                        ? "bg-red-50 text-red-500"
                        : "bg-gray-100 text-gray-600"
                    }`}>
                      {selectedTask.priority > 5 ? "高" : "通常"} ({selectedTask.priority})
                    </span>
                  </div>
                )}
                {selectedTask.completed_at && (
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-gray-400 w-20">完了日</span>
                    <span class="text-gray-700">
                      {new Date(selectedTask.completed_at).toLocaleDateString("ja-JP")}
                    </span>
                  </div>
                )}
              </div>

              {/* メモ編集 */}
              <div>
                <label class="block text-sm font-medium text-gray-600 mb-1">
                  メモ
                </label>
                <textarea
                  ref={noteRef}
                  value={editingNote}
                  onInput={(e) =>
                    setEditingNote((e.target as HTMLTextAreaElement).value)
                  }
                  placeholder="メモを入力..."
                  class="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:border-primary focus:outline-none resize-y"
                  rows={6}
                />
                {editingNote.trim() !== (selectedTask.note || "") && (
                  <button
                    onClick={handleSaveNote}
                    disabled={savingNote}
                    class="mt-2 w-full py-2 text-sm font-medium rounded-xl bg-primary text-white disabled:opacity-50"
                  >
                    {savingNote ? "保存中..." : "メモを保存"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
