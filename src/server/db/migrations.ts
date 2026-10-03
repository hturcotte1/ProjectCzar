/**
 * Database migrations, applied in order and recorded in `schema_migrations`.
 * Never edit a migration that has shipped; add a new one.
 *
 * Conventions:
 *  - Every timestamp is an ISO-8601 UTC string (see lib/time.ts).
 *  - Public ids are short and readable with a prefix: room_3, agt_2, card_118, q_12, ins_31, dec_4.
 *  - JSON columns hold arrays/objects as text.
 *  - Agent status lights are always computed from stored timestamps; `agents.status`
 *    only remembers the last evaluated value so transitions (and alerts) fire once.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: /* sql */ `
CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- People -------------------------------------------------------------------

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  notify_email INTEGER NOT NULL DEFAULT 1,
  ntfy_topic TEXT,
  created_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_person ON sessions(person_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  room_ids TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL REFERENCES people(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by TEXT REFERENCES people(id),
  revoked_at TEXT
);

-- Rooms --------------------------------------------------------------------

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '[]',
  limits_allowed TEXT NOT NULL DEFAULT '[]',
  limits_ask_first TEXT NOT NULL DEFAULT '[]',
  conductor_mode TEXT NOT NULL DEFAULT 'autonomous' CHECK (conductor_mode IN ('autonomous', 'propose', 'relay')),
  timezone TEXT NOT NULL DEFAULT 'America/Boise',
  work_days TEXT NOT NULL DEFAULT '1,2,3,4,5',
  work_start TEXT NOT NULL DEFAULT '08:00',
  work_end TEXT NOT NULL DEFAULT '18:00',
  brief_time TEXT NOT NULL DEFAULT '07:30',
  card_token_budget INTEGER,
  max_open_instructions INTEGER,
  paused_at TEXT,
  paused_by TEXT,
  is_sandbox INTEGER NOT NULL DEFAULT 0,
  clock_speed REAL NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES people(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE goal_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  changed_by TEXT REFERENCES people(id),
  changed_at TEXT NOT NULL
);
CREATE INDEX goal_history_room ON goal_history(room_id, id);

CREATE TABLE room_people (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (room_id, person_id)
);
CREATE INDEX room_people_person ON room_people(person_id);

-- Agents -------------------------------------------------------------------

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  owner_id TEXT NOT NULL REFERENCES people(id),
  type TEXT NOT NULL CHECK (type IN ('muse', 'instinct', 'other', 'stand_in')),
  description TEXT NOT NULL DEFAULT '',
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  work_days TEXT NOT NULL DEFAULT '1,2,3,4,5',
  work_start TEXT NOT NULL DEFAULT '08:00',
  work_end TEXT NOT NULL DEFAULT '18:00',
  timezone TEXT NOT NULL DEFAULT 'America/Boise',
  offset_minutes INTEGER NOT NULL DEFAULT 0,
  grace_minutes INTEGER NOT NULL DEFAULT 15,
  clock_speed REAL NOT NULL DEFAULT 1,
  paused_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  first_seen_at TEXT,
  last_seen_at TEXT,
  last_card_at TEXT,
  last_checkin_at TEXT,
  last_checkin_card_id TEXT,
  status TEXT NOT NULL DEFAULT 'gray' CHECK (status IN ('green', 'amber', 'red', 'gray')),
  status_reason TEXT NOT NULL DEFAULT '',
  status_changed_at TEXT
);
CREATE INDEX agents_owner ON agents(owner_id);

CREATE TABLE room_agents (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (room_id, agent_id)
);
CREATE INDEX room_agents_agent ON room_agents(agent_id);

CREATE TABLE agent_keys (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('api', 'page')),
  token_hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX agent_keys_agent ON agent_keys(agent_id, kind);

-- Check-ins ------------------------------------------------------------------

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  door TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'expired', 'superseded')),
  completed_at TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  requirements TEXT NOT NULL,
  since_cutoff TEXT,
  opened_count INTEGER NOT NULL DEFAULT 1,
  incomplete_at TEXT
);
CREATE INDEX cards_agent ON cards(agent_id, issued_at);
CREATE INDEX cards_open ON cards(status, expires_at);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  door TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  body TEXT NOT NULL
);
CREATE INDEX reports_agent ON reports(agent_id, created_at);

CREATE TABLE report_rooms (
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  working_on TEXT NOT NULL,
  finished TEXT NOT NULL DEFAULT '[]',
  notes_for_others TEXT,
  blocked_reason TEXT,
  blocked_unblock TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  feed_seq INTEGER,
  PRIMARY KEY (report_id, room_id)
);
CREATE INDEX report_rooms_room_agent ON report_rooms(room_id, agent_id, created_at);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  asker_kind TEXT NOT NULL CHECK (asker_kind IN ('agent', 'person', 'conductor')),
  asker_id TEXT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('agent', 'people', 'conductor')),
  target_agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  why TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'cancelled')),
  created_at TEXT NOT NULL,
  answer TEXT,
  answered_at TEXT,
  answerer_kind TEXT,
  answerer_id TEXT,
  answer_report_id TEXT,
  source_key TEXT UNIQUE,
  feed_seq INTEGER,
  answer_feed_seq INTEGER
);
CREATE INDEX questions_target ON questions(target_agent_id, status);
CREATE INDEX questions_room ON questions(room_id, status);

CREATE TABLE instructions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  issuer_kind TEXT NOT NULL CHECK (issuer_kind IN ('person', 'conductor')),
  issuer_person_id TEXT REFERENCES people(id),
  text TEXT NOT NULL,
  done_when TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_at TEXT,
  why TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'new', 'acknowledged', 'in_progress', 'blocked', 'done', 'declined', 'cancelled', 'rejected')),
  status_note TEXT,
  proof TEXT,
  created_at TEXT NOT NULL,
  issued_at TEXT,
  updated_at TEXT NOT NULL,
  last_movement_at TEXT NOT NULL,
  conductor_run_id TEXT,
  approved_by TEXT REFERENCES people(id),
  feed_seq INTEGER
);
CREATE INDEX instructions_agent ON instructions(agent_id, status);
CREATE INDEX instructions_room ON instructions(room_id, status);

CREATE TABLE instruction_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instruction_id TEXT NOT NULL REFERENCES instructions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  proof TEXT,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  report_id TEXT,
  at TEXT NOT NULL,
  feed_seq INTEGER
);
CREATE INDEX instruction_events_instruction ON instruction_events(instruction_id, id);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  options TEXT NOT NULL DEFAULT '[]',
  recommendation TEXT,
  why TEXT,
  source TEXT NOT NULL CHECK (source IN ('conductor', 'disagreement', 'declined', 'limits', 'question', 'person')),
  source_ref TEXT,
  source_key TEXT UNIQUE,
  agent_ids TEXT NOT NULL DEFAULT '[]',
  proposed_instruction TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES people(id),
  resolution TEXT,
  resolution_option INTEGER,
  conductor_run_id TEXT,
  feed_seq INTEGER
);
CREATE INDEX decisions_room ON decisions(room_id, status);

CREATE TABLE playbook_entries (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('agent', 'person', 'conductor')),
  author_id TEXT,
  source_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  archived_at TEXT
);
CREATE INDEX playbook_room ON playbook_entries(room_id, archived_at);

-- The timeline. One table drives the feed in the control room, the
-- "since_last_check_in" section of cards, search, export and lookup.
CREATE TABLE feed_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('agent', 'person', 'conductor', 'system')),
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  target_agent_id TEXT,
  thread_id TEXT,
  ref_id TEXT,
  text TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX feed_room_seq ON feed_events(room_id, seq);
CREATE INDEX feed_thread ON feed_events(thread_id);
CREATE INDEX feed_ref ON feed_events(ref_id);

-- Conductor ------------------------------------------------------------------

CREATE TABLE conductor_state (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  pending_run_at TEXT,
  pending_triggers TEXT NOT NULL DEFAULT '[]',
  running_since TEXT,
  last_run_at TEXT,
  last_run_seq INTEGER NOT NULL DEFAULT 0,
  last_sweep_at TEXT,
  last_stale_fingerprint TEXT,
  last_stale_run_at TEXT
);

CREATE TABLE conductor_runs (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  triggers TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'acted', 'nothing_to_do', 'skipped', 'failed')),
  skip_reason TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  saw_summary TEXT,
  output TEXT,
  actions TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX conductor_runs_room ON conductor_runs(room_id, started_at);
CREATE INDEX conductor_runs_started ON conductor_runs(started_at);

-- Alerts, incidents, briefs ----------------------------------------------------

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'red',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  hint TEXT
);
CREATE INDEX incidents_agent ON incidents(agent_id, ended_at);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  agent_id TEXT,
  room_id TEXT,
  incident_id TEXT,
  decision_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  read_at TEXT,
  deliveries TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX alerts_person ON alerts(person_id, created_at);

CREATE TABLE briefs (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  for_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('model', 'rules')),
  text TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  cost_usd REAL NOT NULL DEFAULT 0,
  UNIQUE (room_id, for_date)
);

-- Logs -------------------------------------------------------------------------

CREATE TABLE connection_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  key_hint TEXT,
  at TEXT NOT NULL,
  door TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('ok', 'rejected', 'error')),
  http_status INTEGER,
  message TEXT,
  card_id TEXT,
  duration_ms INTEGER,
  client TEXT
);
CREATE INDEX connection_log_agent ON connection_log(agent_id, id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  room_id TEXT,
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at ON audit_log(at);

-- Scheduled jobs that must run once per period (daily brief, nightly backup).
-- A row is inserted before the job runs; the primary key makes double-firing impossible.
CREATE TABLE job_runs (
  job_key TEXT PRIMARY KEY,
  ran_at TEXT NOT NULL,
  result TEXT
);

CREATE TABLE rehearsals (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  started_by TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'stopped')),
  max_rounds INTEGER NOT NULL,
  log TEXT NOT NULL DEFAULT '[]',
  results TEXT NOT NULL DEFAULT '[]'
);
`,
  },
  {
    id: 2,
    name: 'indexes for alert and decision lookups',
    sql: `
-- The scheduler checks every open decision for an alert on each tick; keep that an index lookup.
CREATE INDEX alerts_decision ON alerts(decision_id);
CREATE INDEX decisions_room_source ON decisions(room_id, source, status);
`,
  },
];
