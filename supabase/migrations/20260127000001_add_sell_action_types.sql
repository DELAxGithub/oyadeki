-- 出品サポート用のaction_typeを追加
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
  -- 出品サポート用
  'sell_mode_start',
  'listing_generate'
));
