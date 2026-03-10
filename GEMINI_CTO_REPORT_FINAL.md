# オヤデキ「見た」機能不具合調査レポート（最終版）

## 🚨 現状の重大な不具合
「見た」を押した直後に画像を送っても、アキネーター対話が始まらず、救急箱フロー（`handleHelpImageFlow`）へ落ちるケースが残っている。

---

## 1. 事実確認（コード照合結果）

### 1-1. モード強制ロジックは実装済み
- `isInMediaMode()` は存在し、5分以内の `media_mode_trigger` を見て `intent="media"` を強制する処理がある。  
  - `supabase/functions/oyadeki-webhook/index.ts:743`
  - `supabase/functions/oyadeki-webhook/index.ts:1668`

### 1-2. それでも救急箱へ落ちる分岐が残っている
- `intent === "media"` でも、`identifyMedia()` が `null` の場合は救急箱へフォールバックする実装。  
  - `supabase/functions/oyadeki-webhook/index.ts:1684`
  - `supabase/functions/oyadeki-webhook/index.ts:1727`

### 1-3. 「thinkingConfig削除済み」という記述と実装が不一致
- レポート上は削除済みとあるが、`identifyMedia()` / `continueMediaDialogue()` に `thinkingConfig` が残っている。  
  - `supabase/functions/_shared/gemini-client.ts:394`
  - `supabase/functions/_shared/gemini-client.ts:495`

---

## 2. 原因（確度順）

### A. 最有力: `identifyMedia()` が `null` を返し、救急箱へフォールバックしている
- `identifyMedia()` は以下で `null` を返す設計:
  1. Gemini APIが `!response.ok`
  2. JSONパース失敗
  3. `candidates/parts` 想定不一致
- その結果、`intent="media"` でも対話開始せず救急箱へ遷移する。

### B. 高確度: モデル設定・レスポンス処理の実装差分
- `thinkingConfig` 残存により、モデルとの相性次第で API 400/不正レスポンスを誘発する可能性がある。
- `identifyMedia failed: <status>` のログが出ても詳細ボディを記録しておらず、失敗理由の特定が遅れる。

### C. 中確度: `isInMediaMode()` の判定が脆い
- 最新1件の `usage_logs` のみに依存しており、別アクションが直後に記録されると false になる。
- 日時比較を文字列比較（`created_at >= fiveMinutesAgo`）で行っており、フォーマット差異に弱い。

---

## 3. 修正方針（実装優先度）

### P0（即時UX保護）
1. `isInMediaMode(userId) === true` のときは、`identifyMedia()` 失敗時に救急箱へ落とさない。  
2. 代わりに「メディア判定に失敗した」専用メッセージを返し、再撮影/再送信を促す。  

目的: ユーザー体験として「見た」→「救急箱」の誤遷移を即時停止する。

### P1（根本修正: 失敗率低減）
1. `identifyMedia()` / `continueMediaDialogue()` の `thinkingConfig` を削除（またはモデル適合を再確認して統一）。  
2. `!response.ok` 時に status だけでなくレスポンス本文を必ずログ出力。  
3. JSONパース失敗時に `parts` の生データ概要（サイズ・part種別）をログ出力。  

目的: なぜ `null` になるかを運用ログだけで再現可能にする。

### P2（モード判定の堅牢化）
1. `isInMediaMode()` は「最新1件」ではなく、5分以内の `media_mode_trigger` の存在有無で判定する。  
2. 時刻比較は文字列比較をやめ、`Date.parse(created_at)` と epoch millis で比較する。  
3. クエリエラー時は `false` を返すだけでなく、必ず `console.error` で観測可能にする。  

目的: モード判定抜けによる誤分類を防止する。

---

## 4. 検証計画（必須）

1. 「見た」送信 → 30秒以内に画像送信  
   - 期待: `Forcing intent: media (active mode)` が出る  
   - 期待: 救急箱ではなく `🎬` で始まる質問が返る  
2. `identifyMedia` を意図的に失敗させるケース  
   - 期待: 専用エラーメッセージを返し、救急箱には落ちない  
3. 5分超過後に画像送信  
   - 期待: 通常の `classifyImageIntent` 経由へ戻る  
4. ログ確認  
   - `identifyMedia failed` で status + body が取得できる  
   - `isInMediaMode` の判定根拠（created_at, now）が確認できる  

---

## 5. Done定義
1. 「見た」導線で、`identifyMedia` 失敗時に救急箱へ誤遷移しない。  
2. `identifyMedia` 失敗理由をログだけで特定できる。  
3. 5分モード判定が「直近1件依存」ではなく、5分窓で安定判定される。  

---
*Reported by Antigravity Agent (Revised)*
