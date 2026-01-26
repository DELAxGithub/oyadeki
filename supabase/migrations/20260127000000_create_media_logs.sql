-- media_logs: メディアログ（視聴記録）テーブル
CREATE TABLE media_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  line_user_id text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('movie', 'tv_show', 'sports', 'music', 'book', 'other')),
  title text NOT NULL,
  subtitle text,           -- エピソード名、対戦カードなど
  artist_or_cast text,     -- 出演者、チーム名
  year integer,            -- 公開年・放送年
  rating integer CHECK (rating >= 1 AND rating <= 5),
  comment text,
  image_url text,          -- サムネイル（optional）
  watched_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- インデックス
CREATE INDEX idx_media_logs_line_user_id ON media_logs(line_user_id);
CREATE INDEX idx_media_logs_watched_at ON media_logs(watched_at DESC);
CREATE INDEX idx_media_logs_media_type ON media_logs(media_type);

-- RLS有効化
ALTER TABLE media_logs ENABLE ROW LEVEL SECURITY;

-- media_logsポリシー: 本人のみ読み書き可
CREATE POLICY "owner_rw" ON media_logs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- usage_logsのaction_type更新（メディアログ用アクション追加）
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
  'media_identify',  -- 画像からメディア識別
  'media_rate',      -- 評価保存
  'media_comment',   -- コメント追加
  'media_list'       -- 履歴一覧表示
));

-- updated_atトリガー
CREATE TRIGGER update_media_logs_updated_at
  BEFORE UPDATE ON media_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
