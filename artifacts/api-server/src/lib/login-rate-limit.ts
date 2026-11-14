// In-memory brute-force guard for POST /auth/login. Keyed by ip+username so
// one attacker guessing one account's password doesn't get unlimited tries,
// without penalizing other users sharing the same IP (e.g. a shop's shared
// wifi). Single-instance deployment (Railway/PM2 run one replica), so an
// in-memory map is sufficient — no Redis/DB round-trip needed for this.

const MAX_ATTEMPTS = 5;
// The client IP comes from X-Forwarded-For, which a caller can fake to look
// like a new IP on every try. So one username also has its own cap across
// all IPs: past it, that login is paused for the rest of the window.
const MAX_ATTEMPTS_PER_USERNAME = 20;
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

// "<ip>\n<username>" — a newline can't appear in either part, so the
// username is recoverable for the per-username counter below.
export function loginRateLimitKey(ip: string, username: string): string {
  return `${ip}\n${username.trim().toLowerCase()}`;
}

function usernameKey(key: string): string {
  return `user\n${key.slice(key.lastIndexOf("\n") + 1)}`;
}

function checkOne(key: string, max: number): { blocked: boolean; retryAfterMs: number } {
  const a = attempts.get(key);
  if (!a) return { blocked: false, retryAfterMs: 0 };
  const elapsed = Date.now() - a.firstAttemptAt;
  if (elapsed > WINDOW_MS) {
    attempts.delete(key);
    return { blocked: false, retryAfterMs: 0 };
  }
  if (a.count >= max) {
    return { blocked: true, retryAfterMs: WINDOW_MS - elapsed };
  }
  return { blocked: false, retryAfterMs: 0 };
}

export function checkLoginRateLimit(key: string): { blocked: boolean; retryAfterMs: number } {
  const pair = checkOne(key, MAX_ATTEMPTS);
  if (pair.blocked) return pair;
  return checkOne(usernameKey(key), MAX_ATTEMPTS_PER_USERNAME);
}

function bump(key: string): void {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.firstAttemptAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttemptAt: now });
    return;
  }
  a.count++;
}

export function recordLoginFailure(key: string): void {
  bump(key);
  bump(usernameKey(key));
}

export function clearLoginAttempts(key: string): void {
  attempts.delete(key);
  attempts.delete(usernameKey(key));
}
