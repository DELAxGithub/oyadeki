# 修正依頼書: oyadeki-webhook 機能実装とバグ修正

## 概要
`oyadeki-webhook` Edge Function において、メディア特定機能の対話モード実装中に発生したシンタックスエラー（スコープ崩れ）の修正、および新規仕様の実装をお願いします。

## 現状の課題
`supabase/functions/oyadeki-webhook/index.ts` において、以下のリンターエラーが発生しており、デプロイができない状態です。

*   `'catch' or 'finally' expected.`
*   `'try' expected.`
*   その他、変数のスコープ外参照エラー多数。

これらは、`handleMessageEvent` 関数の終了部分と `handlePostbackEvent` 関数の開始部分における中括弧 `{}` の対応関係が崩れたことに起因します。

## 修正・実装依頼内容

### 1. シンタックスエラーの解消 (`oyadeki-webhook/index.ts`)
`handleMessageEvent` 関数と `handlePostbackEvent` 関数の境界周辺のコードを整理し、正しい入れ子構造に修正してください。

**あるべき構造のイメージ:**
```typescript
async function handleMessageEvent(...) {
  try {
    // ...
    if (message.type === "image") {
      try {
        // 画像処理 logic
      } catch (error) {
        // 画像処理 error handling
      }
    }
    // ...
  } catch (error) {
    console.error("handleMessageEvent error:", error);
  }
} // End of handleMessageEvent

async function handlePostbackEvent(...) {
  // ...
}
```

### 2. 「見たもの」履歴閲覧機能の実装
「見たもの」メニューが「写真撮影モードへの誘導」に変更されたことに伴い、履歴閲覧機能はボタンアクション (`action=view_media_history`) に移動しました。
`handlePostbackEvent` 内に以下のロジックを実装（または復旧）してください。

```typescript
// handlePostbackEvent 内
if (action === "view_media_history") {
  // media_logs テーブルから履歴をDESCで20件取得
  // buildMediaListFlexMessage でカルーセルを作成して返信
  // logUsage で "media_list" を記録
}
```

### 3. メディア対話モードの確認
`gemini-client.ts` の `identifyMedia` 関数が `MediaDialogueState` (質問と視覚情報) を返すように変更されています。
`handleMessageEvent` 内の画像処理フローで、この戻り値を正しくハンドリングし、対話モード（`sell_items` テーブルへの保存と質問メッセージの送信）が機能することを確認してください。

## 参考ファイル
*   `supabase/functions/oyadeki-webhook/index.ts` (修正対象)
*   `supabase/functions/_shared/gemini-client.ts` (変更済みの型定義)

## 優先度
高（本番環境へのデプロイがブロックされているため）
