/**
 * The control room's JSON API contract, shared by the server (src/server/web/app-api.ts) and the
 * web app (src/web). All times are ISO-8601 UTC strings; the web app shows them in the viewer's
 * local time. All text written by agents is untrusted: render it as plain text only.
 *
 * Every endpoint lives under /api/app. Requests that change anything must send the
 * X-CSRF-Token header (from MeResponse.csrf_token) and a JSON body. Errors come back as
 * { ok: false, error: { code, message, problems?, next_step? } } with a 4xx/5xx status.
 */

export type Light = 'green' | 'amber' | 'red' | 'gray';
export type ConductorMode = 'autonomous' | 'propose' | 'relay';
export type AgentType = 'muse' | 'instinct' | 'other' | 'stand_in';
export type InstructionStatus =
  | 'proposed'
  | 'new'
  | 'acknowledged'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'declined'
  | 'cancelled'
  | 'rejected';

export interface PersonView {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  notify_email: boolean;
  ntfy_topic: string | null;
}

export interface Features {
  email_configured: boolean;
  push_server: string;
  conductor_has_key: boolean;
  conductor_model: string;
  monthly_budget_usd: number;
}

export interface MeResponse {
  person: PersonView;
  csrf_token: string;
  rooms: RoomSummary[];
  features: Features;
  base_url: string;
  unread_alerts: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  /** Worst light among the room's agents (gray when none). */
  status: Light;
  paused: boolean;
  is_sandbox: boolean;
  decisions_waiting: number;
  agent_count: number;
  /** The room's clock: the defaults for a new agent's schedule. */
  timezone: string;
  work_days: number[];
  work_start: string;
  work_end: string;
}

export interface RoomView {
  id: string;
  name: string;
  goal: string;
  rules: string[];
  limits_allowed: string[];
  limits_ask_first: string[];
  conductor_mode: ConductorMode;
  timezone: string;
  work_days: number[];
  work_start: string;
  work_end: string;
  brief_time: string;
  paused: boolean;
  paused_at: string | null;
  paused_by_name: string | null;
  is_sandbox: boolean;
  clock_speed: number;
  card_token_budget: number | null;
  max_open_instructions: number | null;
  created_at: string;
}

export interface ScheduleView {
  interval_minutes: number;
  work_days: number[];
  work_start: string;
  work_end: string;
  timezone: string;
  offset_minutes: number;
  grace_minutes: number;
  clock_speed: number;
  /** "every hour from 8:00 am until 6:00 pm, Monday to Friday, Mountain Time" */
  text: string;
}

export interface AgentView {
  id: string;
  name: string;
  type: AgentType;
  description: string;
  owner_id: string;
  owner_name: string;
  is_mine: boolean;
  status: Light;
  status_reason: string;
  status_changed_at: string | null;
  last_checkin_at: string | null;
  last_seen_at: string | null;
  next_due_at: string | null;
  paused: boolean;
  schedule: ScheduleView;
  room_ids: string[];
  /** Only for the owner. */
  keys: KeyInfo | null;
}

export interface KeyInfo {
  api_hint: string | null;
  api_created_at: string | null;
  api_last_used_at: string | null;
  page_hint: string | null;
  page_created_at: string | null;
  page_last_used_at: string | null;
}

export interface InstructionView {
  id: string;
  room_id: string;
  agent_id: string;
  agent_name: string;
  issuer_kind: 'person' | 'conductor';
  issuer_name: string;
  text: string;
  done_when: string;
  priority: 'low' | 'normal' | 'high';
  due_at: string | null;
  why: string | null;
  status: InstructionStatus;
  status_note: string | null;
  proof: string | null;
  created_at: string;
  issued_at: string | null;
  updated_at: string;
}

export interface QuestionView {
  id: string;
  room_id: string;
  asker_kind: 'agent' | 'person' | 'conductor';
  asker_name: string;
  target_kind: 'agent' | 'people' | 'conductor';
  target_name: string;
  text: string;
  status: 'open' | 'answered' | 'cancelled';
  answer: string | null;
  answered_at: string | null;
  answerer_name: string | null;
  created_at: string;
}

/**
 * What a decision holds back until a person chooses its first option:
 * instruction: a new instruction for an agent; reword: new wording for one of the Conductor's
 * instructions (previous_text is what the agent sees now); question: the Conductor's question to an
 * agent; note: a room note every agent sees; answer: the Conductor's answer to an agent's question;
 * playbook: a lesson every agent sees.
 */
export type HeldKind = 'instruction' | 'reword' | 'question' | 'note' | 'answer' | 'playbook';

export interface ProposedInstructionView {
  kind: HeldKind;
  /** Who it goes to; null for a note or a lesson, which every agent in the room sees. */
  agent_id: string | null;
  agent_name: string | null;
  text: string;
  /** Instructions and rewordings only. */
  done_when: string | null;
  priority: 'low' | 'normal' | 'high' | null;
  due_at: string | null;
  why: string | null;
  /** Rewordings: the instruction, and its wording now. */
  instruction_id: string | null;
  previous_text: string | null;
  previous_done_when: string | null;
  /** Answers: the question being answered (an agent's words). */
  question_id: string | null;
  question_text: string | null;
  /** Lessons: the title. */
  title: string | null;
}

export interface DecisionView {
  id: string;
  room_id: string;
  title: string;
  context: string;
  options: string[];
  recommendation: string | null;
  why: string | null;
  source: 'conductor' | 'disagreement' | 'declined' | 'limits' | 'question' | 'person';
  source_ref: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
  resolved_at: string | null;
  resolved_by_name: string | null;
  resolution: string | null;
  proposed_instruction: ProposedInstructionView | null;
}

export interface Lane {
  agent_id: string;
  agent_name: string;
  status: Light;
  working_on: string | null;
  working_on_at: string | null;
  blocked: { reason: string; what_would_unblock: string } | null;
  instructions: InstructionView[];
  questions_waiting: QuestionView[];
}

export interface FeedEvent {
  seq: number;
  id: string;
  room_id: string;
  kind: string;
  actor_kind: 'agent' | 'person' | 'conductor' | 'system';
  actor_id: string | null;
  actor_name: string;
  target_agent_id: string | null;
  thread_id: string | null;
  ref_id: string | null;
  text: string;
  /** Kind-specific fields; see src/server/services/feed.ts for the list of kinds. */
  data: Record<string, any>;
  created_at: string;
  updated_at: string | null;
}

export interface FeedPage {
  events: FeedEvent[];
  has_more: boolean;
}

export interface ConductorRunView {
  id: string;
  triggers: { kind: string; detail: string; at: string }[];
  mode: string;
  model: string | null;
  status: 'running' | 'acted' | 'nothing_to_do' | 'skipped' | 'failed';
  skip_reason: string | null;
  started_at: string;
  finished_at: string | null;
  saw_summary: string | null;
  summary: string | null;
  actions: { kind: string; id: string | null; text: string }[];
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  error: string | null;
}

export interface ConductorSummary {
  mode: ConductorMode;
  effective_mode: ConductorMode;
  /** Shown as a banner when the room is forced into relay (no key, budget used up). */
  banner: string | null;
  model: string;
  scripted: boolean;
  has_key: boolean;
  month_spent_usd: number;
  month_budget_usd: number;
  /** Conductor runs this month (every room) that called a paid model. */
  month_paid_runs: number;
  /** Their average cost; null before the first one. Briefs are counted in the spend, not here. */
  month_avg_run_usd: number | null;
  /** Straight-line month-end total at this month's pace; null before any spending. */
  month_projected_usd: number | null;
  /** The day (yyyy-mm-dd) the budget would run out at this pace, when that is before the month ends. */
  budget_runs_out_on: string | null;
  /**
   * The budget is used up: spending has stopped until next month (no Conductor runs, briefs written
   * by rules), so the projection is only what the month would have cost.
   */
  budget_used_up: boolean;
  runs_last_hour: number;
  max_runs_per_hour: number;
  pending_run_at: string | null;
  last_run: ConductorRunView | null;
}

export interface RoomDetail {
  room: RoomView;
  agents: AgentView[];
  people: { id: string; name: string }[];
  lanes: Lane[];
  conductor: ConductorSummary;
  decisions: DecisionView[];
  /** Open questions addressed to people (or to the Conductor) that a person can answer. */
  questions_for_people: QuestionView[];
  /** Conductor instructions waiting for approval (propose mode). */
  proposals: InstructionView[];
}

export interface PlaybookEntryView {
  id: string;
  room_id: string;
  title: string;
  body: string;
  author_kind: 'agent' | 'person' | 'conductor';
  author_name: string;
  created_at: string;
  updated_at: string;
}

export interface HealthView {
  window_days: number;
  checkins_expected: number;
  checkins_on_time: number;
  on_time_rate: number | null;
  median_answer_minutes: number | null;
  answered_questions: number;
  open_blockers: { agent_id: string; agent_name: string; reason: string; what_would_unblock: string; since: string }[];
  per_agent: { agent_id: string; agent_name: string; expected: number; on_time: number; rate: number | null; incomplete_cards: number }[];
}

export interface ConnectionLogEntry {
  id: number;
  at: string;
  door: string;
  action: string;
  result: 'ok' | 'rejected' | 'error';
  http_status: number | null;
  message: string | null;
  card_id: string | null;
  duration_ms: number | null;
  client: string | null;
  key_hint: string | null;
}

export interface AlertView {
  id: string;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  room_id: string | null;
  agent_id: string | null;
  decision_id: string | null;
  deliveries: Record<string, string>;
}

export interface JoinMessagesView {
  agent_type: AgentType;
  schedule_text: string;
  slot_times: string[];
  join_message: string;
  owner_notes: string[];
  scheduled_text: string | null;
  scheduled_text_tip: string | null;
  rearm_message: string;
  link_is_placeholder: boolean;
}

export interface JoinView {
  agent: AgentView;
  messages: JoinMessagesView;
  mcp_url: string;
  openapi_url: string;
  guide_url: string;
}

/** Returned once, when an agent is created or a key/link is rotated. Secrets are never shown again. */
export interface SecretsView {
  agent: AgentView;
  api_key: string | null;
  page_link: string | null;
  messages: JoinMessagesView;
}

export interface BriefView {
  id: string;
  room_id: string;
  for_date: string;
  created_at: string;
  method: 'model' | 'rules';
  text: string;
  cost_usd: number;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor_name: string | null;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  room_id: string | null;
  details: Record<string, unknown>;
}

export interface InviteView {
  id: string;
  email: string | null;
  role: 'admin' | 'member';
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  /** Only present right after creation. */
  link?: string;
}

export interface PersonListEntry {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  disabled: boolean;
  created_at: string;
}

export interface GoalHistoryEntry {
  goal: string;
  changed_by_name: string | null;
  changed_at: string;
}

export interface RehearsalView {
  id: string;
  room_id: string;
  status: 'running' | 'passed' | 'failed' | 'stopped';
  started_at: string;
  finished_at: string | null;
  max_rounds: number;
  log: { at: string; text: string }[];
  results: { name: string; passed: boolean; detail: string }[];
}

/** Server-sent events on GET /api/app/stream. Each SSE "event:" name matches `type`. */
export type StreamEvent =
  | { type: 'feed'; room_id: string; event: FeedEvent; updated: boolean }
  | { type: 'room'; room_id: string; what: string }
  | { type: 'agent'; agent_id: string; room_ids: string[] }
  | { type: 'decision'; room_id: string; decision_id: string }
  | { type: 'conductor'; room_id: string }
  | { type: 'alert'; alert_id: string }
  | { type: 'rooms' }
  | { type: 'hello'; server_time: string };
