# オヤデキ (Oyadeki) - 開発ガイド

## プロジェクト概要
親子コミュニケーションを支援するLINEボット。AIは下書き・話題タネ・通話ブリッジの「触媒」として機能。

## 技術スタック
- **Webhook/API**: Supabase Edge Functions (Deno)
- **LIFF設定UI**: Deno Fresh (Deno Deploy)
- **DB**: Supabase PostgreSQL (RLS有効)
- **AI**: Gemini 1.5 Pro (Flash fallback)

## ディレクトリ構造
```
oyadeki/
├── supabase/
│   ├── functions/
│   │   ├── _shared/           # 共通モジュール
│   │   └── oyadeki-webhook/   # LINE Webhook
│   └── migrations/            # DBマイグレーション
├── liff/                      # Deno Fresh (設定UI)
│   ├── routes/
│   ├── islands/
│   └── lib/
└── requirement.md             # 要件定義
```

## 開発コマンド

### Supabase Edge Functions
```bash
# ローカルDB起動
npx supabase start

# Edge Functions起動
npx supabase functions serve oyadeki-webhook --env-file .env.local

# デプロイ
npx supabase functions deploy oyadeki-webhook
npx supabase secrets set LINE_CHANNEL_SECRET=xxx ...
```

### LIFF (Deno Fresh)
```bash
cd liff
deno task start      # 開発サーバー
deno task build      # ビルド
deno task preview    # 本番プレビュー
```

## 重要な設計判断

### 3秒タイムアウト
- P50 ≤ 3.5s / P95 ≤ 7s が目標
- 3秒超過時はテンプレート即返し
- AbortControllerでタイムアウト制御

### 署名検証
- LINE Webhookは必ずHMAC-SHA256で検証
- `x-line-signature`ヘッダーを使用

### イベント重複排除
- eventIdを2分間インメモリで保持
- 本番はSupabase KV等に移行検討

### RLSポリシー
- user_contexts: 本人のみ読み書き可
- usage_logs: サービスロールのみ書き込み

## 環境変数
`.env.example`を参照してローカル用に`.env.local`を作成。

## KPI
- 自作率: 返信カードの「自分で書く」選択率 ≥ 30%
- コピー採用率: A/B/Cの選択分布
- 通話誘発: call_suggest後T+6hの応答率 ≥ 40%
- レイテンシ: P50 ≤ 3.5s / P95 ≤ 7s
