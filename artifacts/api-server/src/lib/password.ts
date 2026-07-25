// Password hashing — Node's built-in scrypt (no native dependency, no
// cross-platform build issues). Stored format: "scrypt:<saltHex>:<keyHex>".
//
// Existing rows created before this file existed hold the raw plaintext
// password with no prefix — verifyPassword() falls back to a direct compare
// for those so nobody is locked out, and the one-time bootstrap migration
// (hashPlaintextPasswords in bootstrap.ts) rewrites every such row to a real
// hash on the next server start.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const PREFIX = "scrypt";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${PREFIX}:${salt}:${derived}`;
}

export function isHashed(stored: string): boolean {
  return stored.startsWith(`${PREFIX}:`);
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!isHashed(stored)) {
    // Legacy plaintext row — direct compare until the bootstrap migration
    // (or this user's next password change) rewrites it to a real hash.
    return password === stored;
  }
  const [, salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const keyBuffer = Buffer.from(key, "hex");
  const derived = scryptSync(password, salt, keyBuffer.length);
  return keyBuffer.length === derived.length && timingSafeEqual(keyBuffer, derived);
}
