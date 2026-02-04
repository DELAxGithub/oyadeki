-- user_contextsに保管場所リストを追加
ALTER TABLE user_contexts ADD COLUMN storage_locations text[] NOT NULL DEFAULT '{}';

-- ledgersに保管場所カラムを追加
ALTER TABLE ledgers ADD COLUMN storage_location text;
