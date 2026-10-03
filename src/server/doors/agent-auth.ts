import type { AppContext } from '../context.js';
import { TempoError, rateLimited, unauthorized, isTempoError } from '../lib/errors.js';
import { keyHint, sha256 } from '../lib/crypto.js';
import { iso } from '../lib/time.js';
import type { Door } from '../schemas/agent.js';
import { getAgent } from '../services/repo.js';
import type { AgentRow } from '../services/rows.js';

/**
 * Shared by every agent door: key and page-token checks, per-key rate limits, and the
 * connection log (every request, with the exact text the agent was shown).
 * Keys and tokens are never logged; only a short hint like "tempo_ak_…k3Qz".
 */

export interface AgentAuth {
  agent: AgentRow;
  keyId: string;
  keyHint: string;
}

/** Reads the agent key from "Authorization: Bearer <key>" or "X-API-Key: <key>". */
export function keyFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const auth = first(headers['authorization']);
  if (auth) {
    const m = /^\s*Bearer\s+(.+?)\s*$/i.exec(auth);
    if (m) return m[1];
    // Some clients send the bare key in Authorization.
    if (/^tempo_ak_/.test(auth.trim())) return auth.trim();
  }
  const x = first(headers['x-api-key']);
  if (x && x.trim()) return x.trim();
  return null;
}

export function authenticateSecret(ctx: AppContext, secret: string | null, kind: 'api' | 'page'): AgentAuth {
  if (!secret) throw unauthorized('missing');
  const row = ctx.db.prepare('SELECT * FROM agent_keys WHERE token_hash = ? AND kind = ?').get(sha256(secret), kind) as
    | { id: string; agent_id: string; revoked_at: string | null; last_used_at: string | null; hint: string }
    | undefined;
  if (!row) throw kind === 'page' ? pageNotFound() : unauthorized('invalid');
  if (row.revoked_at) throw kind === 'page' ? pageNotFound() : unauthorized('revoked');
  const agent = getAgent(ctx.db, row.agent_id);
  if (!agent || agent.archived_at) throw kind === 'page' ? pageNotFound() : unauthorized('revoked');
  const now = ctx.clock.now();
  if (!row.last_used_at || now - new Date(row.last_used_at).getTime() > 30_000) {
    ctx.db.prepare('UPDATE agent_keys SET last_used_at = ? WHERE id = ?').run(iso(now), row.id);
  }
  return { agent, keyId: row.id, keyHint: row.hint };
}

export function pageNotFound(): TempoError {
  return new TempoError(
    404,
    'page_not_found',
    'This Tempo page link is not valid. It may have been replaced with a new link. Ask your owner for your current Tempo page link.',
  );
}

/**
 * Sliding-window counter per key (an agent key, a client address, an account). Memory is bounded:
 * keys are kept short by callers, expired keys are dropped as they are seen and in a sweep, and
 * past MAX_KEYS the oldest keys are dropped.
 */
const MAX_KEYS = 20_000;
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastSweep = 0;
  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}
  private live(key: string, nowMs: number): number[] {
    const arr = (this.hits.get(key) ?? []).filter((t) => t > nowMs - this.windowMs);
    if (arr.length) this.hits.set(key, arr);
    else this.hits.delete(key);
    return arr;
  }
  private sweep(nowMs: number): void {
    // Expired keys: at most one full pass per window.
    if (nowMs - this.lastSweep >= this.windowMs) {
      this.lastSweep = nowMs;
      for (const [k, v] of this.hits) if (!v.some((t) => t > nowMs - this.windowMs)) this.hits.delete(k);
    }
    // Too many live keys: drop the least recently used tenth in one go (Map keeps insertion
    // order, and record() re-inserts), so this stays cheap per request even under a flood.
    if (this.hits.size > MAX_KEYS) {
      const target = Math.floor(MAX_KEYS * 0.9);
      for (const k of this.hits.keys()) {
        if (this.hits.size <= target) break;
        this.hits.delete(k);
      }
    }
  }
  check(key: string, nowMs: number): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const arr = this.live(key, nowMs);
    if (arr.length >= this.limit) {
      const retry = Math.max(1, Math.ceil((arr[0] + this.windowMs - nowMs) / 1000));
      return { ok: false, retryAfterSeconds: retry };
    }
    this.record(key, nowMs);
    return { ok: true };
  }
  /** True if the key is at its limit right now. Records nothing. */
  isBlocked(key: string, nowMs: number): { blocked: false } | { blocked: true; retryAfterSeconds: number } {
    const arr = this.live(key, nowMs);
    if (arr.length < this.limit) return { blocked: false };
    return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((arr[0] + this.windowMs - nowMs) / 1000)) };
  }
  /** Records one hit without checking (for counting failures after the fact). */
  record(key: string, nowMs: number): void {
    const arr = this.live(key, nowMs);
    arr.push(nowMs);
    this.hits.delete(key);
    this.hits.set(key, arr.slice(-Math.max(this.limit, 1)));
    this.sweep(nowMs);
  }
  /** How many keys are being tracked (for tests). */
  get size(): number {
    return this.hits.size;
  }
  reset(): void {
    this.hits.clear();
  }
}

export interface DoorLimits {
  perKey: RateLimiter;
  failedAuthPerClient: RateLimiter;
  /** While an address is over the failed-attempt limit, only one log row per minute is written. */
  floodLogged: RateLimiter;
}

export function makeDoorLimits(ctx: AppContext): DoorLimits {
  return {
    perKey: new RateLimiter(ctx.config.agentRateLimitPerMinute),
    failedAuthPerClient: new RateLimiter(30),
    floodLogged: new RateLimiter(1),
  };
}

export function enforceRateLimit(ctx: AppContext, limits: DoorLimits, keyId: string): void {
  const r = limits.perKey.check(keyId, Date.now());
  if (!r.ok) throw rateLimited(r.retryAfterSeconds, ctx.config.agentRateLimitPerMinute);
}

export interface ConnLogEntry {
  agentId: string | null;
  keyHint: string | null;
  door: Door;
  action: string;
  result: 'ok' | 'rejected' | 'error';
  httpStatus: number;
  message: string;
  cardId?: string | null;
  durationMs: number;
  client?: string | null;
}

export function logConnection(ctx: AppContext, e: ConnLogEntry): void {
  try {
    ctx.db
      .prepare(
        `INSERT INTO connection_log (agent_id, key_hint, at, door, action, result, http_status, message, card_id, duration_ms, client)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.agentId,
        e.keyHint,
        iso(ctx.clock.now()),
        e.door,
        e.action.slice(0, 80),
        e.result,
        e.httpStatus,
        e.message.slice(0, 4000),
        e.cardId ?? null,
        Math.round(e.durationMs),
        e.client ? e.client.slice(0, 200) : null,
      );
  } catch (err) {
    ctx.log.error({ err: (err as Error).message }, 'connection log write failed');
  }
}

/** Short hint for a presented secret that did not match any key (safe: last 4 characters only). */
export function presentedHint(secret: string | null): string | null {
  return secret ? keyHint(secret) : null;
}

/** For a failed request, the agent the presented key belonged to (revoked keys), if any. */
export function agentForSecret(ctx: AppContext, secret: string | null): string | null {
  if (!secret) return null;
  const row = ctx.db.prepare('SELECT agent_id FROM agent_keys WHERE token_hash = ?').get(sha256(secret)) as
    | { agent_id: string }
    | undefined;
  return row?.agent_id ?? null;
}

export function errorStatus(e: unknown): number {
  return isTempoError(e) ? e.status : 500;
}

export function internalError(): TempoError {
  return new TempoError(
    500,
    'internal_error',
    'Something went wrong inside Tempo while handling this request. Nothing was half-saved. Try again in a minute; if it keeps happening, tell your owner.',
  );
}
