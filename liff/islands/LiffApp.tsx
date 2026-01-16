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

  useEffect(() => {
    const initLiff = async () => {
      try {
        // LIFF SDKを動的にインポート
        const liff = (await import("https://esm.sh/@line/liff@2.24.0")).default;

        await liff.init({ liffId });

        if (!liff.isLoggedIn()) {
          // LINEログインが必要
          liff.login();
          return;
        }

        // プロフィールからユーザーIDを取得
        const profile = await liff.getProfile();
        lineUserId.value = profile.userId;
      } catch (e) {
        console.error("LIFF initialization error:", e);
        error.value = "LIFFの初期化に失敗しました";
      } finally {
        loading.value = false;
      }
    };

    initLiff();
  }, [liffId]);

  if (loading.value) {
    return (
      <div class="flex items-center justify-center min-h-screen">
        <div class="text-center">
          <div class="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p class="text-lg">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error.value) {
    return (
      <div class="flex items-center justify-center min-h-screen">
        <div class="text-center p-6">
          <p class="text-lg text-red-600 mb-4">{error.value}</p>
          <button
            onClick={() => location.reload()}
            class="px-6 py-3 bg-blue-600 text-white rounded-lg"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  return <SettingsForm lineUserId={lineUserId.value} />;
}
