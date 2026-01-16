import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface SettingsFormProps {
  lineUserId: string | null;
}

/**
 * 設定フォーム（特大UI: 48px+ボタン、18px+文字）
 */
export default function SettingsForm({ lineUserId }: SettingsFormProps) {
  const loading = useSignal(true);
  const saving = useSignal(false);
  const metaphorTheme = useSignal("ツェーゲン金沢");
  const metaphorEnabled = useSignal(false);
  const tone = useSignal("polite");
  const dislikedPhrases = useSignal("");
  const consented = useSignal(false);

  useEffect(() => {
    if (!lineUserId) {
      loading.value = false;
      return;
    }

    // 設定を取得
    fetch(`/api/user-context?line_user_id=${lineUserId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          metaphorTheme.value = data.metaphor_theme ?? "ツェーゲン金沢";
          metaphorEnabled.value = data.metaphor_enabled ?? false;
          tone.value = data.tone ?? "polite";
          dislikedPhrases.value = (data.disliked_phrases ?? []).join(", ");
          consented.value = !!data.consented_at;
        }
      })
      .finally(() => {
        loading.value = false;
      });
  }, [lineUserId]);

  const handleSave = async () => {
    if (!lineUserId) return;
    saving.value = true;

    const updates = {
      metaphor_theme: metaphorTheme.value,
      metaphor_enabled: metaphorEnabled.value,
      tone: tone.value,
      disliked_phrases: dislikedPhrases.value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s),
      consented_at: consented.value ? new Date().toISOString() : null,
    };

    await fetch("/api/user-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line_user_id: lineUserId, ...updates }),
    });

    saving.value = false;
    alert("保存しました");
  };

  if (loading.value) {
    return (
      <div class="flex items-center justify-center min-h-screen">
        <p class="text-lg">読み込み中...</p>
      </div>
    );
  }

  if (!lineUserId) {
    return (
      <div class="flex items-center justify-center min-h-screen">
        <p class="text-lg">LINEでログインしてください</p>
      </div>
    );
  }

  return (
    <div class="max-w-md mx-auto p-6">
      <h1 class="text-2xl font-bold mb-6">オヤデキ設定</h1>

      {/* 趣味テーマ */}
      <div class="mb-6">
        <label class="block text-lg font-medium mb-2">
          趣味のテーマ（メタファー用）
        </label>
        <input
          type="text"
          value={metaphorTheme.value}
          onInput={(e) => (metaphorTheme.value = (e.target as HTMLInputElement).value)}
          class="w-full p-4 text-lg border-2 rounded-lg focus:border-blue-500 focus:outline-none"
          placeholder="例: ツェーゲン金沢"
        />
      </div>

      {/* メタファー有効化 */}
      <div class="mb-6">
        <label class="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={metaphorEnabled.value}
            onChange={(e) => (metaphorEnabled.value = (e.target as HTMLInputElement).checked)}
            class="w-6 h-6"
          />
          <span class="text-lg">趣味に合わせた表現を使う</span>
        </label>
      </div>

      {/* トーン */}
      <div class="mb-6">
        <label class="block text-lg font-medium mb-2">話し方</label>
        <select
          value={tone.value}
          onChange={(e) => (tone.value = (e.target as HTMLSelectElement).value)}
          class="w-full p-4 text-lg border-2 rounded-lg focus:border-blue-500 focus:outline-none"
        >
          <option value="polite">丁寧</option>
          <option value="casual">カジュアル</option>
          <option value="warm">温かみのある</option>
        </select>
      </div>

      {/* NG語 */}
      <div class="mb-6">
        <label class="block text-lg font-medium mb-2">
          使ってほしくない言葉（カンマ区切り）
        </label>
        <input
          type="text"
          value={dislikedPhrases.value}
          onInput={(e) => (dislikedPhrases.value = (e.target as HTMLInputElement).value)}
          class="w-full p-4 text-lg border-2 rounded-lg focus:border-blue-500 focus:outline-none"
          placeholder="例: 頑張って, 大丈夫"
        />
      </div>

      {/* 同意 */}
      <div class="mb-8 p-4 bg-gray-100 rounded-lg">
        <label class="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={consented.value}
            onChange={(e) => (consented.value = (e.target as HTMLInputElement).checked)}
            class="w-6 h-6 mt-1"
          />
          <span class="text-base">
            個人情報の取り扱いについて同意します。
            データは親子コミュニケーション支援の目的にのみ使用されます。
          </span>
        </label>
      </div>

      {/* 保存ボタン */}
      <button
        onClick={handleSave}
        disabled={saving.value || !consented.value}
        class="w-full py-4 text-lg font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        style={{ minHeight: "56px" }}
      >
        {saving.value ? "保存中..." : "保存する"}
      </button>
    </div>
  );
}
