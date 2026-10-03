import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';
import { nextId, parseJson } from '../db/index.js';
import type { BusEvent } from '../lib/bus.js';
import { iso } from '../lib/time.js';
import { getPerson } from './repo.js';

/**
 * Alerts for people. Every alert is stored and shown in the app. Email and phone push are
 * optional extra channels, sent after the transaction that created the alert commits.
 *
 * Alert text never includes project content: only agent names, room names and status.
 */
export type AlertKind = 'agent_red' | 'agent_recovered' | 'decision_waiting';

export interface AlertRow {
  id: string;
  person_id: string;
  kind: AlertKind;
  agent_id: string | null;
  room_id: string | null;
  incident_id: string | null;
  decision_id: string | null;
  title: string;
  body: string;
  dedupe_key: string | null;
  created_at: string;
  read_at: string | null;
  deliveries: string;
}

export function createAlert(
  db: DB,
  a: {
    personId: string;
    kind: AlertKind;
    agentId?: string | null;
    roomId?: string | null;
    incidentId?: string | null;
    decisionId?: string | null;
    title: string;
    body: string;
    dedupeKey: string;
    at: string;
  },
  emit: (e: BusEvent) => void,
): string | null {
  const exists = db.prepare('SELECT id FROM alerts WHERE dedupe_key = ?').get(a.dedupeKey);
  if (exists) return null;
  const id = nextId(db, 'alr');
  db.prepare(
    `INSERT INTO alerts (id, person_id, kind, agent_id, room_id, incident_id, decision_id, title, body, dedupe_key, created_at, deliveries)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
  ).run(
    id,
    a.personId,
    a.kind,
    a.agentId ?? null,
    a.roomId ?? null,
    a.incidentId ?? null,
    a.decisionId ?? null,
    a.title,
    a.body,
    a.dedupeKey,
    a.at,
  );
  emit({ type: 'alert', personId: a.personId, alertId: id });
  return id;
}

let delivering: Promise<void> | null = null;

/**
 * Sends email and push for alerts that have not been attempted yet. Safe to call often; only one
 * delivery pass runs at a time, and each alert is attempted once per channel.
 */
export function deliverPendingAlerts(ctx: AppContext): Promise<void> {
  if (delivering) return delivering;
  delivering = (async () => {
    try {
      const pending = ctx.db.prepare(`SELECT * FROM alerts WHERE deliveries = '{}' ORDER BY created_at LIMIT 50`).all() as AlertRow[];
      for (const alert of pending) {
        const person = getPerson(ctx.db, alert.person_id);
        const results: Record<string, string> = { app: 'shown' };
        if (person && !person.disabled_at) {
          if (person.notify_email && ctx.integrations.sendEmail) {
            try {
              await ctx.integrations.sendEmail(person.email, alert.title, `${alert.body}\n\nOpen Tempo: ${ctx.config.baseUrl}/`);
              results.email = 'sent';
            } catch (e) {
              results.email = `failed: ${(e as Error).message.slice(0, 200)}`;
              ctx.log.warn({ alert: alert.id, channel: 'email' }, 'alert email failed');
            }
          } else {
            results.email = ctx.integrations.sendEmail ? 'off for this person' : 'email not set up';
          }
          if (person.ntfy_topic && ctx.integrations.sendPush) {
            try {
              await ctx.integrations.sendPush(person.ntfy_topic, alert.title, alert.body, `${ctx.config.baseUrl}/`);
              results.push = 'sent';
            } catch (e) {
              results.push = `failed: ${(e as Error).message.slice(0, 200)}`;
              ctx.log.warn({ alert: alert.id, channel: 'push' }, 'alert push failed');
            }
          } else {
            results.push = person.ntfy_topic ? 'push not set up' : 'no push topic for this person';
          }
        }
        ctx.db.prepare('UPDATE alerts SET deliveries = ? WHERE id = ?').run(JSON.stringify(results), alert.id);
      }
    } finally {
      delivering = null;
    }
  })();
  return delivering;
}

export function listAlerts(db: DB, personId: string, limit = 50): (AlertRow & { deliveriesParsed: Record<string, string> })[] {
  const rows = db
    .prepare('SELECT * FROM alerts WHERE person_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(personId, limit) as AlertRow[];
  return rows.map((r) => ({ ...r, deliveriesParsed: parseJson<Record<string, string>>(r.deliveries, {}) }));
}

export function markAlertRead(db: DB, personId: string, alertId: string, nowMs: number): void {
  db.prepare('UPDATE alerts SET read_at = COALESCE(read_at, ?) WHERE id = ? AND person_id = ?').run(iso(nowMs), alertId, personId);
}
