export default function DevDashboard() {
  return (
    <div class="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div class="max-w-md w-full">
        <div class="text-center mb-10">
          <img
            src="/logo.svg"
            width="80"
            height="80"
            alt="Oyadeki Logo"
            class="mx-auto mb-4"
          />
          <h1 class="text-2xl font-bold text-gray-800">
            オヤデキ Dev Dashboard
          </h1>
          <p class="text-gray-500 mt-2">
            Chrome開発用ポータル (Tailwind Enabled)
          </p>
        </div>

        <div class="space-y-4">
          <a
            href="/settings?mock=true"
            class="block p-6 bg-white rounded-xl shadow-sm border border-gray-100 hover:border-[#06C755] transition-colors group"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-[#06C755] font-bold">
                  ⚙️
                </div>
                <div class="text-left">
                  <h3 class="font-bold text-gray-800">設定画面 (Mock)</h3>
                  <p class="text-sm text-gray-500">Settings Form</p>
                </div>
              </div>
              <span class="text-gray-300 group-hover:text-[#06C755]">→</span>
            </div>
          </a>

          <a
            href="/share/mock-token-12345"
            class="block p-6 bg-white rounded-xl shadow-sm border border-gray-100 hover:border-[#06C755] transition-colors group"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                  📑
                </div>
                <div class="text-left">
                  <h3 class="font-bold text-gray-800">契約台帳シェア (Mock)</h3>
                  <p class="text-sm text-gray-500">Shared Ledger View</p>
                </div>
              </div>
              <span class="text-gray-300 group-hover:text-[#06C755]">→</span>
            </div>
          </a>
        </div>

        <div class="mt-12 text-center text-xs text-gray-400">
          Running on Fresh • TailwindCSS Configured
        </div>
      </div>
    </div>
  );
}
