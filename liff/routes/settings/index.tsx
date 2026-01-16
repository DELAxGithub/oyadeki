import { Head } from "$fresh/runtime.ts";
import SettingsForm from "../../islands/SettingsForm.tsx";

export default function SettingsPage() {
  return (
    <>
      <Head>
        <title>設定 - オヤデキ</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          {`
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 18px;
              line-height: 1.5;
            }
          `}
        </style>
      </Head>
      <div class="min-h-screen bg-white">
        <SettingsForm lineUserId={null} />
      </div>
    </>
  );
}
