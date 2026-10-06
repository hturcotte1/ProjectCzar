import type { AppContext } from '../context.js';
import { withTx } from '../context.js';
import { iso } from '../lib/time.js';
import { alertBudgetWarning } from '../conductor/budget.js';
import { createAlert, deliverPendingAlerts } from '../services/alerts.js';
import { markCardIncomplete } from '../services/checkin.js';
import { roomPeople } from '../services/repo.js';
import type { CardRow, DecisionRow } from '../services/rows.js';
import { refreshAgentStatus } from '../services/status.js';

/**
 * The scheduler. It ticks about every 30 seconds (every 2 seconds while a sped-up sandbox room
 * is active) and works only from stored timestamps, so a restart loses nothing. Jobs that must
 * run once per period (daily brief, nightly backup) claim a row in job_runs first, which makes
 * double-firing impossible even across restarts.
 *
 * Extra jobs (Conductor runs and sweeps, daily briefs, backups) register themselves with
 * `addJob`, so this file doesn't depend on them.
 */

export interface Job {
  name: string;
  /** Runs inside a tick. May start background work; must not throw. */
  run(ctx: AppContext): Promise<void> | void;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  private readonly jobs: Job[] = [];
  private readonly background = new Set<Promise<unknown>>();

  constructor(private readonly ctx: AppContext) {}

  addJob(job: Job): void {
    this.jobs.push(job);
  }

  /** Track background work (e.g. a Conductor run) so tests and shutdown can wait for it. */
  track<T>(p: Promise<T>): Promise<T> {
    this.background.add(p);
    void p.finally(() => this.background.delete(p)).catch(() => {});
    return p;
  }

  async idle(): Promise<void> {
    while (this.background.size) await Promise.allSettled([...this.background]);
  }

  start(): void {
    this.stopped = false;
    this.schedule(1000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) await this.running;
    await this.idle();
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule(this.nextDelayMs()));
    }, ms);
    this.timer.unref?.();
  }

  private nextDelayMs(): number {
    const fast = this.ctx.db
      .prepare(
        `SELECT 1 FROM rooms r JOIN room_agents ra ON ra.room_id = r.id JOIN agents a ON a.id = ra.agent_id
         WHERE r.clock_speed > 1 AND r.archived_at IS NULL AND a.paused_at IS NULL AND a.archived_at IS NULL LIMIT 1`,
      )
      .get();
    return fast ? 2000 : Math.max(1, this.ctx.config.schedulerTickSeconds) * 1000;
  }

  /** One pass over every job. Safe to call directly (tests do, with a fake clock). */
  tick(): Promise<void> {
    if (this.running) return this.running;
    // The marker is cleared only after it was set: a tick with nothing to await finishes
    // synchronously, and clearing it from inside would leave a stale promise behind.
    const p: Promise<void> = (async () => {
      try {
        expireCards(this.ctx);
        refreshAllStatuses(this.ctx);
        alertWaitingDecisions(this.ctx);
        for (const job of this.jobs) {
          try {
            await job.run(this.ctx);
          } catch (e) {
            this.ctx.log.error({ job: job.name, err: (e as Error).message }, 'scheduled job failed');
          }
        }
        alertBudgetWarning(this.ctx);
        pruneLogs(this.ctx);
        // In the background: a slow mail server must never hold up the tick.
        this.track(deliverPendingAlerts(this.ctx)).catch((e) => this.ctx.log.error({ err: (e as Error).message }, 'alert delivery failed'));
      } catch (e) {
        this.ctx.log.error({ err: (e as Error).message, stack: (e as Error).stack }, 'scheduler tick failed');
      }
    })().finally(() => {
      if (this.running === p) this.running = null;
    });
    this.running = p;
    return p;
  }
}

/** Cards opened and not reported on within their window become incomplete check-ins. */
export function expireCards(ctx: AppContext): void {
  const now = iso(ctx.clock.now());
  const due = ctx.db.prepare(`SELECT * FROM cards WHERE status = 'open' AND expires_at <= ?`).all(now) as CardRow[];
  for (const card of due) {
    withTx(ctx, (emit) => {
      markCardIncomplete(ctx, card, emit);
      refreshAgentStatus(ctx, card.agent_id, emit);
    });
  }
}

export function refreshAllStatuses(ctx: AppContext): void {
  const ids = ctx.db.prepare('SELECT id FROM agents WHERE archived_at IS NULL').all() as { id: string }[];
  for (const { id } of ids) {
    withTx(ctx, (emit) => {
      refreshAgentStatus(ctx, id, emit);
    });
  }
}

/** Tell the people in a room when a decision is waiting on them (once per decision per person). */
export function alertWaitingDecisions(ctx: AppContext): void {
  const open = ctx.db
    .prepare(
      `SELECT d.* FROM decisions d WHERE d.status = 'open'
       AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.decision_id = d.id)`,
    )
    .all() as DecisionRow[];
  for (const d of open) {
    withTx(ctx, (emit) => {
      const room = ctx.db.prepare('SELECT name, is_sandbox FROM rooms WHERE id = ?').get(d.room_id) as { name: string; is_sandbox: number } | undefined;
      if (!room) return;
      const people = roomPeople(ctx.db, d.room_id);
      for (const p of people) {
        createAlert(
          ctx.db,
          {
            personId: p.id,
            kind: 'decision_waiting',
            roomId: d.room_id,
            decisionId: d.id,
            title: `Tempo: a decision is waiting in ${room.name}`,
            body: `A decision (${d.id}) is waiting for a person in room ${room.name}. Open Tempo to decide.`,
            dedupeKey: `decision:${d.id}:${p.id}`,
            at: iso(ctx.clock.now()),
          },
          emit,
        );
      }
    });
  }
}

/** Keep the connection log and sessions from growing forever. */
export function pruneLogs(ctx: AppContext): void {
  const cutoff = iso(ctx.clock.now() - 30 * 24 * 3600_000);
  ctx.db.prepare('DELETE FROM connection_log WHERE at < ?').run(cutoff);
  ctx.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(iso(ctx.clock.now()));
}
