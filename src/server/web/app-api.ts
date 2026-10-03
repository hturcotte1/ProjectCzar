import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import type { AppContext } from '../context.js';
import { withTx } from '../context.js';
import { parseJson } from '../db/index.js';
import { TempoError, badRequest, isTempoError } from '../lib/errors.js';
import { isValidTimezone } from '../lib/time.js';
import { RateLimiter } from '../doors/agent-auth.js';
import type {
  AlertView,
  AuditEntry,
  BriefView,
  ConnectionLogEntry,
  FeedPage,
  GoalHistoryEntry,
  InviteView,
  JoinView,
  MeResponse,
  PersonListEntry,
  RoomDetail,
  SecretsView,
} from '../../shared/app-types.js';
import { requestConductorRun } from '../conductor/queue.js';
import { listAlerts, markAlertRead } from '../services/alerts.js';
import { audit } from '../services/audit.js';
import {
  acceptInvite,
  changePassword,
  createInvite,
  createSession,
  deleteSession,
  deleteSessionsFor,
  findInvite,
  getSession,
  login,
  revokeInvite,
  type Session,
} from '../services/auth.js';
import { approveProposal, dismissDecision, resolveDecision } from '../services/decisions.js';
import { roomHealth } from '../services/health.js';
import { joinMessages } from '../services/join-messages.js';
import {
  addAgentToRoom,
  addPersonToRoom,
  archiveAgent,
  createAgent,
  createRoom,
  removeAgentFromRoom,
  removePersonFromRoom,
  revokeKeys,
  rotateKey,
  setRoomPaused,
  updateAgent,
  updateRoom,
  type ActorRef,
  type RoomInput,
} from '../services/manage.js';
import { answerAsPerson, cancelInstruction, personPost } from '../services/people-actions.js';
import { assertPersonInRoom, getAgent, getPerson, getRoom, isPersonInRoom, personRooms, roomAgents, roomPeople } from '../services/repo.js';
import type { AgentRow, DecisionRow, FeedRow, InstructionRow, PersonRow, PlaybookRow, QuestionRow } from '../services/rows.js';
import { createPlaybookEntry } from '../services/work.js';
import { exportRoom, writeBackup } from '../services/backup.js';
import {
  agentView,
  conductorRunView,
  conductorSummary,
  decisionView,
  feedEventView,
  instructionView,
  lanes,
  playbookView,
  questionView,
  roomSummary,
  roomView,
} from './views.js';
import { registerStream } from './stream.js';

/**
 * The control room's JSON API (see src/shared/app-types.ts for the shapes).
 * People see only rooms they belong to; being admin does not grant access to room content.
 */

export const SESSION_COOKIE = 'tempo_session';

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session;
  }
}

export interface AppApiHooks {
  /** Starts a rehearsal in a sandbox room (wired in M8). */
  startRehearsal?: (person: PersonRow, maxRounds: number) => Promise<string> | string;
  latestRehearsal?: (person: PersonRow) => unknown;
  /** Runs the Conductor for a room now (wired in M6). */
  runConductorNow?: (roomId: string) => void;
}

function sendErr(reply: FastifyReply, e: unknown, ctx: AppContext): FastifyReply {
  if (isTempoError(e)) return reply.code(e.status).send(e.toBody());
  ctx.log.error({ err: (e as Error).message, stack: (e as Error).stack }, 'app api error');
  return reply.code(500).send(new TempoError(500, 'internal_error', 'Something went wrong. Please try again.').toBody());
}

function personRef(p: PersonRow): ActorRef {
  return { kind: 'person', id: p.id, name: p.name };
}

function personView(p: PersonRow) {
  return { id: p.id, name: p.name, email: p.email, role: p.role, notify_email: !!p.notify_email, ntfy_topic: p.ntfy_topic };
}

function sameOrigin(req: FastifyRequest, ctx: AppContext): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin requests may omit it; CSRF token still required
  try {
    const o = new URL(origin);
    const base = new URL(ctx.config.baseUrl);
    const host = req.headers.host;
    return o.host === base.host || (!!host && o.host === host);
  } catch {
    return false;
  }
}

function forbiddenCsrf(): TempoError {
  return new TempoError(403, 'csrf_failed', 'This request did not come from the Tempo app (missing or wrong security token). Reload the page and try again.');
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export async function registerAppApi(app: FastifyInstance, ctx: AppContext, hooks: AppApiHooks = {}): Promise<void> {
  await app.register(cookie);
  // Sign-in limits. Every attempt counts against the visitor's address. Only failed attempts count
  // against an account, and mostly per account and address, so a stranger cannot lock the real
  // owner out; the per-account total across all addresses is a high backstop against spraying.
  const loginPerIp = new RateLimiter(20, 10 * 60_000);
  const failedPerEmailIp = new RateLimiter(10, 10 * 60_000);
  const failedPerEmail = new RateLimiter(100, 60 * 60_000);

  await app.register(
    async (api) => {
      api.addHook('onRequest', async (req, reply) => {
        reply.header('Cache-Control', 'no-store');
        const token = req.cookies[SESSION_COOKIE];
        const session = getSession(ctx, token);
        if (session) req.session = session;
        const method = req.method.toUpperCase();
        const open = req.url.startsWith('/api/app/login') || req.url.startsWith('/api/app/invites/accept') || /^\/api\/app\/invites\/[^/]+$/.test(req.url.split('?')[0]) && method === 'GET';
        if (method !== 'GET' && method !== 'HEAD') {
          // Forged cross-site requests: only same-origin JSON with the right token (or, before
          // sign-in, the app's custom header) gets through.
          if (!sameOrigin(req, ctx)) return reply.code(403).send(forbiddenCsrf().toBody());
          const ct = String(req.headers['content-type'] ?? '');
          if (!ct.startsWith('application/json')) {
            return reply.code(415).send(new TempoError(415, 'json_only', 'Send JSON with Content-Type: application/json.').toBody());
          }
          if (session) {
            if (req.headers['x-csrf-token'] !== session.csrfToken) return reply.code(403).send(forbiddenCsrf().toBody());
          } else if (req.headers['x-requested-with'] !== 'tempo') {
            return reply.code(403).send(forbiddenCsrf().toBody());
          }
        }
        if (!session && !open) {
          return reply.code(401).send(new TempoError(401, 'signed_out', 'Please sign in.').toBody());
        }
      });

      const me = (req: FastifyRequest): PersonRow => req.session!.person;
      const meResponse = (person: PersonRow, csrf: string): MeResponse => {
        const unread = (ctx.db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE person_id = ? AND read_at IS NULL').get(person.id) as { n: number }).n;
        return {
          person: personView(person),
          csrf_token: csrf,
          rooms: personRooms(ctx.db, person.id).map((r) => roomSummary(ctx, r)),
          features: {
            email_configured: !!ctx.integrations.sendEmail,
            push_server: ctx.config.ntfy.server,
            conductor_has_key: !!ctx.integrations.conductorModel,
            conductor_model: ctx.config.conductorModel,
            monthly_budget_usd: ctx.config.conductorMonthlyBudgetUsd,
          },
          base_url: ctx.config.baseUrl,
          unread_alerts: unread,
        };
      };
      const setCookie = (reply: FastifyReply, token: string) =>
        reply.setCookie(SESSION_COOKIE, token, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: ctx.config.secureCookies,
          maxAge: 30 * 86400,
        });

      // ---------------------------------------------------------------- sign-in
      api.post('/login', async (req, reply) => {
        try {
          const body = (req.body ?? {}) as Record<string, unknown>;
          const email = String(body.email ?? '').trim().toLowerCase();
          if (email.length > 254 || String(body.password ?? '').length > 1024) {
            throw new TempoError(401, 'login_failed', "That email and password don't match an account. Check them and try again.");
          }
          const now = Date.now();
          const tooMany = () => new TempoError(429, 'too_many_attempts', 'Too many sign-in attempts. Wait a few minutes and try again.');
          if (!loginPerIp.check(`ip:${req.ip}`, now).ok) throw tooMany();
          if (failedPerEmailIp.isBlocked(`${email}|${req.ip}`, now).blocked || failedPerEmail.isBlocked(email, now).blocked) throw tooMany();
          let person: PersonRow;
          try {
            person = await login(ctx, email, String(body.password ?? ''));
          } catch (err) {
            failedPerEmailIp.record(`${email}|${req.ip}`, now);
            failedPerEmail.record(email, now);
            throw err;
          }
          const s = createSession(ctx, person.id);
          setCookie(reply, s.token);
          audit(ctx, personRef(person), 'person.login', 'person', person.id, null, {});
          return reply.send(meResponse(person, s.csrfToken));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/logout', async (req, reply) => {
        deleteSession(ctx, req.cookies[SESSION_COOKIE]);
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return reply.send({ ok: true });
      });

      api.get('/me', async (req, reply) => reply.send(meResponse(me(req), req.session!.csrfToken)));

      api.patch('/me', async (req, reply) => {
        try {
          const body = (req.body ?? {}) as Record<string, unknown>;
          const p = me(req);
          if (body.name !== undefined) {
            const name = String(body.name).trim();
            if (!name || name.length > 80) throw badRequest('Name must be 1 to 80 characters.');
            ctx.db.prepare('UPDATE people SET name = ? WHERE id = ?').run(name, p.id);
          }
          if (body.notify_email !== undefined) ctx.db.prepare('UPDATE people SET notify_email = ? WHERE id = ?').run(body.notify_email ? 1 : 0, p.id);
          if (body.ntfy_topic !== undefined) {
            const topic = body.ntfy_topic === null ? null : String(body.ntfy_topic).trim() || null;
            if (topic && !/^[A-Za-z0-9_-]{12,64}$/.test(topic)) {
              throw badRequest('Use a long, random push topic (12 to 64 letters, numbers, - or _). Anyone who knows the topic name can read your alerts.');
            }
            ctx.db.prepare('UPDATE people SET ntfy_topic = ? WHERE id = ?').run(topic, p.id);
          }
          if (body.new_password !== undefined) {
            await changePassword(ctx, p, String(body.current_password ?? ''), String(body.new_password), req.session!.tokenHash);
          }
          audit(ctx, personRef(p), 'person.update', 'person', p.id, null, { fields: Object.keys(body).filter((k) => !k.includes('password')) });
          return reply.send(meResponse(getPerson(ctx.db, p.id)!, req.session!.csrfToken));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      // ---------------------------------------------------------------- invites and people
      api.get('/invites/:token', async (req, reply) => {
        const inv = findInvite(ctx, (req.params as { token: string }).token);
        if (!inv) return reply.send({ valid: false, email: null, inviter_name: null, expires_at: null });
        return reply.send({ valid: true, email: inv.email, inviter_name: getPerson(ctx.db, inv.created_by)?.name ?? null, expires_at: inv.expires_at });
      });

      api.post('/invites/accept', async (req, reply) => {
        try {
          const body = (req.body ?? {}) as Record<string, unknown>;
          const person = await acceptInvite(ctx, String(body.token ?? ''), {
            name: String(body.name ?? ''),
            email: str(body.email),
            password: String(body.password ?? ''),
          });
          const s = createSession(ctx, person.id);
          setCookie(reply, s.token);
          return reply.send(meResponse(person, s.csrfToken));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.get('/people', async (_req, reply) => {
        const rows = ctx.db.prepare('SELECT * FROM people ORDER BY created_at').all() as PersonRow[];
        const out: PersonListEntry[] = rows.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role, disabled: !!p.disabled_at, created_at: p.created_at }));
        return reply.send(out);
      });

      api.get('/invites', async (req, reply) => {
        if (me(req).role !== 'admin') return reply.code(403).send(new TempoError(403, 'admin_only', 'Only an admin can see invites.').toBody());
        const rows = ctx.db.prepare('SELECT * FROM invites ORDER BY created_at DESC LIMIT 100').all() as any[];
        const out: InviteView[] = rows.map((i) => ({ id: i.id, email: i.email, role: i.role, created_at: i.created_at, expires_at: i.expires_at, used_at: i.used_at, revoked_at: i.revoked_at }));
        return reply.send(out);
      });

      api.post('/invites', async (req, reply) => {
        try {
          const body = (req.body ?? {}) as Record<string, unknown>;
          const roomIds = Array.isArray(body.room_ids) ? body.room_ids.map(String).filter((id) => isPersonInRoom(ctx.db, me(req).id, id)) : [];
          const { invite, link } = createInvite(ctx, me(req), { email: str(body.email) ?? null, role: body.role === 'admin' ? 'admin' : 'member', room_ids: roomIds });
          const view: InviteView = { id: invite.id, email: invite.email, role: invite.role, created_at: invite.created_at, expires_at: invite.expires_at, used_at: null, revoked_at: null, link };
          return reply.send(view);
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.delete('/invites/:id', async (req, reply) => {
        try {
          revokeInvite(ctx, me(req), (req.params as { id: string }).id);
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/people/:id/disable', async (req, reply) => {
        try {
          const admin = me(req);
          if (admin.role !== 'admin') throw new TempoError(403, 'admin_only', 'Only an admin can turn off an account.');
          const id = (req.params as { id: string }).id;
          if (id === admin.id) throw badRequest('You cannot turn off your own account.');
          withTx(ctx, () => {
            ctx.db.prepare('UPDATE people SET disabled_at = ? WHERE id = ?').run(new Date(ctx.clock.now()).toISOString(), id);
            deleteSessionsFor(ctx, id);
            ctx.db.prepare('UPDATE invites SET revoked_at = ? WHERE created_by = ? AND used_at IS NULL AND revoked_at IS NULL').run(new Date(ctx.clock.now()).toISOString(), id);
            for (const a of ctx.db.prepare('SELECT id FROM agents WHERE owner_id = ?').all(id) as { id: string }[]) {
              revokeKeys(ctx, personRef(admin), a.id, 'api');
              revokeKeys(ctx, personRef(admin), a.id, 'page');
            }
            audit(ctx, personRef(admin), 'person.disable', 'person', id, null, {});
          });
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      // ---------------------------------------------------------------- rooms
      api.get('/rooms', async (req, reply) => reply.send(personRooms(ctx.db, me(req).id).map((r) => roomSummary(ctx, r))));

      // Only the fields people may set; sandbox rooms and sped-up clocks come from rehearsals alone.
      const ROOM_FIELDS = ['name', 'goal', 'rules', 'limits_allowed', 'limits_ask_first', 'conductor_mode', 'timezone', 'work_days', 'work_start', 'work_end', 'brief_time', 'card_token_budget', 'max_open_instructions'] as const;
      const roomInput = (raw: unknown): RoomInput => {
        const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const f of ROOM_FIELDS) if (body[f] !== undefined) out[f] = body[f];
        return out as RoomInput;
      };

      api.post('/rooms', async (req, reply) => {
        try {
          const body = roomInput(req.body);
          if (typeof body.name !== 'string') throw badRequest('Give the room a name.', [{ field: 'name', message: 'missing' }]);
          const room = createRoom(ctx, me(req), body as RoomInput & { name: string });
          return reply.send(roomView(ctx, room));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      const roomDetail = (person: PersonRow, roomId: string): RoomDetail => {
        const room = assertPersonInRoom(ctx.db, person.id, roomId);
        const decisions = ctx.db
          .prepare(`SELECT * FROM decisions WHERE room_id = ? AND (status = 'open' OR resolved_at >= ?) ORDER BY status = 'open' DESC, created_at DESC LIMIT 50`)
          .all(roomId, new Date(ctx.clock.now() - 7 * 86400_000).toISOString()) as DecisionRow[];
        const qs = ctx.db
          .prepare(`SELECT * FROM questions WHERE room_id = ? AND target_kind IN ('people', 'conductor') AND status = 'open' ORDER BY created_at LIMIT 100`)
          .all(roomId) as QuestionRow[];
        const proposals = ctx.db.prepare(`SELECT * FROM instructions WHERE room_id = ? AND status = 'proposed' ORDER BY created_at LIMIT 100`).all(roomId) as InstructionRow[];
        return {
          room: roomView(ctx, room),
          agents: roomAgents(ctx.db, roomId).map((a) => agentView(ctx, a, person)),
          people: roomPeople(ctx.db, roomId).map((p) => ({ id: p.id, name: p.name })),
          lanes: lanes(ctx, room),
          conductor: conductorSummary(ctx, room),
          decisions: decisions.map((d) => decisionView(ctx, d)),
          questions_for_people: qs.map((q) => questionView(ctx, q)),
          proposals: proposals.map((i) => instructionView(ctx, i)),
        };
      };

      api.get('/rooms/:id', async (req, reply) => {
        try {
          return reply.send(roomDetail(me(req), (req.params as { id: string }).id));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.patch('/rooms/:id', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          assertPersonInRoom(ctx.db, me(req).id, id);
          const body = roomInput(req.body);
          const { room, goalChanged, modeChanged } = updateRoom(ctx, personRef(me(req)), id, body);
          if ((goalChanged || modeChanged) && !room.paused_at) {
            requestConductorRun(ctx.db, id, { kind: goalChanged ? 'goal_changed' : 'mode_changed', detail: `${me(req).name} changed the ${goalChanged ? 'goal' : 'mode'}` }, ctx.clock.now(), 10_000, room.clock_speed);
          }
          return reply.send(roomView(ctx, room));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/rooms/:id/pause', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          assertPersonInRoom(ctx.db, me(req).id, id);
          return reply.send(roomView(ctx, setRoomPaused(ctx, personRef(me(req)), id, true)));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/rooms/:id/resume', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          assertPersonInRoom(ctx.db, me(req).id, id);
          return reply.send(roomView(ctx, setRoomPaused(ctx, personRef(me(req)), id, false)));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.get('/rooms/:id/goal-history', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          assertPersonInRoom(ctx.db, me(req).id, id);
          const rows = ctx.db.prepare('SELECT * FROM goal_history WHERE room_id = ? ORDER BY id DESC LIMIT 50').all(id) as any[];
          const out: GoalHistoryEntry[] = rows.map((r) => ({ goal: r.goal, changed_by_name: r.changed_by ? (getPerson(ctx.db, r.changed_by)?.name ?? null) : null, changed_at: r.changed_at }));
          return reply.send(out);
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/rooms/:id/people', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          assertPersonInRoom(ctx.db, me(req).id, id);
          addPersonToRoom(ctx, personRef(me(req)), id, String((req.body as Record<string, unknown>)?.person_id ?? ''));
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.delete('/rooms/:id/people/:personId', async (req, reply) => {
        try {
          const { id, personId } = req.params as { id: string; personId: string };
          assertPersonInRoom(ctx.db, me(req).id, id);
          removePersonFromRoom(ctx, personRef(me(req)), id, personId);
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/rooms/:id/agents', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          assertPersonInRoom(ctx.db, me(req).id, id);
          const agentId = String((req.body as Record<string, unknown>)?.agent_id ?? '');
          const agent = getAgent(ctx.db, agentId);
          if (!agent || agent.owner_id !== me(req).id) throw new TempoError(403, 'not_your_agent', 'You can only add your own agents to a room.');
          addAgentToRoom(ctx, personRef(me(req)), agentId, id);
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.delete('/rooms/:id/agents/:agentId', async (req, reply) => {
        try {
          const { id, agentId } = req.params as { id: string; agentId: string };
          assertPersonInRoom(ctx.db, me(req).id, id);
          removeAgentFromRoom(ctx, personRef(me(req)), agentId, id);
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      // ---------------------------------------------------------------- feed and composer
      api.get('/rooms/:id/feed', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          assertPersonInRoom(ctx.db, me(req).id, id);
          const q = req.query as Record<string, string | undefined>;
          const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
          const where: string[] = ['room_id = ?'];
          const params: unknown[] = [id];
          if (q.after) {
            where.push('seq > ?');
            params.push(Number(q.after));
          }
          if (q.before) {
            where.push('seq < ?');
            params.push(Number(q.before));
          }
          if (q.agent) {
            where.push('((actor_kind = \'agent\' AND actor_id = ?) OR target_agent_id = ?)');
            params.push(q.agent, q.agent);
          }
          if (q.kind) {
            const kinds = q.kind.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 20);
            if (kinds.length) {
              where.push(`kind IN (${kinds.map(() => '?').join(',')})`);
              params.push(...kinds);
            }
          }
          if (q.q) {
            for (const term of q.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
              where.push(`LOWER(text) LIKE ?`);
              params.push(`%${term.replace(/[%_\\]/g, '')}%`);
            }
          }
          if (q.thread) {
            where.push('thread_id = ?');
            params.push(q.thread);
          }
          const order = q.after ? 'ASC' : 'DESC';
          const rows = ctx.db.prepare(`SELECT * FROM feed_events WHERE ${where.join(' AND ')} ORDER BY seq ${order} LIMIT ?`).all(...params, limit + 1) as FeedRow[];
          const has_more = rows.length > limit;
          const page = rows.slice(0, limit);
          if (order === 'DESC') page.reverse();
          const out: FeedPage = { events: page.map((r) => feedEventView(ctx, r)), has_more };
          return reply.send(out);
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/rooms/:id/messages', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          const b = (req.body ?? {}) as Record<string, unknown>;
          const res = personPost(ctx, me(req), id, {
            kind: (str(b.kind) ?? 'note') as 'note' | 'question' | 'instruction',
            to: str(b.to) ?? 'room',
            text: str(b.text) ?? '',
            done_when: str(b.done_when),
            priority: (['low', 'normal', 'high'].includes(String(b.priority)) ? b.priority : 'normal') as 'low' | 'normal' | 'high',
            due_at: str(b.due_at) ?? null,
          });
          return reply.send(res);
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/questions/:id/answer', async (req, reply) => {
        try {
          answerAsPerson(ctx, me(req), (req.params as { id: string }).id, String((req.body as Record<string, unknown>)?.text ?? ''));
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/instructions/:id/cancel', async (req, reply) => {
        try {
          cancelInstruction(ctx, me(req), (req.params as { id: string }).id, str((req.body as Record<string, unknown>)?.reason) ?? null);
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/instructions/:id/approve', async (req, reply) => {
        try {
          const b = (req.body ?? {}) as Record<string, unknown>;
          approveProposal(ctx, me(req), (req.params as { id: string }).id, { text: str(b.text), done_when: str(b.done_when) });
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/instructions/:id/reject', async (req, reply) => {
        try {
          cancelInstruction(ctx, me(req), (req.params as { id: string }).id, str((req.body as Record<string, unknown>)?.reason) ?? null);
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/decisions/:id/resolve', async (req, reply) => {
        try {
          const b = (req.body ?? {}) as Record<string, unknown>;
          resolveDecision(ctx, me(req), (req.params as { id: string }).id, {
            option_index: typeof b.option_index === 'number' ? b.option_index : null,
            text: str(b.text) ?? null,
          });
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/decisions/:id/dismiss', async (req, reply) => {
        try {
          dismissDecision(ctx, me(req), (req.params as { id: string }).id);
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      // ---------------------------------------------------------------- Conductor
      api.get('/rooms/:id/conductor', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          const room = assertPersonInRoom(ctx.db, me(req).id, id);
          const runs = ctx.db.prepare('SELECT * FROM conductor_runs WHERE room_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 50').all(id) as Record<string, any>[];
          return reply.send({ summary: conductorSummary(ctx, room), runs: runs.map(conductorRunView) });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/rooms/:id/conductor/run', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          const room = assertPersonInRoom(ctx.db, me(req).id, id);
          if (room.paused_at) throw new TempoError(409, 'room_paused', 'This room is paused. Resume it before running the Conductor.');
          requestConductorRun(ctx.db, id, { kind: 'manual', detail: `${me(req).name} asked for a run` }, ctx.clock.now(), 0, room.clock_speed);
          hooks.runConductorNow?.(id);
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      // ---------------------------------------------------------------- playbook
      api.get('/rooms/:id/playbook', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          assertPersonInRoom(ctx.db, me(req).id, id);
          const rows = ctx.db.prepare('SELECT * FROM playbook_entries WHERE room_id = ? AND archived_at IS NULL ORDER BY updated_at DESC').all(id) as PlaybookRow[];
          return reply.send(rows.map((p) => playbookView(ctx, p)));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      const checkPlaybookInput = (b: Record<string, unknown>) => {
        const title = String(b.title ?? '').trim();
        const body = String(b.body ?? '').trim();
        if (!title || title.length > 200) throw badRequest('A lesson needs a title under 200 characters.');
        if (!body || body.length > 2000) throw badRequest('A lesson needs text under 2,000 characters.');
        return { title, body };
      };

      api.post('/rooms/:id/playbook', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          assertPersonInRoom(ctx.db, me(req).id, id);
          const { title, body } = checkPlaybookInput((req.body ?? {}) as Record<string, unknown>);
          const pid = withTx(ctx, (emit) =>
            createPlaybookEntry(ctx.db, { roomId: id, title, body, author: { kind: 'person', id: me(req).id, name: me(req).name }, at: new Date(ctx.clock.now()).toISOString() }, emit),
          );
          audit(ctx, personRef(me(req)), 'playbook.create', 'playbook', pid, id, {});
          return reply.send(playbookView(ctx, ctx.db.prepare('SELECT * FROM playbook_entries WHERE id = ?').get(pid) as PlaybookRow));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.patch('/playbook/:id', async (req, reply) => {
        try {
          const pid = (req.params as { id: string }).id;
          const row = ctx.db.prepare('SELECT * FROM playbook_entries WHERE id = ?').get(pid) as PlaybookRow | undefined;
          if (!row) throw new TempoError(404, 'not_found', 'That lesson was not found.');
          assertPersonInRoom(ctx.db, me(req).id, row.room_id);
          const { title, body } = checkPlaybookInput({ title: row.title, body: row.body, ...((req.body ?? {}) as Record<string, unknown>) });
          ctx.db.prepare('UPDATE playbook_entries SET title = ?, body = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(title, body, new Date(ctx.clock.now()).toISOString(), me(req).id, pid);
          audit(ctx, personRef(me(req)), 'playbook.update', 'playbook', pid, row.room_id, {});
          ctx.bus.publish({ type: 'room', roomId: row.room_id, what: 'playbook' });
          return reply.send(playbookView(ctx, ctx.db.prepare('SELECT * FROM playbook_entries WHERE id = ?').get(pid) as PlaybookRow));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.delete('/playbook/:id', async (req, reply) => {
        try {
          const pid = (req.params as { id: string }).id;
          const row = ctx.db.prepare('SELECT * FROM playbook_entries WHERE id = ?').get(pid) as PlaybookRow | undefined;
          if (!row) throw new TempoError(404, 'not_found', 'That lesson was not found.');
          assertPersonInRoom(ctx.db, me(req).id, row.room_id);
          ctx.db.prepare('UPDATE playbook_entries SET archived_at = ? WHERE id = ?').run(new Date(ctx.clock.now()).toISOString(), pid);
          audit(ctx, personRef(me(req)), 'playbook.archive', 'playbook', pid, row.room_id, {});
          ctx.bus.publish({ type: 'room', roomId: row.room_id, what: 'playbook' });
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      // ---------------------------------------------------------------- health, briefs, export
      api.get('/rooms/:id/health', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          assertPersonInRoom(ctx.db, me(req).id, id);
          return reply.send(roomHealth(ctx, id));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.get('/rooms/:id/briefs', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          assertPersonInRoom(ctx.db, me(req).id, id);
          const rows = ctx.db.prepare('SELECT * FROM briefs WHERE room_id = ? ORDER BY for_date DESC LIMIT 30').all(id) as BriefView[];
          return reply.send(rows.map((b) => ({ id: b.id, room_id: b.room_id, for_date: b.for_date, created_at: b.created_at, method: b.method, text: b.text, cost_usd: b.cost_usd })));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.get('/rooms/:id/export', async (req, reply) => {
        try {
          const id = (req.params as { id: string }).id;
          const room = assertPersonInRoom(ctx.db, me(req).id, id);
          audit(ctx, personRef(me(req)), 'room.export', 'room', id, id, {});
          const data = exportRoom(ctx, id);
          const safe = room.name.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40) || 'room';
          return reply
            .header('Content-Disposition', `attachment; filename="tempo-${safe}-${new Date(ctx.clock.now()).toISOString().slice(0, 10)}.json"`)
            .type('application/json; charset=utf-8')
            .send(JSON.stringify(data, null, 2));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      // ---------------------------------------------------------------- agents
      const canSeeAgent = (person: PersonRow, a: AgentRow) =>
        a.owner_id === person.id || (ctx.db.prepare('SELECT 1 FROM room_agents ra JOIN room_people rp ON rp.room_id = ra.room_id WHERE ra.agent_id = ? AND rp.person_id = ?').get(a.id, person.id) !== undefined);
      const myAgent = (req: FastifyRequest): AgentRow => {
        const a = getAgent(ctx.db, (req.params as { id: string }).id);
        if (!a || a.archived_at || a.owner_id !== me(req).id) throw new TempoError(404, 'agent_not_found', 'That agent was not found among your agents.');
        return a;
      };

      api.get('/agents', async (req, reply) => {
        const p = me(req);
        const rows = (ctx.db.prepare('SELECT * FROM agents WHERE archived_at IS NULL ORDER BY created_at').all() as AgentRow[]).filter((a) => canSeeAgent(p, a));
        return reply.send(rows.map((a) => agentView(ctx, a, p)));
      });

      api.post('/agents', async (req, reply) => {
        try {
          const b = (req.body ?? {}) as Record<string, any>;
          const p = me(req);
          const created = createAgent(ctx, p, {
            name: String(b.name ?? ''),
            type: b.type === 'stand_in' ? 'other' : b.type,
            description: str(b.description),
            room_ids: Array.isArray(b.room_ids) ? b.room_ids.map(String) : [],
            schedule: b.schedule,
          });
          const link = `${ctx.config.baseUrl}/a/${created.pageToken}`;
          const out: SecretsView = { agent: agentView(ctx, created.agent, p), api_key: created.apiKey, page_link: link, messages: joinMessages(ctx, created.agent, link) };
          return reply.send(out);
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.get('/agents/:id', async (req, reply) => {
        try {
          const a = getAgent(ctx.db, (req.params as { id: string }).id);
          if (!a || a.archived_at || !canSeeAgent(me(req), a)) throw new TempoError(404, 'agent_not_found', 'That agent was not found.');
          return reply.send(agentView(ctx, a, me(req)));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.patch('/agents/:id', async (req, reply) => {
        try {
          const a = myAgent(req);
          const b = (req.body ?? {}) as Record<string, any>;
          if (b.schedule?.timezone && !isValidTimezone(b.schedule.timezone)) throw badRequest(`"${b.schedule.timezone}" is not a time zone.`);
          const updated = updateAgent(ctx, personRef(me(req)), a.id, { name: str(b.name), description: str(b.description), schedule: b.schedule, paused: typeof b.paused === 'boolean' ? b.paused : undefined });
          return reply.send(agentView(ctx, updated, me(req)));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.delete('/agents/:id', async (req, reply) => {
        try {
          archiveAgent(ctx, personRef(me(req)), myAgent(req).id);
          return reply.send({ ok: true });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/agents/:id/keys/rotate', async (req, reply) => {
        try {
          const a = myAgent(req);
          const kind = (req.body as Record<string, unknown>)?.kind === 'page' ? 'page' : 'api';
          const secret = rotateKey(ctx, personRef(me(req)), a.id, kind);
          const link = kind === 'page' ? `${ctx.config.baseUrl}/a/${secret}` : null;
          const out: SecretsView = { agent: agentView(ctx, a, me(req)), api_key: kind === 'api' ? secret : null, page_link: link, messages: joinMessages(ctx, a, link) };
          return reply.send(out);
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.post('/agents/:id/keys/revoke', async (req, reply) => {
        try {
          const a = myAgent(req);
          const kind = (req.body as Record<string, unknown>)?.kind === 'page' ? 'page' : 'api';
          revokeKeys(ctx, personRef(me(req)), a.id, kind);
          return reply.send(agentView(ctx, a, me(req)));
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.get('/agents/:id/join', async (req, reply) => {
        try {
          const a = myAgent(req);
          const out: JoinView = {
            agent: agentView(ctx, a, me(req)),
            messages: joinMessages(ctx, a, null),
            mcp_url: `${ctx.config.baseUrl}/mcp`,
            openapi_url: `${ctx.config.baseUrl}/openapi.json`,
            guide_url: `${ctx.config.baseUrl}/agents.md`,
          };
          return reply.send(out);
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.get('/agents/:id/connections', async (req, reply) => {
        try {
          const a = myAgent(req);
          const limit = Math.min(Math.max(Number((req.query as Record<string, string>).limit ?? 100) || 100, 1), 500);
          const rows = ctx.db.prepare('SELECT * FROM connection_log WHERE agent_id = ? ORDER BY id DESC LIMIT ?').all(a.id, limit) as ConnectionLogEntry[];
          return reply.send(rows);
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.get('/connections/unmatched', async (req, reply) => {
        if (me(req).role !== 'admin') return reply.code(403).send(new TempoError(403, 'admin_only', 'Only an admin can see these.').toBody());
        const rows = ctx.db.prepare('SELECT * FROM connection_log WHERE agent_id IS NULL ORDER BY id DESC LIMIT 100').all() as ConnectionLogEntry[];
        return reply.send(rows);
      });

      // ---------------------------------------------------------------- alerts, audit, backup
      api.get('/alerts', async (req, reply) => {
        const out: AlertView[] = listAlerts(ctx.db, me(req).id).map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          body: a.body,
          created_at: a.created_at,
          read_at: a.read_at,
          room_id: a.room_id,
          agent_id: a.agent_id,
          decision_id: a.decision_id,
          deliveries: a.deliveriesParsed,
        }));
        return reply.send(out);
      });

      api.post('/alerts/:id/read', async (req, reply) => {
        markAlertRead(ctx.db, me(req).id, (req.params as { id: string }).id, ctx.clock.now());
        return reply.send({ ok: true });
      });

      api.post('/alerts/read-all', async (req, reply) => {
        ctx.db.prepare('UPDATE alerts SET read_at = ? WHERE person_id = ? AND read_at IS NULL').run(new Date(ctx.clock.now()).toISOString(), me(req).id);
        return reply.send({ ok: true });
      });

      api.get('/audit', async (req, reply) => {
        const p = me(req);
        // Admins see everything that isn't room content; members see entries for their rooms and themselves.
        const rows = (
          p.role === 'admin'
            ? ctx.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all()
            : ctx.db
                .prepare(
                  `SELECT * FROM audit_log WHERE actor_id = ? OR room_id IN (SELECT room_id FROM room_people WHERE person_id = ?) ORDER BY id DESC LIMIT 200`,
                )
                .all(p.id, p.id)
        ) as any[];
        const out: AuditEntry[] = rows.map((r) => ({ id: r.id, at: r.at, actor_name: r.actor_name, action: r.action, target_kind: r.target_kind, target_id: r.target_id, room_id: r.room_id, details: parseJson(r.details, {}) }));
        return reply.send(out);
      });

      api.get('/backup', async (req, reply) => {
        try {
          const p = me(req);
          if (p.role !== 'admin') throw new TempoError(403, 'admin_only', 'Only an admin can download a backup.');
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-backup-'));
          const file = await writeBackup(ctx, path.join(dir, 'tempo.db'));
          audit(ctx, personRef(p), 'backup.download', null, null, null, {});
          const stream = fs.createReadStream(file);
          stream.on('close', () => fs.rmSync(dir, { recursive: true, force: true }));
          return reply
            .header('Content-Disposition', `attachment; filename="tempo-backup-${new Date(ctx.clock.now()).toISOString().slice(0, 10)}.db"`)
            .type('application/vnd.sqlite3')
            .send(stream);
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      // ---------------------------------------------------------------- rehearsal
      api.post('/rehearsals', async (req, reply) => {
        try {
          if (!hooks.startRehearsal) throw new TempoError(503, 'unavailable', 'Rehearsals are not available on this server.');
          const rounds = Math.min(Math.max(Number((req.body as Record<string, unknown>)?.max_rounds ?? 12) || 12, 8), 20);
          const id = await hooks.startRehearsal(me(req), rounds);
          return reply.send({ ok: true, id });
        } catch (e) {
          return sendErr(reply, e, ctx);
        }
      });

      api.get('/rehearsals/latest', async (req, reply) => reply.send(hooks.latestRehearsal?.(me(req)) ?? null));

      await registerStream(api, ctx);
    },
    { prefix: '/api/app' },
  );
}
