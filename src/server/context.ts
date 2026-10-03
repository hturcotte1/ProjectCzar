import type { Config } from './config.js';
import type { Clock } from './clock.js';
import type { DB } from './db/index.js';
import { Bus, type BusEvent } from './lib/bus.js';

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Pluggable outside services, replaced by fakes in tests. */
export interface Integrations {
  /** The Conductor's model. Null when there is no API key (rooms then behave as relay). */
  conductorModel: import('./conductor/model.js').ConductorModel | null;
  /** The scripted stand-in Conductor used only in sandbox rooms when there is no API key. */
  scriptedConductor?: import('./conductor/model.js').ConductorModel | null;
  /** Sends one email. Null when email is not configured. */
  sendEmail: ((to: string, subject: string, text: string) => Promise<void>) | null;
  /** Sends one phone push through ntfy. */
  sendPush: ((topic: string, title: string, body: string, clickUrl?: string) => Promise<void>) | null;
}

export interface AppContext {
  db: DB;
  clock: Clock;
  config: Config;
  bus: Bus;
  log: Logger;
  integrations: Integrations;
}

export function nowIso(ctx: { clock: Clock }): string {
  return new Date(ctx.clock.now()).toISOString();
}

/**
 * Runs `fn` inside one SQLite transaction, then publishes the live-update events it queued.
 * Events are only published after a successful commit.
 */
export function withTx<T>(ctx: AppContext, fn: (emit: (e: BusEvent) => void) => T): T {
  const queued: BusEvent[] = [];
  const result = ctx.db.transaction(() => fn((e) => queued.push(e)))();
  for (const e of queued) ctx.bus.publish(e);
  return result;
}
