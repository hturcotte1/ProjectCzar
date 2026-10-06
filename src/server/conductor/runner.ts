import { createHash } from 'node:crypto';
import type { AppContext } from '../context.js';
import { withTx } from '../context.js';
import { nextId, parseJson } from '../db/index.js';
import type { BusEvent } from '../lib/bus.js';
import { iso, ms } from '../lib/time.js';
import type { Job, Scheduler } from '../scheduler/index.js';
import { appendFeed, maxFeedSeq } from '../services/feed.js';
import { limitConcern } from '../services/limits.js';
import { getAgent, getRoom, roomAgents, roomLimits, roomMaxOpenInstructions, roomTeamNames } from '../services/repo.js';
import type { FeedRow, InstructionRow, QuestionRow, RoomRow } from '../services/rows.js';
import { OPEN_INSTRUCTION_STATUSES } from '../services/rows.js';
import { scaled, scheduleFromRow } from '../services/schedule.js';
import { computeAgentStatus } from '../services/status.js';
import {
  answerQuestion,
  createDecision,
  createInstruction,
  createPlaybookEntry,
  createQuestion,
  getInstruction,
  getQuestion,
  quote,
  setInstructionStatus,
  type Actor,
} from '../services/work.js';
import { costUsd, effectiveMode, modelForRoom, modelRunsLastHour, priceFor } from './budget.js';
import { retryMaxTokens } from './model.js';
import type { ModelUsage } from './model.js';
import { buildRunInput, SYSTEM_PROMPT } from './prompt.js';
import { requestConductorRun, type Trigger } from './queue.js';
import { CONDUCTOR_JSON_SCHEMA, ConductorOutput, type ConductorOutputT } from './schema.js';

/**
 * One Conductor run for one room. Only one run at a time per room. Every run (including the
 * ones that skip the model) is written to the Conductor log with what triggered it, what it saw,
 * what it decided and why, and what it cost.
 */

type Emit = (e: BusEvent) => void;
const CONDUCTOR: Actor = { kind: 'conductor', id: null, name: 'Conductor' };
const SWEEP_MINUTES = 15;

const locks = new WeakMap<AppContext, Set<string>>();
function lockSet(ctx: AppContext): Set<string> {
  let s = locks.get(ctx);
  if (!s) locks.set(ctx, (s = new Set()));
  return s;
}

export interface RunAction {
  kind: string;
  id: string | null;
  text: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function similar(a: string, b: string): boolean {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 2));
  const B = new Set(norm(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return norm(a) === norm(b);
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size) >= 0.8;
}

/** Things that have gone stale in a room: what the 15-minute sweep looks for. */
export function staleItems(ctx: AppContext, room: RoomRow): string[] {
  const now = ctx.clock.now();
  const out: string[] = [];
  const agents = roomAgents(ctx.db, room.id);
  const speed = room.clock_speed > 0 ? room.clock_speed : 1;
  const interval = Math.max(60, ...agents.map((a) => a.interval_minutes));
  const qs = ctx.db.prepare(`SELECT * FROM questions WHERE room_id = ? AND status = 'open'`).all(room.id) as QuestionRow[];
  for (const q of qs) {
    const target = q.target_agent_id ? getAgent(ctx.db, q.target_agent_id) : null;
    const twoIntervals = ((target?.interval_minutes ?? interval) * 2 * 60_000) / speed;
    if (now - ms(q.created_at) >= twoIntervals) out.push(`${q.id} has been unanswered for more than two check-in intervals.`);
  }
  const ph = OPEN_INSTRUCTION_STATUSES.map(() => '?').join(',');
  const ins = ctx.db.prepare(`SELECT * FROM instructions WHERE room_id = ? AND status IN (${ph})`).all(room.id, ...OPEN_INSTRUCTION_STATUSES) as InstructionRow[];
  for (const i of ins) {
    if (now - ms(i.last_movement_at) >= (24 * 3600_000) / speed) out.push(`${i.id} has had no movement for a day.`);
  }
  for (const a of agents) {
    const latest = ctx.db
      .prepare('SELECT blocked_reason FROM report_rooms WHERE room_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(room.id, a.id) as { blocked_reason: string | null } | undefined;
    if (latest?.blocked_reason) out.push(`${a.name} is blocked.`);
    if (computeAgentStatus(ctx, a).light === 'red') out.push(`${a.name} is red (missed check-ins).`);
  }
  return out;
}

/**
 * Has anything worth the model's attention happened since the last run? Repeated identical
 * reports ("still working on X") are not; anything with news, a question, an answer, a status
 * change, a blocker, a person's message or a decision is.
 */
function hasNews(ctx: AppContext, roomId: string, sinceSeq: number): boolean {
  const events = ctx.db.prepare('SELECT * FROM feed_events WHERE room_id = ? AND seq > ? ORDER BY seq').all(roomId, sinceSeq) as FeedRow[];
  for (const ev of events) {
    if (ev.kind === 'report') {
      const d = parseJson<Record<string, any>>(ev.data, {});
      if ((d.finished ?? []).length || d.notes_for_others || d.blocked || (d.disagreements ?? []).length) return true;
      const prev = ctx.db
        .prepare(`SELECT working_on FROM report_rooms WHERE room_id = ? AND agent_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 1`)
        .get(roomId, ev.actor_id, ev.created_at) as { working_on: string } | undefined;
      if (!prev || norm(prev.working_on) !== norm(String(d.working_on ?? ''))) return true;
      continue;
    }
    if (ev.kind === 'system') {
      const d = parseJson<Record<string, any>>(ev.data, {});
      if (['goal_changed', 'mode_changed', 'rules_changed', 'agent_joined', 'room_resumed', 'agent_red'].includes(d.event)) return true;
      continue;
    }
    if (ev.kind === 'playbook' || ev.kind === 'brief' || ev.kind === 'conductor_note') continue;
    if (ev.actor_kind === 'conductor') continue;
    return true;
  }
  return false;
}

/** Records a run that did not call the model. Repeats of the same skip within an hour are merged. */
function logSkip(ctx: AppContext, room: RoomRow, mode: string, triggers: Trigger[], reason: string, summary: string, emit: Emit): string {
  const now = ctx.clock.now();
  const prev = ctx.db
    .prepare(`SELECT id, triggers, started_at FROM conductor_runs WHERE room_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`)
    .get(room.id) as { id: string; triggers: string; started_at: string } | undefined;
  const prevRow = prev ? (ctx.db.prepare('SELECT status, skip_reason FROM conductor_runs WHERE id = ?').get(prev.id) as { status: string; skip_reason: string | null }) : null;
  if (prev && prevRow?.status === 'skipped' && prevRow.skip_reason === reason && now - ms(prev.started_at) < 3600_000) {
    const merged = [...parseJson<Trigger[]>(prev.triggers, []), ...triggers].slice(-30);
    ctx.db.prepare('UPDATE conductor_runs SET triggers = ?, finished_at = ?, summary = ? WHERE id = ?').run(JSON.stringify(merged), iso(now), summary, prev.id);
    emit({ type: 'conductor', roomId: room.id, runId: prev.id });
    return prev.id;
  }
  const id = nextId(ctx.db, 'run');
  ctx.db
    .prepare(
      `INSERT INTO conductor_runs (id, room_id, triggers, mode, model, status, skip_reason, started_at, finished_at, summary, actions) VALUES (?, ?, ?, ?, NULL, 'skipped', ?, ?, ?, ?, '[]')`,
    )
    .run(id, room.id, JSON.stringify(triggers), mode, reason, iso(now), iso(now), summary);
  emit({ type: 'conductor', roomId: room.id, runId: id });
  return id;
}

function semanticProblems(out: ConductorOutputT, agentNames: Set<string>): string[] {
  const problems: string[] = [];
  for (const i of out.instructions) if (!agentNames.has(i.agent.toLowerCase())) problems.push(`instructions: "${i.agent}" is not an agent in this room`);
  if (out.nothing_to_do && (out.instructions.length || out.decisions.length || out.questions.length)) {
    problems.push('nothing_to_do is true but lists are not empty');
  }
  return problems;
}

export async function runConductor(ctx: AppContext, roomId: string): Promise<string | null> {
  const lock = lockSet(ctx);
  if (lock.has(roomId)) return null;
  lock.add(roomId);
  try {
    return await runLocked(ctx, roomId);
  } catch (e) {
    ctx.log.error({ room: roomId, err: (e as Error).message, stack: (e as Error).stack }, 'conductor run crashed');
    ctx.db.prepare('UPDATE conductor_state SET running_since = NULL WHERE room_id = ?').run(roomId);
    return null;
  } finally {
    lock.delete(roomId);
  }
}

async function runLocked(ctx: AppContext, roomId: string): Promise<string | null> {
  const room = getRoom(ctx.db, roomId);
  if (!room || room.archived_at) return null;
  const now = ctx.clock.now();

  // Claim the pending triggers.
  const state = ctx.db.prepare('SELECT * FROM conductor_state WHERE room_id = ?').get(roomId) as
    | { pending_triggers: string; last_run_seq: number }
    | undefined;
  const triggers = parseJson<Trigger[]>(state?.pending_triggers, []);
  const sinceSeq = state?.last_run_seq ?? 0;
  ctx.db
    .prepare(
      `INSERT INTO conductor_state (room_id, pending_run_at, pending_triggers, running_since) VALUES (?, NULL, '[]', ?)
       ON CONFLICT(room_id) DO UPDATE SET pending_run_at = NULL, pending_triggers = '[]', running_since = excluded.running_since`,
    )
    .run(roomId, iso(now));
  const done = (seq?: number) =>
    ctx.db
      .prepare(`UPDATE conductor_state SET running_since = NULL, last_run_at = ?, last_run_seq = COALESCE(?, last_run_seq) WHERE room_id = ?`)
      .run(iso(ctx.clock.now()), seq ?? null, roomId);

  // A paused room: the Conductor issues nothing.
  if (room.paused_at) {
    done();
    return null;
  }

  const eff = effectiveMode(ctx, room);
  const model = modelForRoom(ctx, room);
  const humanTrigger = triggers.some((t) => t.kind !== 'checkin' && t.kind !== 'sweep');

  if (!model || eff.reason !== 'ok') {
    const id = withTx(ctx, (emit) =>
      logSkip(
        ctx,
        room,
        eff.mode,
        triggers,
        eff.reason === 'no_key' ? 'no API key: relay mode' : 'monthly budget used up: relay mode',
        eff.reason === 'no_key'
          ? 'No Anthropic API key, so the Conductor did not run. Tempo still routes questions, answers and decisions, and people give instructions directly.'
          : 'The monthly Conductor budget is used up, so the Conductor did not run. The room behaves as relay until next month.',
        emit,
      ),
    );
    done(maxFeedSeq(ctx.db, roomId));
    return id;
  }

  if (!model.scripted && modelRunsLastHour(ctx, roomId) >= ctx.config.conductorMaxRunsPerHour) {
    // Too many runs this hour: try again in ten minutes, keeping the triggers.
    const id = withTx(ctx, (emit) =>
      logSkip(ctx, room, eff.mode, triggers, 'hourly run limit reached', `The Conductor already ran ${ctx.config.conductorMaxRunsPerHour} times in the last hour (the limit), so this run waits.`, emit),
    );
    ctx.db.prepare('UPDATE conductor_state SET running_since = NULL WHERE room_id = ?').run(roomId);
    requestConductorRun(ctx.db, roomId, { kind: triggers[0]?.kind ?? 'sweep', detail: 'retry after the hourly limit' }, now, 10 * 60_000, room.clock_speed);
    return id;
  }

  const stale = staleItems(ctx, room);
  const onlyRoutine = triggers.length > 0 && triggers.every((t) => t.kind === 'checkin');
  if (!humanTrigger && onlyRoutine && !hasNews(ctx, roomId, sinceSeq) && !stale.length) {
    const id = withTx(ctx, (emit) =>
      logSkip(ctx, room, eff.mode, triggers, 'nothing new', 'Check-ins with no news since the last run (same work, nothing finished, no questions or blockers), so the model was not called.', emit),
    );
    done(maxFeedSeq(ctx.db, roomId));
    return id;
  }

  // Build what the Conductor sees.
  const seqAtStart = maxFeedSeq(ctx.db, roomId);
  const input = buildRunInput(ctx, room, eff.mode, sinceSeq, triggers, stale);
  const runId = nextId(ctx.db, 'run');
  ctx.db
    .prepare(
      `INSERT INTO conductor_runs (id, room_id, triggers, mode, model, status, started_at, saw_summary, actions) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, '[]')`,
    )
    .run(runId, roomId, JSON.stringify(triggers), eff.mode, model.name, iso(now), input.sawSummary);
  ctx.bus.publish({ type: 'conductor', roomId, runId });

  const usage: ModelUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let attempts = 0;
  let output: ConductorOutputT | null = null;
  let lastProblem = '';
  const agentNames = new Set(roomAgents(ctx.db, roomId).map((a) => a.name.toLowerCase()));
  let userText = input.text;
  let modelName: string = model.name;
  // Thinking counts toward the limit, so a reply can run out of room; the one retry then gets
  // double the room (up to 32,000 tokens).
  let maxTokens = ctx.config.conductorMaxTokens;
  const limitsTried: number[] = [];
  let cutOff = 0;
  try {
    while (attempts < 2 && !output) {
      attempts++;
      limitsTried.push(maxTokens);
      const res = await model.call({ system: SYSTEM_PROMPT, user: userText, schema: CONDUCTOR_JSON_SCHEMA, maxTokens, structuredInput: input.structured, purpose: 'conductor' });
      modelName = res.model;
      usage.input_tokens += res.usage.input_tokens;
      usage.output_tokens += res.usage.output_tokens;
      usage.cache_read_input_tokens += res.usage.cache_read_input_tokens;
      usage.cache_creation_input_tokens += res.usage.cache_creation_input_tokens;
      if (res.stopReason === 'max_tokens') {
        cutOff++;
        lastProblem = `its reply was cut off at the ${maxTokens.toLocaleString('en-US')}-token limit (its thinking counts toward the limit)`;
        maxTokens = retryMaxTokens(maxTokens);
      } else if (res.stopReason) {
        lastProblem = res.stopReason === 'refusal' ? 'the model declined to answer' : `the reply stopped early (${res.stopReason})`;
      } else {
        const parsed = ConductorOutput.safeParse(res.output);
        if (!parsed.success) {
          lastProblem = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        } else {
          const problems = semanticProblems(parsed.data, agentNames);
          if (problems.length) lastProblem = problems.join('; ');
          else output = parsed.data;
        }
      }
      if (!output) {
        userText =
          res.stopReason === 'max_tokens'
            ? `${input.text}\n\nYour previous reply was cut off before it finished. Reply again in the required JSON format, and keep it short.`
            : `${input.text}\n\nYour previous reply could not be used (${lastProblem}). Reply again, following the required JSON format exactly and using only agent names from the roster.`;
      }
    }
  } catch (e) {
    lastProblem = `the model call failed: ${(e as Error).message.slice(0, 300)}`;
  }

  const cost = costUsd(priceFor(ctx, modelName), usage);
  if (!output) {
    withTx(ctx, (emit) => {
      ctx.db
        .prepare(
          `UPDATE conductor_runs SET status = 'failed', finished_at = ?, error = ?, summary = ?, attempts = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?, cost_usd = ?, model = ? WHERE id = ?`,
        )
        .run(
          iso(ctx.clock.now()),
          lastProblem,
          cutOff > 0 && cutOff === attempts
            ? `No action was taken: the Conductor ran out of room ${cutOff === 1 ? 'once' : 'twice'}. Its replies, thinking included, hit the limit of ${limitsTried.map((n) => n.toLocaleString('en-US')).join(' and then ')} tokens. If this keeps happening, raise CONDUCTOR_MAX_TOKENS or lower CONDUCTOR_EFFORT.`
            : 'No action was taken because the Conductor did not produce a usable answer after one retry.',
          attempts,
          usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens, cost, modelName, runId);
      emit({ type: 'conductor', roomId, runId });
    });
    done(seqAtStart);
    return runId;
  }

  const final = output;
  withTx(ctx, (emit) => {
    // Re-check the room right before acting (it may have been paused or its mode changed).
    const fresh = getRoom(ctx.db, roomId)!;
    const mode = effectiveMode(ctx, fresh).mode;
    const actions = fresh.paused_at ? [{ kind: 'skipped', id: null, text: 'The room was paused during the run, so nothing was applied.' }] : applyOutput(ctx, fresh, mode, final, runId, input.structured.feed.map((f) => f.id), emit);
    const acted = actions.some((a) => a.kind !== 'skipped');
    ctx.db
      .prepare(
        `UPDATE conductor_runs SET status = ?, finished_at = ?, output = ?, actions = ?, summary = ?, attempts = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?, cost_usd = ?, model = ?, mode = ? WHERE id = ?`,
      )
      .run(
        acted ? 'acted' : 'nothing_to_do',
        iso(ctx.clock.now()),
        JSON.stringify(final),
        JSON.stringify(actions),
        final.summary,
        attempts,
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_input_tokens,
        usage.cache_creation_input_tokens,
        cost,
        modelName,
        mode,
        runId,
      );
    emit({ type: 'conductor', roomId, runId });
    emit({ type: 'room', roomId, what: 'conductor' });
  });
  done(seqAtStart);
  return runId;
}

/** Applies the Conductor's output according to the room's mode and the guardrails. */
export function applyOutput(
  ctx: AppContext,
  room: RoomRow,
  mode: 'autonomous' | 'propose' | 'relay',
  out: ConductorOutputT,
  runId: string,
  seenEventIds: string[],
  emit: Emit,
): RunAction[] {
  const db = ctx.db;
  const at = iso(ctx.clock.now());
  const actions: RunAction[] = [];
  const skip = (text: string) => actions.push({ kind: 'skipped', id: null, text });
  const agents = roomAgents(db, room.id);
  const byName = (name: string) => agents.find((a) => a.name.toLowerCase() === name.trim().replace(/^@/, '').toLowerCase());
  const maxOpen = roomMaxOpenInstructions(room, ctx.config.maxOpenInstructionsPerAgent);
  const askFirst = roomLimits(room).ask_a_person_first;
  const team = roomTeamNames(db, room.id);
  const ph = OPEN_INSTRUCTION_STATUSES.map(() => '?').join(',');
  const openOf = (agentId: string) =>
    db.prepare(`SELECT * FROM instructions WHERE room_id = ? AND agent_id = ? AND (status IN (${ph}) OR status = 'proposed')`).all(room.id, agentId, ...OPEN_INSTRUCTION_STATUSES) as InstructionRow[];

  for (const ins of out.instructions) {
    const agent = byName(ins.agent);
    if (!agent) {
      skip(`Instruction for unknown agent "${ins.agent}" was not issued.`);
      continue;
    }
    if (mode === 'relay') {
      const routedFromPerson = ins.routed_from && isPersonRequest(ctx, room.id, ins.routed_from, seenEventIds);
      if (!routedFromPerson) {
        skip(`Relay mode: the Conductor originates no work, so "${quote(ins.text, 60)}" for ${agent.name} was not issued.`);
        continue;
      }
    }
    if (agent.paused_at) {
      skip(`${agent.name} is paused, so "${quote(ins.text, 60)}" was not issued.`);
      continue;
    }
    const open = openOf(agent.id);
    const dup = open.find((o) => similar(o.text, ins.text));
    if (dup) {
      skip(`"${quote(ins.text, 60)}" is already open for ${agent.name} as ${dup.id}.`);
      continue;
    }
    const concern = limitConcern(`${ins.text}\n${ins.done_when}`, askFirst, team);
    const due = ins.due && !Number.isNaN(Date.parse(ins.due)) ? new Date(ins.due).toISOString() : null;
    if (ins.needs_approval || concern) {
      const reason = ins.approval_reason ?? (concern ? `it involves ${concern}` : 'it needs a person to approve it');
      const d = createDecision(
        db,
        {
          roomId: room.id,
          title: `Approve an instruction for ${agent.name}? ${quote(ins.text, 90)}`,
          context: `The Conductor wants to tell ${agent.name}: "${ins.text}" (done when: ${ins.done_when}). It needs a person first because ${reason}. Why: ${ins.why}`,
          options: ['Approve and send it', "Don't do this", 'Something else (write it)'],
          recommendation: null,
          why: `Outside what agents may do without asking: ${reason}.`,
          source: concern ? 'limits' : 'conductor',
          agentIds: [agent.id],
          proposedInstruction: { agent_id: agent.id, text: ins.text, done_when: ins.done_when, priority: ins.priority, due_at: due, why: ins.why, issuer_kind: 'conductor', run_id: runId },
          raisedBy: CONDUCTOR,
          runId,
          at,
        },
        emit,
      );
      actions.push({ kind: 'decision', id: d.id, text: `Needs approval before ${agent.name} gets it: ${quote(ins.text, 80)}` });
      continue;
    }
    if (open.length >= maxOpen) {
      skip(`${agent.name} already has ${open.length} open instructions (the most allowed is ${maxOpen}), so "${quote(ins.text, 60)}" was not issued.`);
      continue;
    }
    const created = createInstruction(
      db,
      {
        roomId: room.id,
        agentId: agent.id,
        issuer: { kind: 'conductor', runId },
        text: ins.text,
        doneWhen: ins.done_when,
        priority: ins.priority,
        dueAt: due,
        why: ins.why,
        status: mode === 'propose' ? 'proposed' : 'new',
        at,
      },
      emit,
    );
    actions.push({ kind: mode === 'propose' ? 'proposal' : 'instruction', id: created.id, text: `${mode === 'propose' ? 'Proposed for' : 'Told'} ${agent.name}: ${quote(ins.text, 100)}` });
  }

  for (const q of out.questions) {
    const to = q.to.trim().toLowerCase();
    if (to === 'people' || to === 'person' || to === 'humans') {
      const row = createQuestion(db, { roomId: room.id, asker: CONDUCTOR, target: { kind: 'people' }, text: q.text, why: q.why, at }, emit);
      actions.push({ kind: 'question', id: row.id, text: `Asked the people: ${quote(q.text, 100)}` });
      continue;
    }
    const agent = byName(q.to);
    if (!agent) {
      skip(`Question for unknown recipient "${q.to}" was not asked.`);
      continue;
    }
    const row = createQuestion(db, { roomId: room.id, asker: CONDUCTOR, target: { kind: 'agent', agentId: agent.id, name: agent.name }, text: q.text, why: q.why, at }, emit);
    actions.push({ kind: 'question', id: row.id, text: `Asked ${agent.name}: ${quote(q.text, 100)}` });
  }

  for (const c of out.instruction_changes) {
    if (mode === 'relay') {
      skip(`Relay mode: ${c.instruction_id} was left unchanged.`);
      continue;
    }
    const ins = getInstruction(db, c.instruction_id);
    if (!ins || ins.room_id !== room.id || !OPEN_INSTRUCTION_STATUSES.concat(['proposed']).includes(ins.status)) {
      skip(`${c.instruction_id} is not an open instruction in this room.`);
      continue;
    }
    if (ins.issuer_kind !== 'conductor') {
      skip(`${c.instruction_id} was given by a person, so the Conductor left it alone.`);
      continue;
    }
    if (c.action === 'cancel') {
      setInstructionStatus(db, ins, { status: 'cancelled', note: `Cancelled by the Conductor: ${c.why}` }, CONDUCTOR, at, emit);
      actions.push({ kind: 'cancel', id: ins.id, text: `Cancelled ${ins.id}: ${c.why}` });
    } else if (c.new_text) {
      db.prepare('UPDATE instructions SET text = ?, done_when = ?, updated_at = ? WHERE id = ?').run(c.new_text, c.new_done_when ?? ins.done_when, at, ins.id);
      const agent = getAgent(db, ins.agent_id);
      appendFeed(
        db,
        {
          roomId: room.id,
          kind: 'instruction_status',
          actorKind: 'conductor',
          actorName: 'Conductor',
          targetAgentId: ins.agent_id,
          threadId: ins.id,
          refId: ins.id,
          text: `${ins.id} for ${agent?.name ?? ''} was reworded by the Conductor: ${c.new_text}`,
          data: { instruction_id: ins.id, status: ins.status, previous_status: ins.status, note: `Reworded: ${c.why}`, reworded_to: c.new_text },
          at,
        },
        emit,
      );
      db.prepare(`INSERT INTO instruction_events (instruction_id, status, note, actor_kind, at) VALUES (?, ?, ?, 'conductor', ?)`).run(ins.id, ins.status, `Reworded: ${c.why}`, at);
      actions.push({ kind: 'reword', id: ins.id, text: `Reworded ${ins.id}: ${quote(c.new_text, 100)}` });
    }
  }

  for (const d of out.decisions) {
    const agentIds = d.agents.map((n) => byName(n)?.id).filter((x): x is string => !!x);
    const row = createDecision(
      db,
      { roomId: room.id, title: d.title, context: d.context, options: d.options, recommendation: d.recommendation, why: d.why, source: 'conductor', agentIds, raisedBy: CONDUCTOR, runId, at },
      emit,
    );
    actions.push({ kind: 'decision', id: row.id, text: `Asked people to decide: ${quote(d.title, 100)}` });
  }

  for (const a of out.answers) {
    const q = getQuestion(db, a.question_id);
    if (!q || q.room_id !== room.id || q.status !== 'open' || q.target_kind !== 'conductor') {
      skip(`${a.question_id} is not an open question for the Conductor.`);
      continue;
    }
    answerQuestion(db, q, CONDUCTOR, a.answer, at, emit);
    actions.push({ kind: 'answer', id: q.id, text: `Answered ${q.id}: ${quote(a.answer, 100)}` });
  }

  if (out.room_note) {
    appendFeed(db, { roomId: room.id, kind: 'conductor_note', actorKind: 'conductor', actorName: 'Conductor', text: out.room_note, data: { text: out.room_note, run_id: runId }, at }, emit);
    actions.push({ kind: 'note', id: null, text: `Room note: ${quote(out.room_note, 100)}` });
  }

  for (const p of out.playbook_suggestions) {
    const exists = db.prepare('SELECT 1 FROM playbook_entries WHERE room_id = ? AND LOWER(title) = LOWER(?) AND archived_at IS NULL').get(room.id, p.title);
    if (exists) continue;
    const id = createPlaybookEntry(db, { roomId: room.id, title: p.title, body: p.text, author: CONDUCTOR, at }, emit);
    actions.push({ kind: 'playbook', id, text: `Saved a lesson: ${quote(p.title, 80)}` });
  }
  return actions;
}

function isPersonRequest(ctx: AppContext, roomId: string, ref: string, seen: string[]): boolean {
  const m = /^(evt|q)_(\d+)$/.exec(ref.trim());
  if (!m) return false;
  if (m[1] === 'evt') {
    if (!seen.includes(ref.trim())) return false;
    const ev = ctx.db.prepare('SELECT room_id, actor_kind FROM feed_events WHERE seq = ?').get(Number(m[2])) as { room_id: string; actor_kind: string } | undefined;
    return !!ev && ev.room_id === roomId && ev.actor_kind === 'person';
  }
  const q = getQuestion(ctx.db, ref.trim());
  return !!q && q.room_id === roomId && q.asker_kind === 'person';
}

// ------------------------------------------------------------------------------------------------
// Scheduler jobs
// ------------------------------------------------------------------------------------------------

/** Starts runs whose debounced time has come. One run at a time per room. */
export function conductorJob(scheduler: Scheduler): Job {
  return {
    name: 'conductor-queue',
    run(ctx) {
      const now = iso(ctx.clock.now());
      // Clear a run marker left behind by a crash or restart.
      ctx.db
        .prepare(`UPDATE conductor_state SET running_since = NULL WHERE running_since IS NOT NULL AND running_since < ?`)
        .run(iso(ctx.clock.now() - 10 * 60_000));
      const due = ctx.db
        .prepare(
          `SELECT s.room_id FROM conductor_state s JOIN rooms r ON r.id = s.room_id
           WHERE s.pending_run_at IS NOT NULL AND s.pending_run_at <= ? AND r.archived_at IS NULL`,
        )
        .all(now) as { room_id: string }[];
      for (const { room_id } of due) {
        if (lockSet(ctx).has(room_id)) continue;
        void scheduler.track(runConductor(ctx, room_id));
      }
    },
  };
}

/** Every 15 minutes per room: if something has gone stale, ask the Conductor to look. */
export const sweepJob: Job = {
  name: 'conductor-sweep',
  run(ctx) {
    const now = ctx.clock.now();
    const rooms = ctx.db.prepare('SELECT * FROM rooms WHERE archived_at IS NULL AND paused_at IS NULL').all() as RoomRow[];
    for (const room of rooms) {
      const state = ctx.db.prepare('SELECT last_sweep_at, last_stale_fingerprint, last_stale_run_at FROM conductor_state WHERE room_id = ?').get(room.id) as
        | { last_sweep_at: string | null; last_stale_fingerprint: string | null; last_stale_run_at: string | null }
        | undefined;
      const speed = room.clock_speed > 0 ? room.clock_speed : 1;
      if (state?.last_sweep_at && now - ms(state.last_sweep_at) < (SWEEP_MINUTES * 60_000) / speed) continue;
      ctx.db
        .prepare(`INSERT INTO conductor_state (room_id, last_sweep_at) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET last_sweep_at = excluded.last_sweep_at`)
        .run(room.id, iso(now));
      const stale = staleItems(ctx, room);
      if (!stale.length) continue;
      const fingerprint = createHash('sha256').update(stale.join('\n')).digest('hex').slice(0, 16);
      // The same stale picture is looked at again at most every 2 hours (scaled), to bound cost.
      const recent = state?.last_stale_run_at && now - ms(state.last_stale_run_at) < (2 * 3600_000) / speed;
      if (state?.last_stale_fingerprint === fingerprint && recent) continue;
      ctx.db.prepare('UPDATE conductor_state SET last_stale_fingerprint = ?, last_stale_run_at = ? WHERE room_id = ?').run(fingerprint, iso(now), room.id);
      requestConductorRun(ctx.db, room.id, { kind: 'sweep', detail: stale.slice(0, 3).join(' ') }, now, 0, speed);
    }
  },
};

/** For the schedule of an agent-less estimate: how many minutes is one interval in this room. */
export function roomIntervalMs(ctx: AppContext, room: RoomRow): number {
  const agents = roomAgents(ctx.db, room.id);
  if (!agents.length) return 60 * 60_000;
  return Math.min(...agents.map((a) => scaled(scheduleFromRow(a), a.interval_minutes)));
}
