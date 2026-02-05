-- user_contextsのPRIMARY KEYをline_user_idに変更
-- LIFFからはSupabase Authを使わないため、line_user_idで管理する

-- 0. usage_logsの依存ポリシーを先に削除
DROP POLICY IF EXISTS "owner_read" ON usage_logs;

-- 1. 既存のRLSポリシーを削除
DROP POLICY IF EXISTS "owner_rw" ON user_contexts;

-- 2. 外部キー制約を削除
ALTER TABLE user_contexts DROP CONSTRAINT IF EXISTS user_contexts_pkey CASCADE;
ALTER TABLE user_contexts DROP CONSTRAINT IF EXISTS user_contexts_user_id_fkey;

-- 3. user_idカラムを削除（使わない）
ALTER TABLE user_contexts DROP COLUMN IF EXISTS user_id;

-- 4. line_user_idをPRIMARY KEYに設定
ALTER TABLE user_contexts ADD PRIMARY KEY (line_user_id);

-- 5. NOT NULL制約を追加
ALTER TABLE user_contexts ALTER COLUMN line_user_id SET NOT NULL;

-- 6. 新しいRLSポリシー（service_roleからのアクセスを許可）
-- service_role keyはRLSをバイパスするので、特に設定不要
-- 念のため、anon keyでも読み書きできるようにする（LIFFはpublic access）
CREATE POLICY "public_crud_by_line_user_id" ON user_contexts FOR ALL
  USING (true)
  WITH CHECK (true);

-- 7. usage_logsの新しいポリシー（line_user_idで直接参照）
CREATE POLICY "public_read_by_line_user_id" ON usage_logs FOR SELECT
  USING (true);
