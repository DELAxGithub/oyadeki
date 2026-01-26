-- ledger_shares: 台帳共有トークンテーブル
-- グループへの共有リンク発行と有効期限管理

CREATE TABLE ledger_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id text NOT NULL,                    -- 共有を作成したユーザー
  group_id text,                                  -- 共有先のグループID (nullの場合は全体共有)
  token text UNIQUE NOT NULL,                     -- 一意の共有トークン
  expires_at timestamptz NOT NULL,                -- 有効期限
  accessed_count integer DEFAULT 0,               -- アクセス回数
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- インデックス
CREATE INDEX idx_ledger_shares_token ON ledger_shares(token);
CREATE INDEX idx_ledger_shares_line_user_id ON ledger_shares(line_user_id);
CREATE INDEX idx_ledger_shares_expires_at ON ledger_shares(expires_at);

-- RLS有効化（Edge FunctionsはService Roleでアクセス）
ALTER TABLE ledger_shares ENABLE ROW LEVEL SECURITY;

-- share_access_logs: 共有アクセスログ
-- 誰がいつ共有台帳を閲覧したかを記録

CREATE TABLE share_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid REFERENCES ledger_shares(id) ON DELETE CASCADE,
  accessor_line_user_id text,                     -- アクセスしたユーザー (nullの場合は匿名)
  accessed_at timestamptz DEFAULT now(),
  ip_hint text                                    -- IPアドレスの末尾2桁のみ（プライバシー配慮）
);

CREATE INDEX idx_share_access_logs_share_id ON share_access_logs(share_id);

-- usage_logsのaction_type更新（共有関連を追加）
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
  'ledger_propose',
  'ledger_confirm',
  'ledger_list',
  'ledger_share_create',   -- 共有リンク作成
  'ledger_share_access',   -- 共有リンクアクセス
  'ledger_export'          -- エクスポート
));

-- 未確認台帳ビュー（棚卸し機能用）
CREATE OR REPLACE VIEW unconfirmed_ledgers AS
SELECT
  line_user_id,
  COUNT(*) AS total_count,
  COUNT(*) FILTER (WHERE last_confirmed_at < NOW() - INTERVAL '7 days') AS unconfirmed_count,
  SUM(monthly_cost) AS total_monthly_cost
FROM ledgers
WHERE status = 'active'
GROUP BY line_user_id;

-- updated_atトリガー
CREATE TRIGGER update_ledger_shares_updated_at
  BEFORE UPDATE ON ledger_shares
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
