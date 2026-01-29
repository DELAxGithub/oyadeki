# 対話型出品サポート (Interactive Selling Support) 設計書

## 1. 概要
ユーザーが送った商品写真に対し、AIが一方的に出品文を作るのではなく、チャットでヒアリングを行いながら詳細な情報を補完し、より精度の高い出品文と相場情報を提供する。

## 2. ユーザー体験 (UX) フロー

1.  **モード開始**: ユーザー「売る」→ Bot「写真送って」
2.  **写真解析 (Turn 0)**:
    *   User: [写真送信]
    *   Bot: 「これは**Dysonの掃除機**ですね！型番はわかりますか？（例: V10, V12）」(質問A)
3.  **ヒアリング (Turn 1)**:
    *   User: 「V8 Slimです」
    *   Bot: 「ありがとうございます。付属品は揃っていますか？また、傷や汚れはありますか？」(質問B)
4.  **ヒアリング (Turn 2)**:
    *   User: 「箱はないけど、ノズルは全部ある。パイプに少し傷がある」
    *   Bot: 「了解です。動作は正常ですか？」(質問C)
5.  **完了・生成 (Turn 3)**:
    *   User: 「問題なく動きます」
    *   Bot: 「承知しました！それなら相場は **15,000円〜18,000円** くらいです。\n以下の内容で出品文を作りました！」
    *   [出品文Flex Message] + [コピー用テキスト]

## 3. データモデル (Supabase)

### `sell_items` テーブル (新規)
進行中の取引情報を管理する。

| Column | Type | Note |
|---|---|---|
| `id` | uuid | Primary Key |
| `line_user_id` | text | LINE User ID |
| `status` | text | `analyzing`, `questioning`, `completed` |
| `image_summary` | text | 画像の視覚的特徴（Geminiによる描写） |
| `extracted_info` | jsonb | `{ "category": "...", "brand": "...", "model": "...", "condition": "..." }` |
| `dialogue_history` | jsonb | `[ { "role": "user", "text": "..." }, { "role": "assistant", "text": "..." } ]` |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

※ 画像自体は保存せず、最初の解析で「テキスト記述」に変換して保持する（Privacy & Storageコスト最適化）。

## 4. ロジック変更点

### `gemini-client.ts`
*   `analyzeProductImage(base64)`: 画像から「商品特徴(image_summary)」と「初期情報(extracted_info)」と「最初の質問」を生成。
*   `continueSellingDialogue(currentInfo, userReply)`: 現在の情報と回答から、「更新された情報」と「次の質問(または完了判定)」を生成。

### `oyadeki-webhook/index.ts`
*   **画像受信時**: `sell_mode` なら `sell_items` にレコード作成し、最初の質問をする。
*   **テキスト受信時**:
    *   `sell_items` で `status=questioning` の最新レコードを探す。
    *   あれば、Geminiに回答を投げて次のステップへ。
    *   「キャンセル」「やめる」等のキーワードでモード終了。

## 5. Gemini プロンプト設計

### 初期解析プロンプト
```text
この商品の画像を分析し、メルカリ出品に必要な情報を抽出してください。
出力形式: JSON
- category: カテゴリ
- product_name: 推定商品名
- features: 視覚的特徴（色、形、付属品の有無）
- missing_info: 出品文作成に足りない情報（型番、使用期間、傷の状態など）のリスト
- first_question: ユーザーに尋ねるべき最初の質問（親しみやすく、1つだけ）
```

### 継続対話プロンプト
```text
これまでの情報: {JSON}
ユーザーの回答: "..."
タスク:
1. 情報を更新してください。
2. 出品文作成に十分な情報が集まったか判定してください (is_sufficient)。
3. まだ足りなければ、次の質問 (next_question) を生成してください。
4. 十分なら、出品文 (title, description, price_range) を生成してください。
```
