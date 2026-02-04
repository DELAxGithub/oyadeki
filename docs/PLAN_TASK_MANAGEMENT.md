# oyadeki タスク管理機能 実装プラン

## 概要

shigodekiで設計した数百件のタスクをoyadeki経由で親に配信し、
LINEでは「今日の3件」だけ見せ、全体管理はLIFFで行う。

## Phase 1: DB + LIFF一覧（MVP）

### 1.1 DBスキーマ（Supabase Migration）

```sql
-- supabase/migrations/20260205000000_create_tasks.sql

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

-- ポリシー: anon keyでも line_user_id で読み書き可（LIFF用）
-- Edge Functions は service_role でアクセス
CREATE POLICY "anon_crud_by_line_user_id" ON tasks FOR ALL
  USING (true);  -- LIFFは認証なしでアクセス（line_user_idで制御）

-- updated_atトリガー
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- usage_logs に task 関連アクションを追加
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
  'ledger_share_access',
  'ledger_export',
  'media_identify',
  'media_rate',
  'media_comment',
  'media_list',
  'sell_start',
  'sell_complete',
  -- タスク関連
  'task_import',         -- JSONインポート
  'task_complete',       -- タスク完了
  'task_skip',           -- タスクスキップ
  'task_daily_push',     -- 日次配信
  'task_list'            -- 一覧表示
));

-- 今日のタスク取得用ビュー
CREATE OR REPLACE VIEW today_tasks AS
SELECT *
FROM tasks
WHERE status = 'pending'
  AND (scheduled_date IS NULL OR scheduled_date <= CURRENT_DATE)
ORDER BY priority DESC, sort_order ASC;
```

### 1.2 LIFF API（routes/api/tasks/）

#### `routes/api/tasks/[userId].ts` - CRUD

```ts
// GET: タスク一覧取得（フィルタ対応）
// POST: タスク追加（単件）
// PATCH: タスク更新
// DELETE: タスク削除

interface TaskFilters {
  status?: 'pending' | 'done' | 'all';
  project?: string;
  phase?: string;
  limit?: number;
  offset?: number;
}
```

#### `routes/api/tasks/import.ts` - JSONインポート

```ts
// POST: 一括インポート
interface ImportRequest {
  line_user_id: string;
  tasks: {
    title: string;
    note?: string;
    project?: string;
    phase?: string;
    category?: string;
    assignee?: string;
    due_date?: string;      // ISO date
    scheduled_date?: string; // ISO date
    priority?: number;
  }[];
}

// Response
interface ImportResponse {
  imported: number;
  errors: { index: number; error: string }[];
}
```

### 1.3 LIFF Island（islands/TaskListView.tsx）

MediaLogViewをベースに以下を追加:

- **フィルタ機能**: プロジェクト・フェーズ・ステータスで絞り込み
- **進捗バー**: done / total を表示
- **完了トグル**: チェックボックスでステータス変更
- **グループ表示**: フェーズ別にグループ化

```
/tasks/[userId]
  ├── ヘッダー: プロジェクト名 + 進捗バー
  ├── フィルタ: [全て] [未完了] [完了] + フェーズ選択
  └── リスト:
      ├── Phase 1: 電気・ガス・水道
      │   ├── □ 電気の検針票を探す
      │   ├── ✅ ガスの請求書を確認
      │   └── □ 水道の契約番号を確認
      └── Phase 2: 通信・放送
          ├── □ スマホの契約内容を確認
          └── ...
```

### 1.4 ファイル構成

```
liff/
├── routes/
│   ├── tasks/
│   │   └── [userId].tsx          # SSRルート
│   └── api/
│       └── tasks/
│           ├── [userId].ts       # CRUD API
│           └── import.ts         # インポートAPI
└── islands/
    └── TaskListView.tsx          # 一覧コンポーネント

supabase/
└── migrations/
    └── 20260205000000_create_tasks.sql
```

---

## Phase 2: Bot連携（日次配信）

### 2.1 日次配信Edge Function

```
supabase/functions/daily-task-push/index.ts

- 毎朝8:00に実行（cron）
- today_tasks ビューから各ユーザーの上位3件を取得
- Flex Message で配信
- task_daily_push をログ記録
```

### 2.2 完了報告（webhook拡張）

```
oyadeki-webhook/index.ts に追加:

- 「完了」「できた」「✅」テキスト → 直前のタスクを完了
- Postback action で task_id を受け取り → ステータス更新
- 完了時に次のタスクを1件追加で表示
```

### 2.3 Flex Message設計

```
━━━━━━━━━━━━━━━
☀️ 今日のやること

□ 電気の検針票を探す
   └ 見つけたら写真送ってね

□ ガスの請求書も確認
   └ 同じ棚にあるかも

□ 水道の契約番号をメモ
   └ 検針票の右上に記載

[完了を報告] [全部見る→LIFF]
━━━━━━━━━━━━━━━
```

---

## Phase 3: shigodeki連携（将来）

### 3.1 エクスポート形式

shigodeki側でJSONエクスポート機能を追加:

```json
{
  "project": "実家ライフライン棚卸し",
  "exported_at": "2026-02-05T10:00:00Z",
  "tasks": [
    {
      "title": "電気の検針票を探す",
      "phase": "電気・ガス・水道",
      "note": "見つけたら写真を撮って送る",
      "priority": 10,
      "scheduled_date": "2026-02-06"
    },
    ...
  ]
}
```

### 3.2 Webhook連携（将来）

shigodeki → oyadeki のリアルタイム同期は複雑なので、
まずは手動JSONインポートで運用し、需要を見て検討。

---

## 実装順序

1. **Migration**: `20260205000000_create_tasks.sql` を作成・適用
2. **API**: `/api/tasks/[userId].ts` と `/api/tasks/import.ts`
3. **Island**: `TaskListView.tsx`
4. **Route**: `/tasks/[userId].tsx`
5. **テスト**: mock data で動作確認
6. **Deploy**: Deno Deploy + Supabase

---

## 見積もり

| 項目 | 工数 |
|------|------|
| Phase 1 (DB + LIFF) | 2-3時間 |
| Phase 2 (Bot連携) | 2-3時間 |
| Phase 3 (shigodeki連携) | 後日 |

---

## 懸念点・決めること

1. **RLSポリシー**: 現状の設計は `line_user_id` さえ分かれば誰でも読み書きできる。セキュリティを強化するなら LIFF認証 → Supabase JWT が必要だが、MVPでは後回し？

2. **scheduled_date の自動設定**: インポート時に自動で振り分けるか、手動で設定するか？

3. **完了時の挙動**: 完了したらリストから消すか、打ち消し線で残すか？

4. **親 vs 子の権限**: 親は完了報告のみ、子は編集可能、という区別は必要？

---

*作成日: 2026-02-05*
