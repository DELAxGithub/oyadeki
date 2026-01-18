-- usage_logsのaction_type制約を更新（error, vision_help_feedbackを追加）
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
  'error'
));
