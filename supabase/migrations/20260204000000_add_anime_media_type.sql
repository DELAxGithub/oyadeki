-- media_logsのmedia_type制約にanimeを追加
ALTER TABLE media_logs DROP CONSTRAINT media_logs_media_type_check;

ALTER TABLE media_logs ADD CONSTRAINT media_logs_media_type_check
CHECK (media_type IN ('movie', 'tv_show', 'anime', 'sports', 'music', 'book', 'other'));
