import type { AppContext } from '../context.js';
import { iso } from '../lib/time.js';

/** The audit log: settings changes, key events, approvals and decisions. Never holds secrets. */
export function audit(
  ctx: AppContext,
  actor: { kind: string; id: string | null; name: string },
  action: string,
  targetKind: string | null,
  targetId: string | null,
  roomId: string | null,
  details: Record<string, unknown>,
): void {
  ctx.db
    .prepare(
      `INSERT INTO audit_log (at, actor_kind, actor_id, actor_name, action, target_kind, target_id, room_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(iso(ctx.clock.now()), actor.kind, actor.id, actor.name, action, targetKind, targetId, roomId, JSON.stringify(details));
}
