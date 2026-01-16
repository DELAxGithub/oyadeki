import { Head } from "$fresh/runtime.ts";
import { Handlers, PageProps } from "$fresh/server.ts";
import LiffApp from "../../islands/LiffApp.tsx";

interface PageData {
  liffId: string;
}

export const handler: Handlers<PageData> = {
  GET(_req, ctx) {
    const liffId = Deno.env.get("LIFF_ID") ?? "";
    return ctx.render({ liffId });
  },
};

export default function SettingsPage({ data }: PageProps<PageData>) {
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
            .animate-spin {
              animation: spin 1s linear infinite;
            }
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}
        </style>
      </Head>
      <div class="min-h-screen bg-white">
        <LiffApp liffId={data.liffId} />
      </div>
    </>
  );
}
