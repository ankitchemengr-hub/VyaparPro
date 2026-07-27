// In-memory brute-force guard for POST /auth/login. Keyed by ip+username so
// one attacker guessing one account's password doesn't get unlimited tries,
// without penalizing other users sharing the same IP (e.g. a shop's shared
// wifi). Single-instance deployment (Railway/PM2 run one replica), so an
// in-memory map is sufficient — no Redis/DB round-trip needed for this.

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

interface Attempt {
  count: number;
  firstAttemptAt: number;
}

const attempts = new Map<string, Attempt>();

// Bound memory usage against an attacker cycling through many fake
// usernames/IPs to grow this map unboundedly — periodically drop anything
// older than the window since it's no longer relevant to any decision.
setInterval(() => {
  const now = Date.now();
  for (const [key, a] of attempts) {
    if (now - a.firstAttemptAt > WINDOW_MS) attempts.delete(key);
  }
}, CLEANUP_INTERVAL_MS).unref();

export function loginRateLimitKey(ip: string, username: string): string {
  return `${ip}:${username.trim().toLowerCase()}`;
}

export function checkLoginRateLimit(key: string): { blocked: boolean; retryAfterMs: number } {
  const a = attempts.get(key);
  if (!a) return { blocked: false, retryAfterMs: 0 };
  const elapsed = Date.now() - a.firstAttemptAt;
  if (elapsed > WINDOW_MS) {
    attempts.delete(key);
    return { blocked: false, retryAfterMs: 0 };
  }
  if (a.count >= MAX_ATTEMPTS) {
    return { blocked: true, retryAfterMs: WINDOW_MS - elapsed };
  }
  return { blocked: false, retryAfterMs: 0 };
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.firstAttemptAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttemptAt: now });
    return;
  }
  a.count++;
}

export function clearLoginAttempts(key: string): void {
  attempts.delete(key);
}
