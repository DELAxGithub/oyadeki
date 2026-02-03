import { type PageProps } from "$fresh/server.ts";
export default function App({ Component }: PageProps) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Oyadeki Dev</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <script src="https://cdn.tailwindcss.com"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
            tailwind.config = {
              theme: {
                extend: {
                  fontFamily: {
                    sans: ['"Noto Sans JP"', "sans-serif"],
                  },
                  colors: {
                    'primary': '#06C755',
                    'primary-dark': '#05A847',
                    'gold': '#D4AF37',
                    'danger': '#CC0000',
                    'background-muted': '#F5F5F5',
                    'border': '#E5E5E5',
                    'foreground': '#1A1A1A',
                    'foreground-muted': '#999999',
                    'line-green': '#06C755', // For compatibility
                  }
                }
              }
            }
          `,
          }}
        />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
}
