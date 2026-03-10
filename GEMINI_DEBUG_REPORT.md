# オヤデキ「売る」コマンド不具合調査レポート

## 🚨 現状の課題
LINE Bot「オヤデキ」において、**「売る」「出品」「メルカリ」** と送信しても、Botからの返信が一切ない（既読スルー状態になる）。
他のコマンド（例：「メニュー」）は正常に動作し、Flex Messageも表示される。

## 🛠 実施した調査と結果

### 1. ログ周りのエラー検証
- **仮説:** `logUsage` (Supabaseへのログ保存) がRLSポリシーなどで失敗し、処理が止まっているのでは？
- **検証:** `logUsage` を `try-catch` で囲み、失敗しても返信処理に進むように修正。
- **結果:** **変化なし（無反応のまま）。**

### 2. コマンド判定ロジックの検証
- **仮説:** `if` 文の条件分岐に入っていない、または他の分岐に吸われているのでは？
- **検証:** 「売る」の判定ロジックを `handleMessageEvent` 関数の **最上部（最初）** に移動。
- **結果:** **変化なし（無反応のまま）。**

### 3. Flex Message の特定検証（クリティカル）
- **仮説:** `buildSellSupportFlexMessage()` が生成するJSONデータが不正で、LINE API呼び出し時、またはその直前でプロセスがクラッシュしているのでは？
- **検証:** Flex Messageの送信処理をコメントアウトし、単純なテキストメッセージ `「出品モード起動！（テスト）」` だけを返すように変更。
- **結果:** **返信が来た！**
    - ユーザーから「出品モード起動！って出た」との報告あり。
    - これにより、**ロジック自体は正常に通過しており、Flex Messageの組み立てまたは送信部分に致命的な原因がある** ことが確定。

### 4. 再発確認
- **検証:** テキスト返信で成功したため、再度 `buildSellSupportFlexMessage()` を有効化してデプロイ。
- **結果:** **再び無反応に戻った。**

## 🔍 原因の結論
**関数 `buildSellSupportFlexMessage()` が生成する Flex Message の JSON オブジェクトに、LINE Messaging API が許容しない不正な記述、またはランタイムエラーを引き起こすコードが含まれている。**

### 疑わしいポイント
現在の `index.ts` 内の定義において：
1.  **JSON構造:** `contents` の入れ子構造が深すぎる、または必須プロパティ (`type`, `layout`) の欠落。
2.  **サイズ制限:** データサイズが大きすぎる（可能性は低い）。
3.  **未定義変数の参照:** 関数内で参照している変数や定数が `undefined` になっていないか。

## 📝 修正提案 / 次のアクション

### 推奨アクション: 包括修正（原因特定済み）

#### 1. 直接原因の修正（最優先）
`buildSellSupportFlexMessage()` の footer ボタンで `camera` / `cameraRoll` を action に使っている点が最有力原因。  
これらは **Quick Reply 専用 action** であり、Flex button action に置くと LINE API 側で reject される可能性が高い。

- 対象箇所:
  - `supabase/functions/oyadeki-webhook/index.ts:377`
  - `supabase/functions/oyadeki-webhook/index.ts:382`
- 修正方針:
  1. Flex button action は `message` / `postback` / `uri` のみに限定する
  2. `camera` / `cameraRoll` は Quick Reply 側に移動する
  3. まずは「テキスト + Quick Reply」で復旧し、その後必要なら Flex を再導入する

#### 2. 横展開監査（同種不具合の全除去）
同じ `camera` / `cameraRoll` の誤用が他フローにもあるため、今回まとめて修正する。

- `supabase/functions/oyadeki-webhook/index.ts:981`
- `supabase/functions/oyadeki-webhook/index.ts:982`
- `supabase/functions/oyadeki-webhook/index.ts:1002`
- `supabase/functions/oyadeki-webhook/index.ts:1003`
- `supabase/functions/oyadeki-webhook/index.ts:1526`（Quick Reply 内なので仕様上 OK）

監査ルール:
- `camera` / `cameraRoll` / `location` は Quick Reply 以外で使わない
- Flex / Template の action は許可タイプのみ使う

#### 3. 実装修正の順序（復旧優先）
1. 「売る」導線を最小構成（テキスト + Quick Reply）で先に復旧
2. 「見たもの」「台帳」導線の同種 action を修正
3. 必要なら「売る」導線を Flex に戻す（action 制約を守った構成で）

#### 4. 検証手順（必須）
- 仕様検証:
  - LINE のメッセージ検証エンドポイント、または Flex Simulator で payload を事前検証する
- 実機検証:
  - 「売る」「出品」「メルカリ」で毎回返信が返る
  - 「見た」「台帳」でも無反応が再発しない
  - Quick Reply の「カメラ」「ライブラリ」が起動する
- 回帰確認:
  - 「メニュー」は従来どおり表示される

#### 5. 再発防止
- `replyMessage FAILED` のエラーボディ（`details.property` など）をログに残し、失敗フィールドを即特定できるようにする
- PR チェックで「Quick Reply 専用 action が Flex / Template に混在していないか」を静的確認する

### 参考仕様
- LINE Messaging API: Camera action（Quick Reply 専用）  
  https://developers.line.biz/en/reference/messaging-api/nojs/#camera-action
- LINE Messaging API: Camera roll action（Quick Reply 専用）  
  https://developers.line.biz/en/reference/messaging-api/nojs/#camera-roll-action

---
*Reported by Antigravity Agent*
