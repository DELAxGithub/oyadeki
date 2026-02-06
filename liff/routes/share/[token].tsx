import { Head } from "$fresh/runtime.ts";
import { Handlers, PageProps } from "$fresh/server.ts";
import ShareView from "../../islands/ShareView.tsx";

interface PageData {
  token: string;
}

export const handler: Handlers<PageData> = {
  GET(_req, ctx) {
    const { token } = ctx.params;
    return ctx.render({ token });
  },
};

export default function SharePage({ data }: PageProps<PageData>) {
  return (
    <>
      <Head>
        <title>契約台帳 - オヤデキ</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          {`
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 16px;
              line-height: 1.5;
              background-color: #f5f5f5;
              margin: 0;
              padding: 0;
            }
            .animate-spin {
              animation: spin 1s linear infinite;
            }
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
            @keyframes slideUp {
              from { transform: translateY(100%); }
              to { transform: translateY(0); }
            }
          `}
        </style>
      </Head>
      <div class="min-h-screen">
        <ShareView token={data.token} />
      </div>
    </>
  );
}
