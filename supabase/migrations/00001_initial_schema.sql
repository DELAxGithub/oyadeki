-- user_contexts: ユーザー設定テーブル
CREATE TABLE user_contexts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  line_user_id text UNIQUE,
  metaphor_theme text NOT NULL DEFAULT 'ツェーゲン金沢',
  metaphor_enabled boolean NOT NULL DEFAULT false,
  tone text NOT NULL DEFAULT 'polite',
  disliked_phrases text[] NOT NULL DEFAULT '{}',
  timezone text NOT NULL DEFAULT 'Asia/Tokyo',
  consented_at timestamptz,
  settings_version int NOT NULL DEFAULT 1,
  updated_at timestamptz DEFAULT now()
);

-- usage_logs: 利用ログテーブル
CREATE TABLE usage_logs (
  id bigserial PRIMARY KEY,
  line_user_id text NOT NULL,
  action_type text CHECK (action_type IN
    ('draft_gen','vision_help','call_suggest','call_done_self_report','message','draft_gen_copy')) NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- インデックス
CREATE INDEX idx_usage_logs_line_user_id ON usage_logs(line_user_id);
CREATE INDEX idx_usage_logs_action_type ON usage_logs(action_type);
CREATE INDEX idx_usage_logs_created_at ON usage_logs(created_at);

-- RLS有効化
ALTER TABLE user_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- user_contextsポリシー: 本人のみ読み書き可
CREATE POLICY "owner_rw" ON user_contexts FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- usage_logs: サービスロールのみ書き込み（Edge Functionsから）
CREATE POLICY "service_insert" ON usage_logs FOR INSERT
  WITH CHECK (true);
CREATE POLICY "owner_read" ON usage_logs FOR SELECT
  USING (line_user_id IN (
    SELECT uc.line_user_id FROM user_contexts uc WHERE uc.user_id = auth.uid()
  ));

-- updated_at自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_contexts_updated_at
  BEFORE UPDATE ON user_contexts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
