/**
 * イベント重複排除（2分間TTL）
 * MVP: インメモリMap。本番はSupabase KV等に移行
 */
const processedEvents = new Map<string, number>();
const DEDUP_TTL_MS = 2 * 60 * 1000; // 2分

export function isDuplicate(eventId: string): boolean {
  const now = Date.now();

  // 古いエントリを削除
  for (const [id, timestamp] of processedEvents) {
    if (now - timestamp > DEDUP_TTL_MS) {
      processedEvents.delete(id);
    }
  }

  if (processedEvents.has(eventId)) {
    return true;
  }

  processedEvents.set(eventId, now);
  return false;
}
