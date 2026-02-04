-- reminders: シゴデキ（やること/リマインダー）テーブル
CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id text NOT NULL,
  group_id text,               -- LINE group_id (NULLなら個人リマインダー)
  title text NOT NULL,
  note text,
  due_at timestamptz,          -- 期限 (NULLなら期限なし)
  remind_at timestamptz,       -- 通知予定時刻
  recurrence text DEFAULT 'none'
    CHECK (recurrence IN ('none','daily','weekly','monthly')),
  status text DEFAULT 'pending'
    CHECK (status IN ('pending','completed','snoozed','cancelled')),
  completed_at timestamptz,
  completed_by text,           -- 完了した人の line_user_id
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- インデックス
CREATE INDEX idx_reminders_line_user ON reminders(line_user_id);
CREATE INDEX idx_reminders_group ON reminders(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX idx_reminders_due ON reminders(due_at) WHERE status = 'pending';
CREATE INDEX idx_reminders_remind ON reminders(remind_at)
  WHERE status = 'pending' AND remind_at IS NOT NULL;

-- RLS有効化
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- RLSポリシー: サービスロールは全操作可、一般ユーザーは本人のみ
CREATE POLICY "service_role_all" ON reminders FOR ALL
  USING (true) WITH CHECK (true);

-- updated_atトリガー
CREATE TRIGGER update_reminders_updated_at
  BEFORE UPDATE ON reminders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- usage_logsにリマインダー系action_typeを追加
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
  'ledger_share_create',
  'ledger_export',
  -- メディアログ用
  'media_identify',
  'media_rate',
  'media_comment',
  'media_list',
  'media_mode_trigger',
  'media_dialogue_start',
  'media_identify_dialogue_success',
  'media_chat',
  -- 出品サポート用
  'sell_mode_start',
  'listing_generate',
  'sell_dialogue_start',
  'sell_chat',
  -- リマインダー用
  'reminder_create',
  'reminder_complete',
  'reminder_snooze',
  'reminder_delete',
  'reminder_list'
));
