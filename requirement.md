了解。最新の合意内容と事前検死を反映して、要件定義 v1.3とロードマップをまとめました。MVPは「LINE＝唯一のUI」「触媒（下書き・話題・通話ブリッジ）に特化」「時差計算なし」です。

要件定義書『オヤデキ（親デキ）』v1.3

1. 目的・スコープ
	•	目的：親の自走を促す“親子コミュニケーション触媒”。AIは下書き・話題タネ・通話ブリッジのみ。
	•	対象：LINEトーク上で完結（設定はLIFF補助）。
	•	MVP外：時差計算／外部スクレイピング／自動出品／長期の本文保存。

2. 成功指標（計測可能版）
	•	自作率：返信カードの「自分で書く」選択率 ≥ 30%。
	•	コピー採用率：A/B/Cコピー比率（ドラフトIDで厳密計測）。
	•	通話誘発：call_suggest後 T+6h の「通話できた？」応答率 ≥ 40%。
	•	レイテンシ：P50 ≤ 3.5s／P95 ≤ 7s（draft/vision）。
	•	救急箱の誤案内：10件中 ≤ 1件（W4判定基準に従う）。

3. システム構成
	•	UI：LINE（Messaging API／リッチメニュー）。
	•	設定UI：LIFF（Vercel + React/Vite）。
	•	API/実行：Supabase Edge Functions（Deno）。
	•	DB：Supabase（PostgreSQL, RLS有効）。
	•	AI：Gemini 1.5 Pro（必要に応じFlashへフォールバック）。
	•	※早期検証に限り「GAS+スプシ」プロトも許容（本番はSupabase）。

4. 機能要件（MVP）

4.1 触媒チャット（下書き生成）
	•	入力：子/親のテキスト。
	•	出力：下書き3案（各80字以内）＋開かれた質問1つ＋通話誘導文1つ。
	•	UI：返信カードに**「Aをコピー／Bをコピー／Cをコピー／自分で書く」**の4ボタン（コピー時のみログ記録）。
	•	ルール：文頭に【AI下書き】、NG語の除外、メタファーは最大1つ、代理送信なし。

4.2 デジタル救急箱（Vision）
	•	入力：スクショ画像。
	•	出力：最大3手順＋PII注意一文＋確認質問。不確実なら手順なしで質問のみ。

4.3 通話ブリッジ
	•	出力：定型文「文字より話した方が早そう。5分だけ通話どう？」
	•	フロー：提案直後のワンタップ確認＋T+6h再確認（スヌーズ1回）。

4.4 LIFF設定（特大UI）
	•	項目：metaphor_theme（例：ツェーゲン金沢）／metaphor_enabled（初期OFF）／tone／disliked_phrases／同意。
	•	同意：越境処理の明示・consented_at保存。

4.5 ロギング
	•	usage_logs に action_type（draft_gen,vision_help,call_suggest,message ほか）＋meta（draft_id,copy,latency_ms 等）。
	•	本文は保存しない。障害時のみ同意の上24h暗号化一時保管（任意機能）。

4.6 リッチメニュー（最小）
	•	「見た！」「設定」「通話したい」3ボタン。48px相当以上のタップ領域。

5. 非機能要件
	•	パフォーマンス：P50 ≤ 3.5s／P95 ≤ 7s。3s超は短文テンプレ即返→任意で後追いプッシュ。
	•	可用性：99%（営業時間）。
	•	セキュリティ：LINE署名検証必須／画像短期保存または非保存／サービスキーはEdgeのみ。
	•	プライバシー：APPI準拠・越境同意・削除自己実行（CASCADE）。
	•	アクセシビリティ：文字18px＋、コントラスト4.5:1＋、ボタン高さ48px＋。
	•	監視：エラー率>2% or P95>7s（5分窓）でSlack通知。

6. データモデル（拡張反映）

create table user_contexts (
  user_id uuid primary key references auth.users(id),
  line_user_id text unique,
  metaphor_theme text not null default 'ツェーゲン金沢',
  metaphor_enabled boolean not null default false,
  tone text not null default 'polite',
  disliked_phrases text[] not null default '{}',
  timezone text not null default 'Asia/Tokyo',
  consented_at timestamptz,
  settings_version int not null default 1,
  updated_at timestamptz default now()
);

create table usage_logs (
  id bigserial primary key,
  line_user_id text not null,
  action_type text check (action_type in
    ('draft_gen','vision_help','call_suggest','call_done_self_report','message','draft_gen_copy')) not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table user_contexts enable row level security;
create policy "owner rw" on user_contexts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

7. 外部IF
	•	Webhook（Edge）：POST /functions/v1/oyadeki-webhook（署名検証・重複排除・timeoutフォールバック実装）。
	•	LIFF API（Vercel）：GET/POST /api/user-context。
	•	Gemini：/models/gemini-1.5-pro:generateContent（Fallback: Flash）。

8. エラーハンドリング/フォールバック
	•	3s超：短文テンプレ即返（timeout_fallback=trueをログ）。
	•	replyToken失効：プッシュ送信へ切替（運用方針をドキュメント化）。
	•	重複イベント：eventIdを短期KVで2分間デデュープ。
	•	JSON崩れ：素テキストで返す＋parse_ok=falseログ。

9. 受け入れ基準（MVP）
	•	テキスト→A/B/C＋質問＋通話文がP50 3.5s以内。
	•	画像→最大3手順＋注意＋質問（信頼低→質問のみ）。
	•	返信カードのコピー計測がusage_logs.metaに記録。
	•	LIFF設定→次回返信に反映。
	•	call_suggest→T+6h確認が送出・集計される。

⸻

ロードマップ v1.3（6週想定）

W0（任意）：GASスパイク
	•	目的：体感確認。LINE↔GAS↔Gemini疎通（署名検証なし）。
	•	成果物：最小往復の動画・学びのメモ。→ 本線はSupabaseへ。

W1：疎通MVP／計測土台
	•	Edge関数（署名検証・デデュープ・timeoutフォールバック）。
	•	user_contexts/usage_logs + RLS。
	•	下書きA/B/C＋質問＋通話文を返し、draft_gen/latency_ms計測。
	•	Exit：P50 ≤3.5s／ログ記録OK。

W2：LIFF設定（特大UI）
	•	趣味/トーン/NG語/メタファーON-OFF/同意（consented_at）。
	•	LINEログイン紐付け（line_user_id）。
	•	Exit：設定変更→次返信に反映。

W3：コピー計測＆“自作”誘導
	•	返信カードに「A/B/Cコピー／自分で書く」。
	•	draft_gen_copy（draft_id,copy:true）と自作（copy:false）を記録。
	•	Exit：テスト家庭で自作率≥30%。

W4：救急箱β（Vision）
	•	画像→注意喚起→最大3手順／低確信は質問のみ。
	•	Exit：10件中誤案内≤1件、注意喚起100%。

W5：通話ブリッジ運用
	•	call_suggest直後の確認＋T+6h追跡。
	•	LIFFに「通話できた」ボタン（call_done_self_report）。
	•	Exit：通話誘発応答率≥40%。

W6：観測と安定化
	•	週次ダッシュ（往復数・自作率・通話誘発・P50/P95）。
	•	監視（Slack通知）と運用Runbook。
	•	Exit：KPIが週次で可視化、運用手順完成。

W7：メディアログ一覧のWeb化（LIFF導入）調査
	•	目的：LINEカルーセルUI（最大10件）の限界による検索難の解消。
	•	内容：LIFFアプリ開発（React+Vite）、Supabaseホスティング検討、検索/グリッドUI実装。
	•	Exit：LIFF上でのメディアリスト閲覧プロトタイプ完了。

⸻

このv1.3で、測れるKPIと触媒に集中した最小実装が揃います。
