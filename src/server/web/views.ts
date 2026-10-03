import type { AppContext } from '../context.js';
import { parseJson } from '../db/index.js';
import { parseDays } from '../lib/time.js';
import type {
  AgentView,
  ConductorRunView,
  ConductorSummary,
  DecisionView,
  FeedEvent,
  InstructionView,
  Lane,
  Light,
  PlaybookEntryView,
  QuestionView,
  RoomSummary,
  RoomView,
} from '../../shared/app-types.js';
import { effectiveMode, modelForRoom, modelRunsLastHour, monthSpend } from '../conductor/budget.js';
import { feedEventId } from '../services/feed.js';
import { agentRooms, getAgent, getPerson, roomAgents } from '../services/repo.js';
import type { AgentRow, DecisionRow, FeedRow, InstructionRow, PersonRow, PlaybookRow, QuestionRow, RoomRow } from '../services/rows.js';
import { OPEN_INSTRUCTION_STATUSES } from '../services/rows.js';
import { computeAgentStatus } from '../services/status.js';
import { describeSchedule, scheduleFromRow } from '../services/schedule.js';
import { iso } from '../lib/time.js';

/** Turns database rows into the shapes in src/shared/app-types.ts. */

const LIGHT_ORDER: Light[] = ['red', 'amber', 'green', 'gray'];

export function worstLight(lights: Light[]): Light {
  for (const l of LIGHT_ORDER) if (lights.includes(l)) return l;
  return 'gray';
}

export function roomView(ctx: AppContext, r: RoomRow): RoomView {
  return {
    id: r.id,
    name: r.name,
    goal: r.goal,
    rules: parseJson<string[]>(r.rules, []),
    limits_allowed: parseJson<string[]>(r.limits_allowed, []),
    limits_ask_first: parseJson<string[]>(r.limits_ask_first, []),
    conductor_mode: r.conductor_mode,
    timezone: r.timezone,
    work_days: parseDays(r.work_days),
    work_start: r.work_start,
    work_end: r.work_end,
    brief_time: r.brief_time,
    paused: !!r.paused_at,
    paused_at: r.paused_at,
    paused_by_name: r.paused_by ? (getPerson(ctx.db, r.paused_by)?.name ?? null) : null,
    is_sandbox: !!r.is_sandbox,
    clock_speed: r.clock_speed,
    card_token_budget: r.card_token_budget,
    max_open_instructions: r.max_open_instructions,
    created_at: r.created_at,
  };
}

export function roomSummary(ctx: AppContext, r: RoomRow): RoomSummary {
  const agents = roomAgents(ctx.db, r.id);
  const waiting = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM decisions WHERE room_id = ? AND status = 'open'`).get(r.id) as { n: number }).n;
  const proposals = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM instructions WHERE room_id = ? AND status = 'proposed'`).get(r.id) as { n: number }).n;
  return {
    id: r.id,
    name: r.name,
    status: worstLight(agents.map((a) => a.status)),
    paused: !!r.paused_at,
    is_sandbox: !!r.is_sandbox,
    decisions_waiting: waiting + proposals,
    agent_count: agents.length,
    timezone: r.timezone,
    work_days: parseDays(r.work_days),
    work_start: r.work_start,
    work_end: r.work_end,
  };
}

export function agentView(ctx: AppContext, a: AgentRow, viewer: PersonRow): AgentView {
  const s = scheduleFromRow(a);
  const status = computeAgentStatus(ctx, a);
  const isMine = a.owner_id === viewer.id;
  let keys: AgentView['keys'] = null;
  if (isMine) {
    const k = (kind: 'api' | 'page') =>
      ctx.db
        .prepare(`SELECT hint, created_at, last_used_at FROM agent_keys WHERE agent_id = ? AND kind = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`)
        .get(a.id, kind) as { hint: string; created_at: string; last_used_at: string | null } | undefined;
    const api = k('api');
    const page = k('page');
    keys = {
      api_hint: api?.hint ?? null,
      api_created_at: api?.created_at ?? null,
      api_last_used_at: api?.last_used_at ?? null,
      page_hint: page?.hint ?? null,
      page_created_at: page?.created_at ?? null,
      page_last_used_at: page?.last_used_at ?? null,
    };
  }
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    description: a.description,
    owner_id: a.owner_id,
    owner_name: getPerson(ctx.db, a.owner_id)?.name ?? '',
    is_mine: isMine,
    status: status.light,
    status_reason: status.reason,
    status_changed_at: a.status_changed_at,
    last_checkin_at: a.last_checkin_at,
    last_seen_at: a.last_seen_at,
    next_due_at: status.nextDueMs !== null ? iso(status.nextDueMs) : null,
    paused: !!a.paused_at,
    schedule: {
      interval_minutes: a.interval_minutes,
      work_days: s.workDays,
      work_start: a.work_start,
      work_end: a.work_end,
      timezone: a.timezone,
      offset_minutes: a.offset_minutes,
      grace_minutes: a.grace_minutes,
      clock_speed: a.clock_speed,
      text: describeSchedule(s, ctx.clock.now()),
    },
    room_ids: agentRooms(ctx.db, a.id).map((r) => r.id),
    keys,
  };
}

function personOrAgentName(ctx: AppContext, kind: string | null, id: string | null): string {
  if (kind === 'agent') return getAgent(ctx.db, id ?? '')?.name ?? 'an agent';
  if (kind === 'person') return getPerson(ctx.db, id ?? '')?.name ?? 'a person';
  if (kind === 'conductor') return 'Conductor';
  return 'Tempo';
}

export function instructionView(ctx: AppContext, i: InstructionRow): InstructionView {
  return {
    id: i.id,
    room_id: i.room_id,
    agent_id: i.agent_id,
    agent_name: getAgent(ctx.db, i.agent_id)?.name ?? i.agent_id,
    issuer_kind: i.issuer_kind,
    issuer_name: i.issuer_kind === 'person' ? (getPerson(ctx.db, i.issuer_person_id ?? '')?.name ?? 'a person') : 'Conductor',
    text: i.text,
    done_when: i.done_when,
    priority: i.priority,
    due_at: i.due_at,
    why: i.why,
    status: i.status,
    status_note: i.status_note,
    proof: i.proof,
    created_at: i.created_at,
    issued_at: i.issued_at,
    updated_at: i.updated_at,
  };
}

export function questionView(ctx: AppContext, q: QuestionRow): QuestionView {
  return {
    id: q.id,
    room_id: q.room_id,
    asker_kind: q.asker_kind,
    asker_name: personOrAgentName(ctx, q.asker_kind, q.asker_id),
    target_kind: q.target_kind,
    target_name: q.target_kind === 'agent' ? (getAgent(ctx.db, q.target_agent_id ?? '')?.name ?? 'an agent') : q.target_kind === 'people' ? 'People' : 'Conductor',
    text: q.text,
    status: q.status,
    answer: q.answer,
    answered_at: q.answered_at,
    answerer_name: q.answerer_kind ? personOrAgentName(ctx, q.answerer_kind, q.answerer_id) : null,
    created_at: q.created_at,
  };
}

export function decisionView(ctx: AppContext, d: DecisionRow): DecisionView {
  const p = d.proposed_instruction ? parseJson<Record<string, any> | null>(d.proposed_instruction, null) : null;
  return {
    id: d.id,
    room_id: d.room_id,
    title: d.title,
    context: d.context,
    options: parseJson<string[]>(d.options, []),
    recommendation: d.recommendation,
    why: d.why,
    source: d.source,
    source_ref: d.source_ref,
    status: d.status,
    created_at: d.created_at,
    resolved_at: d.resolved_at,
    resolved_by_name: d.resolved_by ? (getPerson(ctx.db, d.resolved_by)?.name ?? null) : null,
    resolution: d.resolution,
    proposed_instruction: p
      ? {
          agent_id: p.agent_id,
          agent_name: getAgent(ctx.db, p.agent_id)?.name ?? p.agent_id,
          text: p.text,
          done_when: p.done_when,
          priority: p.priority,
          due_at: p.due_at ?? null,
          why: p.why ?? null,
        }
      : null,
  };
}

export function feedEventView(ctx: AppContext, r: FeedRow): FeedEvent {
  return {
    seq: r.seq,
    id: feedEventId(r.seq),
    room_id: r.room_id,
    kind: r.kind,
    actor_kind: r.actor_kind,
    actor_id: r.actor_id,
    actor_name: r.actor_name,
    target_agent_id: r.target_agent_id,
    thread_id: r.thread_id,
    ref_id: r.ref_id,
    text: r.text,
    data: parseJson<Record<string, any>>(r.data, {}),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function playbookView(ctx: AppContext, p: PlaybookRow): PlaybookEntryView {
  return {
    id: p.id,
    room_id: p.room_id,
    title: p.title,
    body: p.body,
    author_kind: p.author_kind,
    author_name: personOrAgentName(ctx, p.author_kind, p.author_id),
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

export function conductorRunView(r: Record<string, any>): ConductorRunView {
  return {
    id: r.id,
    triggers: parseJson(r.triggers, []),
    mode: r.mode,
    model: r.model,
    status: r.status,
    skip_reason: r.skip_reason,
    started_at: r.started_at,
    finished_at: r.finished_at,
    saw_summary: r.saw_summary,
    summary: r.summary,
    actions: parseJson(r.actions, []),
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    cost_usd: r.cost_usd,
    error: r.error,
  };
}

export function conductorSummary(ctx: AppContext, room: RoomRow): ConductorSummary {
  const eff = effectiveMode(ctx, room);
  const model = modelForRoom(ctx, room);
  const last = ctx.db.prepare('SELECT * FROM conductor_runs WHERE room_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(room.id) as Record<string, any> | undefined;
  const state = ctx.db.prepare('SELECT pending_run_at FROM conductor_state WHERE room_id = ?').get(room.id) as { pending_run_at: string | null } | undefined;
  return {
    mode: room.conductor_mode,
    effective_mode: eff.mode,
    banner: eff.banner,
    model: model?.name ?? ctx.config.conductorModel,
    scripted: !!model?.scripted,
    has_key: !!ctx.integrations.conductorModel,
    month_spent_usd: Math.round(monthSpend(ctx) * 10000) / 10000,
    month_budget_usd: ctx.config.conductorMonthlyBudgetUsd,
    runs_last_hour: modelRunsLastHour(ctx, room.id),
    max_runs_per_hour: ctx.config.conductorMaxRunsPerHour,
    pending_run_at: state?.pending_run_at ?? null,
    last_run: last ? conductorRunView(last) : null,
  };
}

export function lanes(ctx: AppContext, room: RoomRow): Lane[] {
  const placeholders = OPEN_INSTRUCTION_STATUSES.map(() => '?').join(',');
  return roomAgents(ctx.db, room.id).map((a) => {
    const latest = ctx.db
      .prepare('SELECT working_on, updated_at, blocked_reason, blocked_unblock FROM report_rooms WHERE room_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(room.id, a.id) as { working_on: string; updated_at: string; blocked_reason: string | null; blocked_unblock: string | null } | undefined;
    const ins = ctx.db
      .prepare(`SELECT * FROM instructions WHERE room_id = ? AND agent_id = ? AND status IN (${placeholders}) ORDER BY issued_at`)
      .all(room.id, a.id, ...OPEN_INSTRUCTION_STATUSES) as InstructionRow[];
    const qs = ctx.db
      .prepare(`SELECT * FROM questions WHERE room_id = ? AND target_kind = 'agent' AND target_agent_id = ? AND status = 'open' ORDER BY created_at`)
      .all(room.id, a.id) as QuestionRow[];
    return {
      agent_id: a.id,
      agent_name: a.name,
      status: computeAgentStatus(ctx, a).light,
      working_on: latest?.working_on ?? null,
      working_on_at: latest?.updated_at ?? null,
      blocked: latest?.blocked_reason ? { reason: latest.blocked_reason, what_would_unblock: latest.blocked_unblock ?? '' } : null,
      instructions: ins.map((i) => instructionView(ctx, i)),
      questions_waiting: qs.map((q) => questionView(ctx, q)),
    };
  });
}
