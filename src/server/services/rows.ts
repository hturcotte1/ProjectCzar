/** Row shapes as stored in SQLite (see db/migrations.ts). */

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'member';
  notify_email: number;
  ntfy_topic: string | null;
  created_at: string;
  disabled_at: string | null;
}

export interface RoomRow {
  id: string;
  name: string;
  goal: string;
  rules: string;
  limits_allowed: string;
  limits_ask_first: string;
  conductor_mode: 'autonomous' | 'propose' | 'relay';
  timezone: string;
  work_days: string;
  work_start: string;
  work_end: string;
  brief_time: string;
  card_token_budget: number | null;
  max_open_instructions: number | null;
  paused_at: string | null;
  paused_by: string | null;
  is_sandbox: number;
  clock_speed: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface AgentRow {
  id: string;
  name: string;
  owner_id: string;
  type: 'muse' | 'instinct' | 'other' | 'stand_in';
  description: string;
  interval_minutes: number;
  work_days: string;
  work_start: string;
  work_end: string;
  timezone: string;
  offset_minutes: number;
  grace_minutes: number;
  clock_speed: number;
  paused_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_card_at: string | null;
  last_checkin_at: string | null;
  last_checkin_card_id: string | null;
  status: 'green' | 'amber' | 'red' | 'gray';
  status_reason: string;
  status_changed_at: string | null;
}

export interface CardRow {
  id: string;
  agent_id: string;
  door: string;
  issued_at: string;
  expires_at: string;
  status: 'open' | 'completed' | 'expired' | 'superseded';
  completed_at: string | null;
  paused: number;
  content: string;
  requirements: string;
  since_cutoff: string | null;
  opened_count: number;
  incomplete_at: string | null;
}

export interface CardRequirements {
  rooms: string[];
  questions: string[];
  instructions: string[];
  paused_rooms: string[];
  all_paused: boolean;
}

export interface ReportRow {
  id: string;
  card_id: string;
  agent_id: string;
  door: string;
  created_at: string;
  updated_at: string;
  revision: number;
  body: string;
}

export interface QuestionRow {
  id: string;
  room_id: string;
  asker_kind: 'agent' | 'person' | 'conductor';
  asker_id: string | null;
  target_kind: 'agent' | 'people' | 'conductor';
  target_agent_id: string | null;
  text: string;
  why: string | null;
  status: 'open' | 'answered' | 'cancelled';
  created_at: string;
  answer: string | null;
  answered_at: string | null;
  answerer_kind: string | null;
  answerer_id: string | null;
  answer_report_id: string | null;
  source_key: string | null;
  feed_seq: number | null;
  answer_feed_seq: number | null;
}

export type InstructionStatusAll =
  | 'proposed'
  | 'new'
  | 'acknowledged'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'declined'
  | 'cancelled'
  | 'rejected';

/** Statuses that keep an instruction on the agent's card. */
export const OPEN_INSTRUCTION_STATUSES: InstructionStatusAll[] = ['new', 'acknowledged', 'in_progress', 'blocked'];

export interface InstructionRow {
  id: string;
  room_id: string;
  agent_id: string;
  issuer_kind: 'person' | 'conductor';
  issuer_person_id: string | null;
  text: string;
  done_when: string;
  priority: 'low' | 'normal' | 'high';
  due_at: string | null;
  why: string | null;
  status: InstructionStatusAll;
  status_note: string | null;
  proof: string | null;
  created_at: string;
  issued_at: string | null;
  updated_at: string;
  last_movement_at: string;
  conductor_run_id: string | null;
  approved_by: string | null;
  feed_seq: number | null;
}

export interface DecisionRow {
  id: string;
  room_id: string;
  title: string;
  context: string;
  options: string;
  recommendation: string | null;
  why: string | null;
  source: 'conductor' | 'disagreement' | 'declined' | 'limits' | 'question' | 'person';
  source_ref: string | null;
  source_key: string | null;
  agent_ids: string;
  proposed_instruction: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
  resolution_option: number | null;
  conductor_run_id: string | null;
  feed_seq: number | null;
}

export interface PlaybookRow {
  id: string;
  room_id: string;
  title: string;
  body: string;
  author_kind: 'agent' | 'person' | 'conductor';
  author_id: string | null;
  source_key: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  archived_at: string | null;
}

export interface FeedRow {
  seq: number;
  room_id: string;
  kind: string;
  actor_kind: 'agent' | 'person' | 'conductor' | 'system';
  actor_id: string | null;
  actor_name: string;
  target_agent_id: string | null;
  thread_id: string | null;
  ref_id: string | null;
  text: string;
  data: string;
  created_at: string;
  updated_at: string | null;
}
