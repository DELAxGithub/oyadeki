import { useEffect, useRef, useState } from "preact/hooks";

interface LedgerItem {
  id: string;
  service_name: string;
  category: string;
  account_identifier: string | null;
  monthly_cost: number | null;
  note: string | null;
  storage_location: string | null;
  last_confirmed_at: string | null;
  created_at: string;
}

interface ShareData {
  ledgers: LedgerItem[];
  totalMonthlyCost: number;
  expiresAt: string;
  accessedCount: number;
}

interface ShareViewProps {
  token: string;
}

const categoryLabels: Record<string, string> = {
  utility: "公共料金",
  subscription: "サブスク",
  insurance: "保険",
  telecom: "通信",
  other: "その他",
};

export default function ShareView({ token }: ShareViewProps) {
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<LedgerItem | null>(null);
  const [editingNote, setEditingNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Mock data for testing or fallback
    const mockData: ShareData = {
      ledgers: [
        {
          id: "1",
          service_name: "Netflix",
          category: "subscription",
          monthly_cost: 1490,
          account_identifier: "user@example.com",
          note: "プレミアムプラン",
          last_confirmed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        {
          id: "2",
          service_name: "東京電力",
          category: "utility",
          monthly_cost: 8500,
          account_identifier: "1234-5678",
          note: "1月分",
          last_confirmed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        {
          id: "3",
          service_name: "スマホ代",
          category: "telecom",
          monthly_cost: 3200,
          account_identifier: "090-xxxx-xxxx",
          note: null,
          last_confirmed_at: null,
          created_at: new Date().toISOString(),
        },
      ],
      totalMonthlyCost: 13190,
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days later
      accessedCount: 12,
    };

    if (token === "test-token-123" || token.startsWith("mock-")) {
      setData(mockData);
      setLoading(false);
      return;
    }

    async function fetchShare() {
      try {
        const res = await fetch(`/api/share/${token}`);
        if (!res.ok) {
          // Fallback to mock for dev preview if API fails (optional, good for design check)
          const urlParams = new URLSearchParams(window.location.search);
          if (urlParams.get("mock") === "true") {
            setData(mockData);
            setLoading(false);
            return;
          }
          const errData = await res.json();
          setError(errData.error || "エラーが発生しました");
          return;
        }
        const shareData = await res.json();
        setData(shareData);
      } catch (e) {
        setError("通信エラーが発生しました");
      } finally {
        setLoading(false);
      }
    }
    fetchShare();
  }, [token]);

  if (loading) {
    return (
      <div class="flex flex-col gap-4 items-center justify-center min-h-screen bg-background-muted">
        <div class="animate-spin w-10 h-10 border-4 border-gray-200 border-t-primary rounded-full">
        </div>
        <p class="text-foreground-secondary font-medium">読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div class="flex flex-col gap-4 items-center justify-center min-h-screen bg-background-muted p-6 text-center">
        <div class="text-4xl">⚠️</div>
        <h2 class="text-xl font-bold text-foreground">エラー</h2>
        <p class="text-foreground-secondary">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const openDetail = (item: LedgerItem) => {
    setSelectedItem(item);
    setEditingNote(item.note || "");
  };

  const handleSaveNote = async () => {
    if (!selectedItem || !data) return;
    const newNote = editingNote.trim() || null;
    if (newNote === (selectedItem.note || null)) return;

    setSavingNote(true);
    try {
      const res = await fetch(`/api/share/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedItem.id, note: newNote }),
      });

      if (res.ok) {
        const updatedLedgers = data.ledgers.map((l) =>
          l.id === selectedItem.id ? { ...l, note: newNote } : l
        );
        setData({ ...data, ledgers: updatedLedgers });
        setSelectedItem({ ...selectedItem, note: newNote });
      }
    } catch (_e) {
      alert("保存に失敗しました");
    } finally {
      setSavingNote(false);
    }
  };

  const expiryDate = new Date(data.expiresAt);
  const daysLeft = Math.ceil(
    (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  return (
    <div class="min-h-screen bg-background-muted font-sans pb-12">
      <div class="max-w-2xl mx-auto p-4 space-y-4">
        {/* Header Section */}
        <div class="bg-white rounded-xl border border-border p-6 text-center shadow-sm">
          <div class="flex items-center justify-center gap-2 mb-2">
            <span class="text-2xl">📑</span>
            <h1 class="text-lg font-bold text-foreground">契約台帳</h1>
          </div>

          <div class="my-4">
            <div class="text-sm text-foreground-secondary mb-1">月額合計</div>
            <div class="text-4xl font-bold text-primary tracking-tight">
              ¥{data.totalMonthlyCost.toLocaleString()}
            </div>
          </div>

          <div class="flex justify-center gap-4 text-sm text-foreground-secondary">
            <div class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full bg-primary"></span>
              {data.ledgers.length}件の契約
            </div>
            <div class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full bg-gold"></span>
              閲覧: {data.accessedCount}回
            </div>
          </div>
        </div>

        {/* Alerts */}
        <div
          class={`p-3 rounded-lg flex items-center gap-3 border ${
            daysLeft <= 7
              ? "bg-[#FFF3E0] border-[#FFE0B2] text-[#E65100]"
              : "bg-[#E8F5E9] border-[#C8E6C9] text-[#2E7D32]"
          }`}
        >
          <span class="text-lg">{daysLeft <= 7 ? "⏰" : "✅"}</span>
          <span class="text-sm font-medium">
            {daysLeft > 0
              ? `共有リンクの有効期限: あと${daysLeft}日`
              : "このリンクは期限切れです"}
          </span>
        </div>

        {/* Security Note */}
        <div class="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 flex gap-2">
          <span>ℹ️</span>
          <span>
            パスワードは含まれていません。安全のため、契約内容の一部のみを表示しています。
          </span>
        </div>

        {/* Ledger List */}
        <div class="space-y-3">
          {data.ledgers.map((item) => (
            <div
              key={item.id}
              class="bg-white rounded-xl border border-border p-5 shadow-sm hover:border-primary transition-colors cursor-pointer active:scale-[0.98]"
              onClick={() => openDetail(item)}
            >
              <div class="flex justify-between items-start mb-1">
                <div class="flex flex-col gap-1">
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600 self-start">
                    {categoryLabels[item.category] || item.category}
                  </span>
                  <h3 class="text-lg font-bold text-foreground leading-tight">
                    {item.service_name}
                  </h3>
                </div>
                <div class="text-lg font-bold text-primary whitespace-nowrap">
                  {item.monthly_cost
                    ? `¥${item.monthly_cost.toLocaleString()}`
                    : "-"}
                </div>
              </div>

              <div class="mt-3 space-y-2">
                {item.account_identifier && (
                  <div class="flex items-start gap-2 text-sm text-foreground">
                    <span class="text-foreground-muted w-10 shrink-0">
                      ID等
                    </span>
                    <span class="font-medium break-all">
                      {item.account_identifier}
                    </span>
                  </div>
                )}

                {item.note && (
                  <div class="flex items-start gap-2 text-sm text-foreground">
                    <span class="text-foreground-muted w-10 shrink-0">
                      メモ
                    </span>
                    <span class="bg-gray-50 px-2 py-1 rounded text-foreground-secondary flex-1">
                      {item.note}
                    </span>
                  </div>
                )}

                {item.storage_location && (
                  <div class="flex items-start gap-2 text-sm text-foreground">
                    <span class="text-foreground-muted w-10 shrink-0">
                      保管
                    </span>
                    <span class="font-medium">
                      📂 {item.storage_location}
                    </span>
                  </div>
                )}
              </div>

              {item.last_confirmed_at && (
                <div class="mt-3 pt-3 border-t border-gray-100 flex justify-end text-xs text-foreground-muted">
                  最終確認:{" "}
                  {new Date(item.last_confirmed_at).toLocaleDateString("ja-JP")}
                </div>
              )}
            </div>
          ))}
        </div>

        <div class="mt-8 text-center">
          <p class="text-xs text-foreground-muted">Powered by Oyadeki</p>
        </div>
      </div>

      {/* 詳細モーダル */}
      {selectedItem && (
        <div
          class="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"
          onClick={() => setSelectedItem(null)}
        >
          <div
            class="bg-white rounded-t-2xl w-full max-w-2xl min-h-[70vh] max-h-[92vh] overflow-y-auto"
            style={{ animation: "slideUp 0.2s ease-out" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div class="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between rounded-t-2xl">
              <button
                onClick={() => setSelectedItem(null)}
                class="text-sm text-foreground-secondary px-2 py-1"
              >
                閉じる
              </button>
              <div class="w-10 h-1 bg-gray-300 rounded-full absolute left-1/2 -translate-x-1/2 top-2" />
              <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600">
                {categoryLabels[selectedItem.category] || selectedItem.category}
              </span>
            </div>

            <div class="px-5 py-4 space-y-4">
              {/* タイトル + 金額 */}
              <div>
                <h2 class="text-lg font-bold text-foreground">{selectedItem.service_name}</h2>
                {selectedItem.monthly_cost != null && (
                  <p class="text-2xl font-bold text-primary mt-1">
                    ¥{selectedItem.monthly_cost.toLocaleString()}<span class="text-sm font-normal text-foreground-secondary">/月</span>
                  </p>
                )}
              </div>

              {/* 詳細 */}
              <div class="space-y-2">
                {selectedItem.account_identifier && (
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-foreground-muted w-16">ID等</span>
                    <span class="font-medium text-foreground break-all">{selectedItem.account_identifier}</span>
                  </div>
                )}
                {selectedItem.storage_location && (
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-foreground-muted w-16">保管場所</span>
                    <span class="font-medium text-foreground">📂 {selectedItem.storage_location}</span>
                  </div>
                )}
                {selectedItem.last_confirmed_at && (
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-foreground-muted w-16">最終確認</span>
                    <span class="text-foreground">{new Date(selectedItem.last_confirmed_at).toLocaleDateString("ja-JP")}</span>
                  </div>
                )}
                <div class="flex items-center gap-2 text-sm">
                  <span class="text-foreground-muted w-16">登録日</span>
                  <span class="text-foreground">{new Date(selectedItem.created_at).toLocaleDateString("ja-JP")}</span>
                </div>
              </div>

              {/* メモ編集 */}
              <div>
                <label class="block text-sm font-medium text-foreground-secondary mb-1">
                  メモ
                </label>
                <textarea
                  ref={noteRef}
                  value={editingNote}
                  onInput={(e) => setEditingNote((e.target as HTMLTextAreaElement).value)}
                  placeholder="解約方法、注意点など..."
                  class="w-full px-3 py-2 text-sm border border-border rounded-xl bg-gray-50 focus:bg-white focus:border-primary focus:outline-none resize-y"
                  rows={4}
                />
                {editingNote.trim() !== (selectedItem.note || "") && (
                  <button
                    onClick={handleSaveNote}
                    disabled={savingNote}
                    class="mt-2 w-full py-2.5 text-sm font-medium rounded-xl bg-primary text-white disabled:opacity-50"
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
