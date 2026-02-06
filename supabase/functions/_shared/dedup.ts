/**
 * イベント重複排除（2分間TTL）
 * MVP: インメモリMap。本番はSupabase KV等に移行
 */
const processedEvents = new Map<string, number>();
const DEDUP_TTL_MS = 2 * 60 * 1000; // 2分

function cleanup(map: Map<string, number>, ttl: number) {
  const now = Date.now();
  for (const [id, timestamp] of map) {
    if (now - timestamp > ttl) {
      map.delete(id);
    }
  }
}

export function isDuplicate(eventId: string): boolean {
  const now = Date.now();
  cleanup(processedEvents, DEDUP_TTL_MS);

  if (processedEvents.has(eventId)) {
    return true;
  }

  processedEvents.set(eventId, now);
  return false;
}

/**
 * ユーザー+アクション単位の重複排除（ボタン連打対策）
 * 同一ユーザーが同じアクションを短時間に複数回送った場合にブロック
 */
const processedActions = new Map<string, number>();
const ACTION_DEDUP_TTL_MS = 10 * 1000; // 10秒

export function isDuplicateAction(userId: string, action: string): boolean {
  const now = Date.now();
  cleanup(processedActions, ACTION_DEDUP_TTL_MS);

  const key = `${userId}:${action}`;
  if (processedActions.has(key)) {
    return true;
  }

  processedActions.set(key, now);
  return false;
}
