import liff from "@line/liff";

const LIFF_ID = Deno.env.get("LIFF_ID") ?? "";

let initialized = false;

/**
 * LIFF SDKを初期化
 */
export async function initLiff(): Promise<void> {
  if (initialized) return;

  await liff.init({ liffId: LIFF_ID });
  initialized = true;
}

/**
 * LINEログイン
 */
export function login(): void {
  if (!liff.isLoggedIn()) {
    liff.login();
  }
}

/**
 * LINEログアウト
 */
export function logout(): void {
  liff.logout();
}

/**
 * ログイン状態確認
 */
export function isLoggedIn(): boolean {
  return liff.isLoggedIn();
}

/**
 * LINEユーザーID取得
 */
export async function getLineUserId(): Promise<string | null> {
  if (!liff.isLoggedIn()) return null;
  const profile = await liff.getProfile();
  return profile.userId;
}

/**
 * LIFFブラウザ内かどうか
 */
export function isInClient(): boolean {
  return liff.isInClient();
}

/**
 * アクセストークン取得
 */
export function getAccessToken(): string | null {
  return liff.getAccessToken();
}

export { liff };
