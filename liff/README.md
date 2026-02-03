# オヤデキ LIFFアプリ開発（Webフロントエンド）

このディレクトリは、LINE Bot「オヤデキ」の拡張機能となるLIFF（LIne Front-end Framework）アプリのための場所です。
現在はカルーセルUIで対応している一覧表示や詳細確認を、よりリッチなWeb UIで提供することを目的としています。

## 🚨 緊急ミッション: 共有リンクの404解消
Bot側で発行される「台帳共有リンク」が現在 404 エラーになっています。
最優先で以下のページを実装・デプロイしてください。

- **URL**: `https://[デプロイ先ドメイン]/share/:token`
- **機能**: URL内のトークンを使って `share_tokens` テーブルを照合し、紐づく台帳データ (`ledgers`) をリスト表示する。
- **認証**: ログイン不要（トークンを知っている人のみ閲覧可能）。

---

## 🏗 全体設計・ロードマップ

### 1. 技術スタック（推奨）
- **Core**: React + Vite (TypeScript)
- **Styling**: TailwindCSS (v4) + Shadcn/ui (必要に応じて)
- **Backend/DB**: Supabase (既存のプロジェクト `xnzlfpzecupaoilinddx` を利用)
- **Hosting**: Vercel, Netlify, または Deno Deploy

### 2. ディレクトリ構成案
- `/src/pages/ShareView.tsx`: 共有・閲覧専用ページ
- `/src/pages/MediaList.tsx`: メディアログ一覧（要認証）
- `/src/pages/LedgerList.tsx`: 契約台帳一覧（要認証）

### 3. 認証設計（重要）
親御さんがLINEからLIFFを開いた際、以下のフローでSupabaseのRLS（Row Level Security）を通過させる必要があります。

1. **LIFF初期化**: `@line/liff` SDKで `liff.init()` し、ユーザーの `idToken` を取得。
2. **カスタム認証**: 取得した `idToken` をオヤデキのバックエンド（Edge Function: `auth-line` ※要作成）に送信。
3. **JWT発行**: バックエンドでLINEの署名を検証し、SupabaseのカスタムJWTを生成して返す。
4. **Supabaseログイン**: フロントエンドで `supabase.auth.signInWithIdToken(...)` または `setSession` し、DBアクセス権を得る。

※ **共有ページ（/share/:token）に関しては、上記認証は不要です。** `supabase-js` を使い、Anon Keyでアクセスしますが、DB側で `share_tokens` テーブルを開放するRLSポリシー設定が必要です。

---

## 📝 DBスキーマ（参照）
既存のSupabaseテーブルを利用します。

- `ledgers`: 契約台帳データ
- `media_logs`: メディア視聴ログ
- `share_tokens`: 共有用トークン管理
    - `id` (uuid)
    - `token` (string, unique)
    - `line_user_id` (string)
    - `expires_at` (timestamptz)

---

## 🛠 開発手順のステップ

1. **プロジェクト初期化**:
   ```bash
   npm create vite@latest . -- --template react-ts
   npm install -D tailwindcss postcss autoprefixer
   npx tailwindcss init -p
   ```

2. **Supabaseクライアント設定**:
   ```ts
   import { createClient } from '@supabase/supabase-js'
   export const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY)
   ```

3. **共有ページ実装 (`/share/:token`)**:
   - URLパラメータから token を取得。
   - `share_tokens` テーブルを検索し、有効期限内かチェック。
   - 紐づく `line_user_id` を取得。
   - その `line_user_id` の `ledgers` データを全件取得して表示。

4. **デプロイ**:
   - Bot側のコード (`oyadeki-webhook/index.ts`) 内の `const LIFF_BASE_URL` を、デプロイしたURLに書き換えること。
