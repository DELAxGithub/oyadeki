-- ledgers: 契約台帳テーブル
CREATE TABLE ledgers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  line_user_id text NOT NULL,
  service_name text NOT NULL,
  category text DEFAULT 'other', -- utility(公共料金), subscription(サブスク), insurance(保険), telecom(通信), other
  account_identifier text, -- ID番号やメアドなど（パスワードは不可）
  monthly_cost integer,
  note text, -- 解約方法やメモ
  status text DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  image_url text, -- 証憑画像のパス（Supabase Storage）
  last_confirmed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- インデックス
CREATE INDEX idx_ledgers_line_user_id ON ledgers(line_user_id);
CREATE INDEX idx_ledgers_created_at ON ledgers(created_at);

-- RLS有効化
ALTER TABLE ledgers ENABLE ROW LEVEL SECURITY;

-- ledgersポリシー: 本人のみ読み書き可（Edge FunctionsからはService RoleでアクセスするのでOKだが、念のため）
CREATE POLICY "owner_rw" ON ledgers FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- usage_logsのaction_type更新
ALTER TABLE usage_logs DROP CONSTRAINT usage_logs_action_type_check;

ALTER TABLE usage_logs ADD CONSTRAINT usage_logs_action_type_check 
CHECK (action_type IN (
  'draft_gen',
  'vision_help',
  'call_suggest',
  'call_done_self_report',
  'message',
  'draft_gen_copy',
  'vision_help_feedback',
  'error',
  'ledger_propose', -- 台帳登録の提案（AI -> User）
  'ledger_confirm', -- 台帳登録の確定（User -> DB）
  'ledger_list'     -- 台帳閲覧
));

-- updated_atトリガー
CREATE TRIGGER update_ledgers_updated_at
  BEFORE UPDATE ON ledgers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
