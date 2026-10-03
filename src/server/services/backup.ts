import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import type { AppContext } from '../context.js';
import { parseJson } from '../db/index.js';
import { iso } from '../lib/time.js';
import type { Job } from '../scheduler/index.js';
import { getAgent, getPerson, getRoom, roomAgents, roomPeople } from './repo.js';

/** A consistent copy of the whole database (SQLite online backup; safe while the app runs). */
export async function writeBackup(ctx: AppContext, file: string): Promise<string> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await ctx.db.backup(file);
  return file;
}

/** Keeps the newest `keep` nightly backups in the backup folder and deletes older ones. */
export function pruneBackups(dir: string, keep: number): string[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^tempo-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort();
  const remove = files.slice(0, Math.max(0, files.length - keep));
  for (const f of remove) fs.rmSync(path.join(dir, f), { force: true });
  return files.slice(-keep);
}

/**
 * Nightly backup at 3:00 am in the default time zone, written to the data disk; keeps the last
 * seven. Claims the day in job_runs first so it runs once per night even across restarts.
 */
export const nightlyBackupJob: Job = {
  name: 'nightly-backup',
  async run(ctx) {
    const now = DateTime.fromMillis(ctx.clock.now(), { zone: ctx.config.defaultTimezone });
    if (now.hour < 3) return;
    const date = now.toFormat('yyyy-LL-dd');
    const claimed = ctx.db.prepare('INSERT OR IGNORE INTO job_runs (job_key, ran_at) VALUES (?, ?)').run(`backup:${date}`, iso(ctx.clock.now()));
    if (claimed.changes === 0) return;
    try {
      const file = await writeBackup(ctx, path.join(ctx.config.backupDir, `tempo-${date}.db`));
      pruneBackups(ctx.config.backupDir, ctx.config.backupKeep);
      ctx.db.prepare('UPDATE job_runs SET result = ? WHERE job_key = ?').run(`ok: ${path.basename(file)}`, `backup:${date}`);
      ctx.log.info({ file: path.basename(file) }, 'nightly backup written');
    } catch (e) {
      ctx.db.prepare('UPDATE job_runs SET result = ? WHERE job_key = ?').run(`failed: ${(e as Error).message}`, `backup:${date}`);
      ctx.log.error({ err: (e as Error).message }, 'nightly backup failed');
    }
  },
};

/** Everything that happened in one room, for the "export a room's history" button. No secrets. */
export function exportRoom(ctx: AppContext, roomId: string): Record<string, unknown> {
  const db = ctx.db;
  const room = getRoom(db, roomId)!;
  const all = (sql: string) => db.prepare(sql).all(roomId) as Record<string, any>[];
  const json = (rows: Record<string, any>[], cols: string[]) =>
    rows.map((r) => {
      const out = { ...r };
      for (const c of cols) if (typeof out[c] === 'string') out[c] = parseJson(out[c], out[c]);
      return out;
    });
  return {
    exported_at: iso(ctx.clock.now()),
    format: 'tempo-room-export/1',
    room: json([room as unknown as Record<string, any>], ['rules', 'limits_allowed', 'limits_ask_first'])[0],
    goal_history: all('SELECT goal, changed_by, changed_at FROM goal_history WHERE room_id = ? ORDER BY id'),
    people: roomPeople(db, roomId).map((p) => ({ id: p.id, name: p.name })),
    agents: roomAgents(db, roomId).map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      owner: getPerson(db, a.owner_id)?.name ?? null,
      schedule: { interval_minutes: a.interval_minutes, work_days: a.work_days, work_start: a.work_start, work_end: a.work_end, timezone: a.timezone, offset_minutes: a.offset_minutes },
    })),
    feed: json(all('SELECT * FROM feed_events WHERE room_id = ? ORDER BY seq'), ['data']),
    reports: json(all('SELECT * FROM report_rooms WHERE room_id = ? ORDER BY created_at'), ['finished']),
    questions: all('SELECT * FROM questions WHERE room_id = ? ORDER BY created_at'),
    instructions: all('SELECT * FROM instructions WHERE room_id = ? ORDER BY created_at'),
    instruction_events: all('SELECT e.* FROM instruction_events e JOIN instructions i ON i.id = e.instruction_id WHERE i.room_id = ? ORDER BY e.id'),
    decisions: json(all('SELECT * FROM decisions WHERE room_id = ? ORDER BY created_at'), ['options', 'agent_ids', 'proposed_instruction']),
    playbook: all('SELECT * FROM playbook_entries WHERE room_id = ? ORDER BY created_at'),
    conductor_runs: json(all('SELECT * FROM conductor_runs WHERE room_id = ? ORDER BY started_at'), ['triggers', 'output', 'actions']),
    briefs: all('SELECT * FROM briefs WHERE room_id = ? ORDER BY for_date'),
    agent_names: Object.fromEntries(roomAgents(db, roomId).map((a) => [a.id, getAgent(db, a.id)?.name])),
  };
}
