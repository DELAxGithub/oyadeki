# LINE画像応答の沈黙問題 - 解決報告

## 発生事象
ユーザーがLINE Botに写真（TV画面の画像等）を送信しても、Botが一切反応せず沈黙する。
既読にはなるが、エラーメッセージも応答メッセージも返ってこない。
テキストメッセージ（「見た」等）にも無反応。

## 環境
- **Platform**: Supabase Edge Functions (Deno)
- **Function**: `oyadeki-webhook`
- **AI Model**: Google Gemini 2.0 Flash (via REST API)

---

## 根本原因の特定

### 原因1: インポートエラーによるBOOT_ERROR (致命的)

```typescript
// NG: std@0.177.0 には encodeBase64 が存在しない (encode のみ)
import { encodeBase64 } from "https://deno.land/std@0.177.0/encoding/base64.ts";
```

`deno.land/std@0.177.0/encoding/base64.ts` は `encode` / `decode` をエクスポートしており、
`encodeBase64` は存在しない（`encodeBase64` は std@0.194.0 以降で追加）。

このインポートエラーにより、Edge Functionがモジュール読み込み段階でクラッシュし、
HTTP 503 `BOOT_ERROR` を返す状態になっていた。
テキストメッセージも画像メッセージも、**すべてのリクエストが処理不能**。

### 原因2: JWT検証の有効化

`supabase functions deploy` はデフォルトで JWT 検証が有効。
LINE Webhook は Supabase の JWT を持たないため、`--no-verify-jwt` が必須。
このフラグなしでデプロイすると、Supabase API Gateway が全リクエストを 401 で拒否する。

---

## 実施した対策

### 2026-02-04 対応

1. **インポートエラーの修正** (`index.ts` 2行目):
   ```typescript
   // 修正前 (BOOT_ERROR)
   import { encodeBase64 } from "https://deno.land/std@0.177.0/encoding/base64.ts";

   // 修正後 (OK)
   import { encode as encodeBase64 } from "https://deno.land/std@0.177.0/encoding/base64.ts";
   ```

2. **`--no-verify-jwt` 付きで再デプロイ**:
   ```
   npx supabase link --project-ref xnzlfpzecupaoilinddx
   npx supabase functions deploy oyadeki-webhook --no-verify-jwt
   ```

3. **ヘルスチェック**: 署名なしリクエストで HTTP 401（関数コード自身のLINE署名検証による正常な拒否）を確認。
   BOOT_ERROR は解消され、Function が起動・リクエスト処理可能な状態。

---

## LIFF共有リンク404問題（同時修正）

Bot側の台帳共有リンク (`https://oyadeki-liff.deno.dev/share/:token`) が404を返していた問題も同時に解決。

- **原因**: Deno Deploy上のLIFFアプリが古いバージョンで、shareルートが含まれていなかった。また、TailwindCSS のahead-of-timeビルドが未実行だった。
- **対策**: `deno task build` でビルドアセット生成後、`deployctl deploy --prod` で本番デプロイ。
- **結果**: `https://oyadeki-liff.deno.dev/share/test-token-123` → HTTP 200

---

## 残課題

1. **LINE実機テスト**: 実際のLINEアプリから画像・テキストを送信して応答を確認してください。
2. **Supabaseログ監視**: デプロイ後の最初のリクエストでエラーが出ていないか、ダッシュボード（https://supabase.com/dashboard/project/xnzlfpzecupaoilinddx/functions）で確認。
3. **Deno Deploy環境変数**: LIFFアプリの `/api/share/[token]` が本番で正常動作するには、Deno Deploy側に `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` の環境変数が必要。ダッシュボードで設定済みか確認。
