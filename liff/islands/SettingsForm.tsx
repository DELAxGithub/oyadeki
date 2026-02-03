import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface SettingsFormProps {
  lineUserId: string | null;
}

/**
 * 設定フォーム (LINE/iOS Style)
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
      .catch((e) => console.error(e))
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

  if (!lineUserId) {
    return (
      <div class="flex items-center justify-center min-h-screen bg-gray-100">
        <p class="text-gray-500">LINEでログインしてください</p>
      </div>
    );
  }

  return (
    <div class="min-h-screen bg-[#F5F5F5] pb-20 font-sans">
      {/* Header handled by LiffApp or unnecessary in LIFF fullbleed */}

      {/* Section: Personality */}
      <div class="pt-6">
        <h2 class="px-4 pb-2 text-xs text-gray-500 uppercase font-medium">
          Botの人格設定
        </h2>
        <div class="bg-white border-y border-gray-200">
          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-0 pl-4">
            <span class="text-base text-gray-900">趣味のテーマ</span>
            <input
              type="text"
              value={metaphorTheme.value}
              onInput={(
                e,
              ) => (metaphorTheme.value = (e.target as HTMLInputElement).value)}
              class="text-right text-gray-600 bg-transparent focus:outline-none w-1/2"
              placeholder="例: ツェーゲン金沢"
            />
          </div>

          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-0 pl-4">
            <span class="text-base text-gray-900">趣味に合わせた表現</span>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={metaphorEnabled.value}
                onChange={(
                  e,
                ) => (metaphorEnabled.value =
                  (e.target as HTMLInputElement).checked)}
                class="sr-only peer"
              />
              <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#06C755]">
              </div>
            </label>
          </div>

          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-0 pl-4">
            <span class="text-base text-gray-900">話し方</span>
            <div class="relative">
              <select
                value={tone.value}
                onChange={(
                  e,
                ) => (tone.value = (e.target as HTMLSelectElement).value)}
                class="appearance-none bg-transparent text-gray-600 pr-6 text-right focus:outline-none"
              >
                <option value="polite">丁寧</option>
                <option value="casual">カジュアル</option>
                <option value="warm">温かみのある</option>
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center text-gray-400">
                <svg
                  class="fill-current h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section: Constraints */}
      <div class="pt-6">
        <h2 class="px-4 pb-2 text-xs text-gray-500 uppercase font-medium">
          禁止ワード
        </h2>
        <div class="bg-white border-y border-gray-200 p-4">
          <input
            type="text"
            value={dislikedPhrases.value}
            onInput={(
              e,
            ) => (dislikedPhrases.value = (e.target as HTMLInputElement).value)}
            class="w-full text-base text-gray-900 focus:outline-none placeholder-gray-400"
            placeholder="例: 頑張って, 大丈夫"
          />
          <p class="mt-2 text-xs text-gray-400">
            カンマ区切りで入力してください。
          </p>
        </div>
      </div>

      {/* Section: Consent */}
      <div class="pt-6 px-4">
        <label class="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={consented.value}
            onChange={(
              e,
            ) => (consented.value = (e.target as HTMLInputElement).checked)}
            class="w-5 h-5 mt-0.5 text-[#06C755] border-gray-300 rounded focus:ring-[#06C755]"
          />
          <span class="text-sm text-gray-500 leading-relaxed">
            <a href="#" class="underline text-blue-600">
              プライバシーポリシー
            </a>に同意し、
            私の入力したデータが親子間のコミュニケーション支援のために使用されることを承諾します。
          </span>
        </label>
      </div>

      {/* Footer Action */}
      <div class="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur border-t border-gray-200">
        <button
          onClick={handleSave}
          disabled={saving.value || !consented.value}
          class="w-full py-3 font-bold text-white bg-[#06C755] rounded-xl active:bg-[#05b34c] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {saving.value ? "保存中..." : "設定を保存"}
        </button>
      </div>
    </div>
  );
}
