-- KPI計測用ビュー
-- usage_logsから主要指標を集計

CREATE OR REPLACE VIEW kpi_daily_stats AS
WITH daily_logs AS (
  SELECT
    date_trunc('day', created_at) AT TIME ZONE 'Asia/Tokyo' as day,
    action_type,
    meta,
    created_at
  FROM usage_logs
)
SELECT
  day,
  -- 1. 救急箱自動化率 (Vision利用数)
  COUNT(*) FILTER (WHERE action_type = 'vision_help') as vision_count,
  
  -- 2. 誤案内・エラー率 (Errorログ数 / 全体)
  COUNT(*) FILTER (WHERE action_type = 'error') as error_count,
  
  -- 3. 自作率 (ドラフト作成総数のうち、copy=falseが選ばれた数. ※まだcopyログが紐付いてないと正確ではないが概算)
  -- draft_gen_copyアクションで choice='self' のもの
  COUNT(*) FILTER (WHERE action_type = 'draft_gen_copy' AND meta->>'choice' = 'self') as self_write_count,
  
  -- 4. 通話誘導数 (Vision結果で result='call' または Call Suggestが表示された数...はログから厳密には難しいが、vision_feedbackで見る)
  COUNT(*) FILTER (WHERE action_type = 'vision_help_feedback' AND meta->>'result' = 'call') as vision_call_feedback_count,

  -- 5. レイテンシ (Vision Gen)
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (meta->>'latency_ms')::int) FILTER (WHERE action_type = 'vision_help') as vision_p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (meta->>'latency_ms')::int) FILTER (WHERE action_type = 'vision_help') as vision_p95_ms

FROM daily_logs
GROUP BY day
ORDER BY day DESC;
