/**
 * `localStorage` access that never throws.
 *
 * Storage is unavailable in private browsing, can be full, and can be blocked
 * entirely by policy. Every caller treats persistence as best-effort, so a
 * failure here is logged once and swallowed.
 */

let warned = false;

function warnOnce(error: unknown) {
  if (warned) return;
  warned = true;
  console.warn("[storage] persistent storage unavailable — state will not survive reload:", error);
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch (error) {
    warnOnce(error);
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    warnOnce(error);
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    warnOnce(error);
  }
}

/** Short, collision-resistant id for client-side records. */
export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
