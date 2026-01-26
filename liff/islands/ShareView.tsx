import { useEffect, useState } from "preact/hooks";

interface LedgerItem {
  id: string;
  service_name: string;
  category: string;
  account_identifier: string | null;
  monthly_cost: number | null;
  note: string | null;
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

  useEffect(() => {
    async function fetchShare() {
      try {
        const res = await fetch(`/api/share/${token}`);
        if (!res.ok) {
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
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        flexDirection: "column",
        gap: "16px"
      }}>
        <div class="animate-spin" style={{
          width: "40px",
          height: "40px",
          border: "4px solid #e0e0e0",
          borderTopColor: "#1DB446",
          borderRadius: "50%"
        }} />
        <p style={{ color: "#666" }}>読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        flexDirection: "column",
        gap: "16px",
        padding: "20px",
        textAlign: "center"
      }}>
        <div style={{ fontSize: "48px" }}>⚠️</div>
        <h2 style={{ margin: 0, color: "#333" }}>エラー</h2>
        <p style={{ color: "#666", margin: 0 }}>{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const expiryDate = new Date(data.expiresAt);
  const daysLeft = Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return (
    <div style={{ padding: "16px", maxWidth: "600px", margin: "0 auto" }}>
      {/* ヘッダー */}
      <div style={{
        background: "linear-gradient(135deg, #1DB446, #17a03d)",
        color: "white",
        padding: "20px",
        borderRadius: "12px",
        marginBottom: "16px",
        textAlign: "center"
      }}>
        <h1 style={{ margin: "0 0 8px 0", fontSize: "20px" }}>📑 契約台帳</h1>
        <div style={{ fontSize: "28px", fontWeight: "bold" }}>
          ¥{data.totalMonthlyCost.toLocaleString()}<span style={{ fontSize: "14px", fontWeight: "normal" }}>/月</span>
        </div>
        <div style={{ fontSize: "14px", marginTop: "8px", opacity: 0.9 }}>
          {data.ledgers.length}件の契約
        </div>
      </div>

      {/* 有効期限警告 */}
      <div style={{
        background: daysLeft <= 7 ? "#FFF3E0" : "#E8F5E9",
        padding: "12px",
        borderRadius: "8px",
        marginBottom: "16px",
        display: "flex",
        alignItems: "center",
        gap: "8px"
      }}>
        <span>{daysLeft <= 7 ? "⏰" : "✅"}</span>
        <span style={{ fontSize: "14px", color: daysLeft <= 7 ? "#E65100" : "#2E7D32" }}>
          {daysLeft > 0
            ? `このリンクはあと${daysLeft}日有効です`
            : "このリンクは本日で期限切れです"}
        </span>
      </div>

      {/* 注意書き */}
      <div style={{
        background: "#FFF8E1",
        padding: "12px",
        borderRadius: "8px",
        marginBottom: "16px",
        fontSize: "13px",
        color: "#F57F17"
      }}>
        ⚠️ パスワードは含まれていません。安全のため、ID・金額・メモのみ表示しています。
      </div>

      {/* 台帳リスト */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {data.ledgers.map((item) => (
          <div
            key={item.id}
            style={{
              background: "white",
              borderRadius: "12px",
              padding: "16px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{
                  display: "inline-block",
                  background: "#E3F2FD",
                  color: "#1565C0",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "11px",
                  marginBottom: "4px"
                }}>
                  {categoryLabels[item.category] || item.category}
                </div>
                <h3 style={{ margin: "4px 0", fontSize: "16px", fontWeight: "bold" }}>
                  {item.service_name}
                </h3>
              </div>
              <div style={{ fontSize: "18px", fontWeight: "bold", color: "#1DB446" }}>
                {item.monthly_cost ? `¥${item.monthly_cost.toLocaleString()}` : "-"}
              </div>
            </div>

            {item.account_identifier && (
              <div style={{ marginTop: "8px", fontSize: "13px", color: "#666" }}>
                <span style={{ color: "#999" }}>ID等: </span>
                {item.account_identifier}
              </div>
            )}

            {item.note && (
              <div style={{
                marginTop: "8px",
                fontSize: "13px",
                color: "#666",
                background: "#F5F5F5",
                padding: "8px",
                borderRadius: "6px"
              }}>
                {item.note}
              </div>
            )}

            {item.last_confirmed_at && (
              <div style={{ marginTop: "8px", fontSize: "11px", color: "#999" }}>
                最終確認: {new Date(item.last_confirmed_at).toLocaleDateString("ja-JP")}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* フッター */}
      <div style={{
        marginTop: "24px",
        padding: "16px",
        textAlign: "center",
        color: "#999",
        fontSize: "12px"
      }}>
        <div>🔗 オヤデキで作成</div>
        <div style={{ marginTop: "4px" }}>閲覧回数: {data.accessedCount}回</div>
      </div>
    </div>
  );
}
