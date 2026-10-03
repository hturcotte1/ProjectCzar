import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random secret with `bytes` bytes of entropy. */
export function randomSecret(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Agent keys, page tokens, session tokens and invite tokens are long random secrets,
 * so a fast one-way hash (SHA-256) is the right tool: there is nothing to brute-force.
 * Passwords use argon2id instead (see services/auth.ts).
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function newApiKey(): string {
  return `tempo_ak_${randomSecret(24)}`;
}

export function newPageToken(): string {
  return `pg_${randomSecret(24)}`;
}

/** A short, safe-to-display reminder of which key this is, e.g. "tempo_ak_…k3Qz". */
export function keyHint(secret: string): string {
  const prefix = secret.startsWith('tempo_ak_') ? 'tempo_ak_' : secret.startsWith('pg_') ? 'pg_' : '';
  return `${prefix}…${secret.slice(-4)}`;
}
