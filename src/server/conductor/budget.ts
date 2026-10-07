import type { AppContext } from '../context.js';
import { withTx } from '../context.js';
import { DateTime } from 'luxon';
import { iso, ms } from '../lib/time.js';
import type { ConductorModel } from './model.js';
import type { RoomRow } from '../services/rows.js';
import { createAlert } from '../services/alerts.js';

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

export interface SpendOutlook {
  /** Month to date, every room, runs and briefs. */
  spent: number;
  /** Conductor runs this month that called a paid model. */
  paidRuns: number;
  /** Average cost of those runs (briefs are not runs), or null before the first one. */
  avgPerRun: number | null;
  /** Straight-line month-end total at this month's pace, or null before any spending. */
  projected: number | null;
  /** The day (yyyy-mm-dd, UTC) the budget would run out at this pace, if before the month ends. */
  runsOutOn: string | null;
}

const DAY_MS = 24 * 3600_000;

/**
 * Average cost per run and a month-end projection. The pace is this month's spend divided by the
 * time it covers: from the start of the month, or from the first paid call ever when Tempo started
 * spending mid-month, and never less than one day (so a busy first hour does not project wildly).
 * Every figure is Tempo's estimate from the tokens the API reported and the list prices above.
 */
export function spendOutlook(ctx: AppContext): SpendOutlook {
  const now = ctx.clock.now();
  const monthStart = DateTime.fromMillis(now, { zone: 'utc' }).startOf('month');
  const monthEnd = monthStart.plus({ months: 1 }).toMillis();
  const since = iso(monthStart.toMillis());
  const spent = monthSpend(ctx);
  const runs = ctx.db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS s FROM conductor_runs WHERE started_at >= ? AND cost_usd > 0')
    .get(since) as { n: number; s: number };
  const avgPerRun = runs.n > 0 ? runs.s / runs.n : null;
  if (spent <= 0) return { spent, paidRuns: runs.n, avgPerRun, projected: null, runsOutOn: null };
  // The first paid call ever. Walks the started_at index and stops at the first paid run, so it
  // stays quick as the run history grows (briefs are one a day per room).
  const firstRun = ctx.db.prepare('SELECT started_at AS t FROM conductor_runs WHERE cost_usd > 0 ORDER BY started_at LIMIT 1').get() as { t: string } | undefined;
  const firstBrief = ctx.db.prepare('SELECT MIN(created_at) AS t FROM briefs WHERE cost_usd > 0').get() as { t: string | null };
  const firsts = [firstRun?.t, firstBrief.t].filter((t): t is string => !!t).map(ms);
  const paceStart = Math.max(monthStart.toMillis(), firsts.length ? Math.min(...firsts) : monthStart.toMillis());
  const perMs = spent / Math.max(now - paceStart, DAY_MS);
  const projected = spent + perMs * Math.max(0, monthEnd - now);
  const budget = ctx.config.conductorMonthlyBudgetUsd;
  let runsOutOn: string | null = null;
  if (budget > 0 && spent < budget && projected > budget) {
    runsOutOn = DateTime.fromMillis(now + (budget - spent) / perMs, { zone: 'utc' }).toISODate();
  }
  return { spent, paidRuns: runs.n, avgPerRun, projected, runsOutOn };
}

/** The share of the budget at which admins are warned, once a month. */
export const BUDGET_WARNING_SHARE = 0.8;

/**
 * Warns every admin, once per calendar month, when the Conductor's spend passes 80% of the
 * monthly budget. The alert shows in the app and goes out by email and phone like any other.
 */
export function alertBudgetWarning(ctx: AppContext): void {
  const budget = ctx.config.conductorMonthlyBudgetUsd;
  if (!(budget > 0) || monthSpend(ctx) < budget * BUDGET_WARNING_SHARE) return;
  const month = monthStartIso(ctx.clock.now()).slice(0, 7);
  const key = (personId: string) => `budget80:${month}:${personId}`;
  const admins = (ctx.db.prepare(`SELECT id FROM people WHERE role = 'admin' AND disabled_at IS NULL`).all() as { id: string }[]).filter(
    (a) => !ctx.db.prepare('SELECT 1 FROM alerts WHERE dedupe_key = ?').get(key(a.id)),
  );
  if (admins.length === 0) return;
  const outlook = spendOutlook(ctx);
  const usd = (n: number) => `$${n.toFixed(2)}`;
  // Rounded down (81.9% reads as 81%), with a hair of slack so 0.018 of 0.02 reads as 90%, not 89%.
  const pct = Math.floor((outlook.spent / budget) * 100 + 1e-9);
  const usedUp = outlook.spent >= budget;
  const title = usedUp ? "Tempo: this month's Conductor budget is used up" : `Tempo: ${pct}% of this month's Conductor budget is used`;
  const pace =
    !usedUp && outlook.projected !== null
      ? outlook.runsOutOn
        ? ` At this pace it runs out around ${DateTime.fromISO(outlook.runsOutOn, { zone: 'utc' }).toFormat('MMMM d')}.`
        : ` At this pace the month ends at about ${usd(outlook.projected)}.`
      : '';
  const body =
    `The Conductor has used ${usd(outlook.spent)} of this month's ${usd(budget)} budget (${pct}%).${pace} ` +
    `When the budget is used up, every room acts as relay (only people give instructions) until next month. ` +
    `To allow more, raise CONDUCTOR_MONTHLY_BUDGET_USD and restart Tempo. These amounts are Tempo's estimate; your Anthropic bill is the final word.`;
  withTx(ctx, (emit) => {
    for (const a of admins) {
      createAlert(ctx.db, { personId: a.id, kind: 'budget_warning', title, body, dedupeKey: key(a.id), at: iso(ctx.clock.now()) }, emit);
    }
  });
}

/**
 * The budget is used up: no Conductor runs and no model-written briefs until next month (rooms act
 * as relay and briefs are written by rules). The screens say so using `budgetUsedUp`.
 */
export function budgetExhausted(ctx: AppContext): boolean {
  return budgetUsedUp(ctx, monthSpend(ctx));
}

/** The one test for "used up", given this month's spend. */
export function budgetUsedUp(ctx: AppContext, spent: number): boolean {
  return spent >= ctx.config.conductorMonthlyBudgetUsd;
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
          : 'Relay mode: the Conductor is off because there is no Anthropic API key. Only people give instructions; questions, answers and decisions still flow. Add ANTHROPIC_API_KEY to turn it on.',
    };
  }
  if (!model.scripted && budgetExhausted(ctx)) {
    return {
      mode: 'relay',
      reason: 'budget',
      banner: `Relay mode: this month's Conductor budget ($${ctx.config.conductorMonthlyBudgetUsd.toFixed(2)}) is used up, so only people give instructions until next month. Raise CONDUCTOR_MONTHLY_BUDGET_USD to continue.`,
    };
  }
  return { mode: room.conductor_mode, reason: 'ok', banner: null };
}
