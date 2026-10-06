import { useEffect, useState } from 'react';
import type { ConductorMode, ConductorRunView, ConductorSummary, RoomDetail } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { DAY_NAMES, fullTime, money, relative } from '../../lib/format';
import { useAction } from '../../components/ui';
import './room-c.css';

/** Words and small pieces shared by the Conductor panel, the log, the playbook, briefs, health and settings. */

export const MODE_WORDS: Record<ConductorMode, { name: string; explain: string }> = {
  autonomous: {
    name: 'Autonomous',
    explain: 'Its instructions go to agents straight away. Anything that needs your approval still waits for you.',
  },
  propose: {
    name: 'Propose',
    explain: 'Every instruction waits for your one-tap approval first. You can edit or reject it.',
  },
  relay: {
    name: 'Relay',
    explain: 'It starts no work of its own. It passes on your instructions, points out overlap and conflicts, and asks questions.',
  },
};

/** "Relay (no API key)" when the room is forced into relay; otherwise null. */
export function forcedModeLabel(c: ConductorSummary): string | null {
  if (c.effective_mode === c.mode) return null;
  const why = !c.has_key && !c.scripted ? 'no API key' : 'budget used up';
  return `${MODE_WORDS[c.effective_mode].name} (${why})`;
}

/** What woke the Conductor, in plain words. */
export const TRIGGER_WORDS: Record<string, string> = {
  checkin: 'An agent checked in',
  person_instruction: 'A person gave an instruction',
  person_message: 'A person wrote a message',
  goal_changed: 'The goal changed',
  decision_resolved: 'A decision was made',
  sweep: 'Routine check for things left waiting',
  manual: 'Someone pressed Run now',
  mode_changed: 'The mode changed',
  question_for_conductor: 'A question for the Conductor',
};

/** What the Conductor did, as a short label in front of the action text. */
export const ACTION_WORDS: Record<string, string> = {
  instruction: 'Instruction',
  proposal: 'Proposed',
  decision: 'Decision',
  question: 'Question',
  cancel: 'Cancelled',
  reword: 'Reworded',
  answer: 'Answer',
  note: 'Note',
  playbook: 'Lesson',
  skipped: 'Not applied',
};

export const STATUS_WORDS: Record<ConductorRunView['status'], { label: string; tone: 'green' | 'amber' | 'red' | 'accent' | undefined }> = {
  acted: { label: 'Acted', tone: 'green' },
  nothing_to_do: { label: 'Nothing to do', tone: undefined },
  skipped: { label: 'Skipped', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
  running: { label: 'Running', tone: 'accent' },
};

const ID_WORDS: Record<string, [string, string]> = {
  ins: ['an instruction', 'instructions'],
  card: ['a check-in', 'check-ins'],
  dec: ['a decision', 'decisions'],
  q: ['a question', 'questions'],
  evt: ['a message', 'messages'],
  run: ['a run', 'runs'],
  brf: ['a brief', 'briefs'],
};

/** Turns internal ids ("ins_12", "card_7") in a sentence into plain words ("an instruction"). */
export function plainIds(text: string): string {
  const prefixes = Object.keys(ID_WORDS).join('|');
  let out = text.replace(new RegExp(`\\s*\\((?:${prefixes})_\\d+\\)`, 'g'), '');
  out = out.replace(new RegExp(`\\b(${prefixes})_\\d+\\b`, 'g'), (_m, p: string) => ID_WORDS[p][0]);
  // "an instruction, an instruction" becomes "2 instructions".
  for (const [one, many] of Object.values(ID_WORDS)) {
    out = out.replace(new RegExp(`\\b${one}(?:,?\\s*(?:and\\s+)?${one})+`, 'g'), (m) => `${m.split(one).length - 1} ${many}`);
  }
  return out.trim();
}

/** "under $0.01", "$0.02", "$12" */
export function cost(usd: number): string {
  if (!usd) return 'no cost';
  if (usd < 0.005) return 'under $0.01';
  return money(usd);
}

/** "October 24" from "2026-10-24". */
export function dayWords(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** Where the month is heading: "About $4.80 by month end at this pace", or when the budget runs out. */
export function projectionText(c: ConductorSummary): string | null {
  if (c.budget_runs_out_on) return `At this pace the budget runs out around ${dayWords(c.budget_runs_out_on)}`;
  if (c.month_projected_usd === null) return null;
  return `About ${spentText(c.month_projected_usd)} by month end at this pace`;
}

/** "$0.04 a run on average (23 runs)". */
export function averageText(c: ConductorSummary): string | null {
  if (c.month_avg_run_usd === null) return null;
  return `${spentText(c.month_avg_run_usd)} a run on average (${c.month_paid_runs} ${c.month_paid_runs === 1 ? 'run' : 'runs'})`;
}

/** Month-to-date spend: "$0.00", "under $0.01", "$0.42", "$12". */
export function spentText(usd: number): string {
  return usd > 0 && usd < 0.005 ? cost(usd) : money(usd);
}

export function sentence(text: string): string {
  const t = text.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** "07:30" becomes "7:30 am". */
export function clock12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

/** [1,2,3,4,5] becomes "Monday to Friday"; other sets are listed. */
export function daysText(days: number[]): string {
  const d = [...days].sort((a, b) => a - b);
  if (d.length === 7) return 'every day';
  if (d.length > 2 && d.every((x, i) => x === d[0] + i)) return `${DAY_NAMES[d[0] - 1]} to ${DAY_NAMES[d[d.length - 1] - 1]}`;
  return d.map((x) => DAY_NAMES[x - 1]).join(', ');
}

/** "in 12 min" / "5 min ago", refreshed every 30 seconds, with the full date on hover. */
export function RelativeTime({ iso }: { iso: string | null | undefined }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!iso) return null;
  return (
    <time dateTime={iso} title={fullTime(iso)}>
      {relative(iso)}
    </time>
  );
}

/** When the next run starts. A start time that has passed means it is about to go. */
export function NextRun({ iso }: { iso: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 15_000);
    return () => window.clearInterval(t);
  }, []);
  if (new Date(iso).getTime() <= Date.now()) return <span>any moment now</span>;
  return <RelativeTime iso={iso} />;
}

/** A thin bar showing how much of the monthly budget is used. */
export function SpendBar({ spent, budget, large }: { spent: number; budget: number; large?: boolean }) {
  const share = budget > 0 ? Math.min(1, spent / budget) : 0;
  const shown = spent > 0 ? Math.max(share, 0.015) : 0;
  const level = share >= 1 ? 'over' : share >= 0.8 ? 'warn' : 'ok';
  return (
    <div
      className={`c-bar${large ? ' c-bar-lg' : ''}`}
      data-level={level}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      aria-label="Share of this month's budget used"
    >
      <span style={{ width: `${shown * 100}%` }} />
    </div>
  );
}

/** "Run now": asks the Conductor to look at the room straight away. */
export function RunNowButton({ detail, onChanged }: { detail: RoomDetail; onChanged: () => void }) {
  const { busy, run } = useAction();
  const paused = detail.room.paused;
  return (
    <div className="stack-sm">
      <div>
        <button
          type="button"
          className="btn"
          disabled={busy || paused}
          onClick={() =>
            run(async () => {
              await api.post(`/rooms/${detail.room.id}/conductor/run`, {});
              onChanged();
            }, 'Asked the Conductor to run. It will show up in the log in a moment.')
          }
        >
          {busy ? 'Asking…' : 'Run now'}
        </button>
      </div>
      {paused && <p className="small muted" style={{ margin: 0 }}>The room is paused. Resume it to run the Conductor.</p>}
    </div>
  );
}
