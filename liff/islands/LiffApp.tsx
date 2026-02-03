import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import SettingsForm from "./SettingsForm.tsx";

interface LiffAppProps {
  liffId: string;
}

/**
 * LIFFアプリのメインコンポーネント
 * LIFF SDK初期化とユーザー認証を管理
 */
export default function LiffApp({ liffId }: LiffAppProps) {
  const loading = useSignal(true);
  const error = useSignal<string | null>(null);
  const lineUserId = useSignal<string | null>(null);
  const isMock = useSignal(false);

  useEffect(() => {
    const initLiff = async () => {
      try {
        // Check for mock mode via URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const mockMode = urlParams.get("mock") === "true";

        if (mockMode) {
          console.log("🚀 Running in Mock Mode");
          isMock.value = true;
          lineUserId.value = "U1234567890abcdef1234567890abcdef"; // Dummy User ID
          loading.value = false;
          return;
        }

        // LIFF SDKを動的にインポート
        const { liff } = window as any; // Use global or import if available
        const liffModule =
          (await import("https://esm.sh/@line/liff@2.24.0")).default;

        await liffModule.init({ liffId });

        if (!liffModule.isLoggedIn()) {
          // LINEログインが必要
          liffModule.login();
          return;
        }

        // プロフィールからユーザーIDを取得
        const profile = await liffModule.getProfile();
        lineUserId.value = profile.userId;
      } catch (e) {
        console.error("LIFF initialization error:", e);
        error.value = "LIFFの初期化に失敗しました";
      } finally {
        if (!isMock.value) {
          loading.value = false;
        }
      }
    };

    initLiff();
  }, [liffId]);

  if (loading.value) {
    return (
      <div class="flex items-center justify-center min-h-screen bg-gray-50">
        <div class="text-center">
          <div class="animate-spin w-10 h-10 border-4 border-[#06C755] border-t-transparent rounded-full mx-auto mb-4">
          </div>
          <p class="text-gray-600 font-medium">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error.value) {
    return (
      <div class="flex items-center justify-center min-h-screen bg-gray-50">
        <div class="text-center p-6 bg-white rounded-xl shadow-sm max-w-sm mx-4">
          <p class="text-red-500 font-bold mb-2">エラーが発生しました</p>
          <p class="text-sm text-gray-600 mb-6">{error.value}</p>
          <button
            onClick={() => location.reload()}
            class="px-6 py-2 bg-[#06C755] text-white rounded-full font-bold hover:bg-[#05b34c] transition-colors"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="relative">
      {isMock.value && (
        <div class="fixed top-0 left-0 right-0 bg-yellow-100 text-yellow-800 text-xs text-center py-1 z-50">
          🧪 Mock Mode (Chrome Dev)
        </div>
      )}
      <SettingsForm lineUserId={lineUserId.value} />
    </div>
  );
}
