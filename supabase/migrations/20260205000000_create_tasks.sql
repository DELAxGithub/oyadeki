-- tasks: タスク管理テーブル
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id text NOT NULL,

  -- 基本情報
  title text NOT NULL,
  note text,

  -- 分類
  project text,              -- プロジェクト名（例: "ライフライン棚卸し"）
  phase text,                -- フェーズ名（例: "電気・ガス・水道"）
  category text,             -- カテゴリ（例: "契約確認", "断捨離"）

  -- 担当・状態
  assignee text,             -- 担当者名（例: "お父さん", "Dela"）
  status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'done', 'skipped')),

  -- スケジュール
  due_date date,             -- 期限日
  scheduled_date date,       -- 配信予定日（この日に親へPush）
  priority int DEFAULT 0,    -- 優先度（高いほど先に配信）

  -- 並び順
  sort_order int DEFAULT 0,

  -- タイムスタンプ
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- インデックス
CREATE INDEX idx_tasks_line_user_id ON tasks(line_user_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_scheduled_date ON tasks(scheduled_date);
CREATE INDEX idx_tasks_project ON tasks(project);
CREATE INDEX idx_tasks_phase ON tasks(phase);

-- RLS有効化
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- ポリシー: anon keyでも line_user_id ベースで読み書き可（LIFF用）
-- Edge Functions は service_role でアクセス
CREATE POLICY "anon_select" ON tasks FOR SELECT USING (true);
CREATE POLICY "anon_insert" ON tasks FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update" ON tasks FOR UPDATE USING (true);
CREATE POLICY "anon_delete" ON tasks FOR DELETE USING (true);

-- updated_atトリガー
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- usage_logs の制約を一旦削除して、より緩い制約に更新
-- 既存データとの互換性のため、全ての既知action_typeを含める
ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_action_type_check;

-- 制約なしで運用（後で必要なら追加）
-- 注: action_type は text型なので、アプリ側でバリデーションする

-- 今日のタスク取得用ビュー
CREATE OR REPLACE VIEW today_tasks AS
SELECT *
FROM tasks
WHERE status = 'pending'
  AND (scheduled_date IS NULL OR scheduled_date <= CURRENT_DATE)
ORDER BY priority DESC, sort_order ASC;
