import { Head } from "$fresh/runtime.ts";
import { Handlers, PageProps } from "$fresh/server.ts";
import MediaLogView from "../../islands/MediaLogView.tsx";

interface PageData {
  userId: string;
}

export const handler: Handlers<PageData> = {
  GET(_req, ctx) {
    const { userId } = ctx.params;
    return ctx.render({ userId });
  },
};

export default function MediaPage({ data }: PageProps<PageData>) {
  return (
    <>
      <Head>
        <title>視聴記録 - オヤデキ</title>
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
          `}
        </style>
      </Head>
      <div class="min-h-screen">
        <MediaLogView userId={data.userId} />
      </div>
    </>
  );
}
