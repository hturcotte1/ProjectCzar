import type { AppContext } from '../context.js';
import { DateTime } from 'luxon';
import { iso } from '../lib/time.js';
import type { ConductorModel } from './model.js';
import type { RoomRow } from '../services/rows.js';

/**
 * Cost control. One monthly budget covers every Conductor run and model-written daily brief.
 * When it is used up, or there is no API key, rooms behave as relay and show a banner.
 */

export interface Price {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

// Anthropic first-party prices per million tokens (checked 2026-10-03). Unknown models fall back to
// the configured override or to Sonnet pricing.
const PRICES: Record<string, Price> = {
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 },
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
};

export function priceFor(ctx: AppContext, model: string): Price {
  const base = PRICES[model] ?? PRICES['claude-sonnet-5-5'];
  return {
    ...base,
    inputPerMTok: ctx.config.conductorPriceInputPerMTok ?? base.inputPerMTok,
    outputPerMTok: ctx.config.conductorPriceOutputPerMTok ?? base.outputPerMTok,
  };
}

export function costUsd(
  price: Price,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number },
): number {
  return (
    (usage.input_tokens * price.inputPerMTok +
      usage.output_tokens * price.outputPerMTok +
      (usage.cache_read_input_tokens ?? 0) * price.cacheReadPerMTok +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWritePerMTok) /
    1_000_000
  );
}

export function monthStartIso(nowMs: number): string {
  return iso(DateTime.fromMillis(nowMs, { zone: 'utc' }).startOf('month').toMillis());
}

/** Month-to-date spend on the Conductor and model-written briefs, across all rooms (or one room). */
export function monthSpend(ctx: AppContext, roomId?: string): number {
  const since = monthStartIso(ctx.clock.now());
  const runs = ctx.db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS s FROM conductor_runs WHERE started_at >= ? ${roomId ? 'AND room_id = ?' : ''}`)
    .get(...(roomId ? [since, roomId] : [since])) as { s: number };
  const briefs = ctx.db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS s FROM briefs WHERE created_at >= ? ${roomId ? 'AND room_id = ?' : ''}`)
    .get(...(roomId ? [since, roomId] : [since])) as { s: number };
  return runs.s + briefs.s;
}

export function budgetExhausted(ctx: AppContext): boolean {
  return monthSpend(ctx) >= ctx.config.conductorMonthlyBudgetUsd;
}

/** Runs in the last hour that called (or tried to call) the model. */
export function modelRunsLastHour(ctx: AppContext, roomId: string): number {
  const since = iso(ctx.clock.now() - 3600_000);
  return (
    ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM conductor_runs WHERE room_id = ? AND started_at >= ? AND attempts > 0`)
      .get(roomId, since) as { n: number }
  ).n;
}

/**
 * The model a room's Conductor uses: the real one when an API key is set; in a sandbox room with
 * no key, the scripted rehearsal stand-in; otherwise none.
 */
export function modelForRoom(ctx: AppContext, room: RoomRow): ConductorModel | null {
  if (ctx.integrations.conductorModel) return ctx.integrations.conductorModel;
  if (room.is_sandbox && ctx.integrations.scriptedConductor) return ctx.integrations.scriptedConductor;
  return null;
}

export interface EffectiveMode {
  mode: 'autonomous' | 'propose' | 'relay';
  banner: string | null;
  reason: 'ok' | 'no_key' | 'budget';
}

export function effectiveMode(ctx: AppContext, room: RoomRow): EffectiveMode {
  const model = modelForRoom(ctx, room);
  if (!model) {
    return {
      mode: 'relay',
      reason: 'no_key',
      banner:
        room.conductor_mode === 'relay'
          ? null
          : 'The Conductor has no Anthropic API key, so this room runs in relay mode: instructions come only from people, and Tempo still routes questions, answers and decisions. Add ANTHROPIC_API_KEY to turn the Conductor on.',
    };
  }
  if (!model.scripted && budgetExhausted(ctx)) {
    return {
      mode: 'relay',
      reason: 'budget',
      banner: `This month's Conductor budget ($${ctx.config.conductorMonthlyBudgetUsd.toFixed(2)}) is used up, so every room runs in relay mode until next month. Raise CONDUCTOR_MONTHLY_BUDGET_USD to continue.`,
    };
  }
  return { mode: room.conductor_mode, reason: 'ok', banner: null };
}
