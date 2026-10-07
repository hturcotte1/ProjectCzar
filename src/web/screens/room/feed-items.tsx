import { Fragment, useState, type ReactNode } from 'react';
import type { FeedEvent } from '../../../shared/app-types';
import { Avatar, Pill, Time } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { fullTime } from '../../lib/format';
import { linkProps } from '../../lib/router';
import { DOOR_WORDS, STATUS_WORDS, type FeedRowModel } from './feed-model';

/**
 * How each kind of feed event looks. Everything written by an agent or a person goes through
 * SafeText (or RichText, which uses it); the rest is plain React text.
 */

export interface ItemEnv {
  roomId: string;
  /** Matches "@Name" for agents, people and the Conductor; null when there are none. */
  mentionRe: RegExp | null;
  /** True when no kind filter or search hides replies, so "waiting for..." lines are truthful. */
  complete: boolean;
  /** True when the "Waiting on you" panel is a tab rather than a side panel. */
  narrow: boolean;
  /** Row keys that just changed. */
  fresh: Set<string>;
}

export function mentionPattern(names: string[]): RegExp | null {
  const list = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!list.length) return null;
  return new RegExp(`@(?:${list.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w])`, 'gi');
}

/** Message text with @mentions picked out. */
function RichText({ text, env }: { text: string | null | undefined; env: ItemEnv }) {
  const value = text ?? '';
  if (!env.mentionRe || !value.includes('@')) return <SafeText text={value} />;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of value.matchAll(env.mentionRe)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(<SafeText key={`t${last}`} text={value.slice(last, at)} />);
    parts.push(
      <span key={`m${at}`} className="feed-mention">
        {m[0]}
      </span>,
    );
    last = at + m[0].length;
  }
  if (last < value.length) parts.push(<SafeText key={`t${last}`} text={value.slice(last)} />);
  return <>{parts}</>;
}

// ------------------------------------------------------------------------------------ the row

export function FeedRowView({ row, env }: { row: FeedRowModel; env: ItemEnv }) {
  const ev = row.root;
  const cls = `feed-row${env.fresh.has(row.key) ? ' feed-fresh' : ''}`;
  if (ev.kind === 'system') {
    return (
      <div className={cls} data-row={row.key}>
        <SystemLine ev={ev} />
      </div>
    );
  }
  return (
    <div className={cls} data-row={row.key}>
      <div className={`feed-item feed-kind-${ev.kind}`}>
        <Avatar name={ev.actor_name} kind={ev.actor_kind} />
        <div className="feed-main">
          <Meta row={row} />
          <Body row={row} env={env} />
        </div>
      </div>
    </div>
  );
}

const SYSTEM_TONE: Record<string, string> = {
  agent_amber: 'amber',
  checkin_incomplete: 'amber',
  agent_red: 'red',
  agent_recovered: 'green',
  room_paused: 'amber',
  room_resumed: 'green',
};

function SystemLine({ ev }: { ev: FeedEvent }) {
  const tone = SYSTEM_TONE[String(ev.data.event ?? '')] ?? 'gray';
  return (
    <div className="feed-item feed-sys">
      <span className="feed-sys-mark" aria-hidden="true">
        <span className={`light light-${tone}`} />
      </span>
      <div className="feed-sys-text">
        <SafeText text={ev.text} /> <Time iso={ev.created_at} className="feed-time" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------ the header line

function Meta({ row }: { row: FeedRowModel }) {
  const ev = row.root;
  const d = ev.data;
  let to: string | null = null;
  let tag: ReactNode = null;
  switch (ev.kind) {
    case 'post':
      to = d.to_name ? `to ${d.to_name}` : 'to everyone';
      break;
    case 'message':
      to = d.to_kind === 'agent' ? `to ${d.to_name}` : d.to_kind === 'conductor' ? 'to the Conductor' : 'to everyone';
      break;
    case 'question':
      to = `asks ${d.to_name ?? 'someone'}`;
      tag = <Pill tone="accent">Question</Pill>;
      break;
    case 'answer':
      to = 'answered';
      break;
    case 'instruction':
      to = `for ${d.to_agent_name ?? 'an agent'}`;
      tag = <Pill tone="accent">Instruction</Pill>;
      break;
    case 'proposal': {
      to = `proposes for ${d.to_agent_name ?? 'an agent'}`;
      const last = [...row.replies].reverse().find((r) => r.kind === 'instruction_status');
      if (row.replies.some((r) => r.kind === 'instruction')) tag = <Pill tone="green">Approved</Pill>;
      else if (last?.data.status === 'rejected') tag = <Pill>Not approved</Pill>;
      else tag = <Pill tone="amber">Waiting for approval</Pill>;
      break;
    }
    case 'instruction_status':
      to = 'updated an instruction';
      break;
    case 'decision':
      tag = <Pill tone="amber">Decision needed</Pill>;
      break;
    case 'decision_resolved':
      to = 'decided';
      break;
    case 'playbook':
      to = 'saved to the playbook';
      tag = <Pill tone="purple">Playbook</Pill>;
      break;
    case 'brief':
      tag = <Pill tone="purple">Daily brief</Pill>;
      break;
    case 'report':
      to = 'checked in';
      break;
  }
  const revised = ev.kind === 'report' && Number(d.revision) > 1;
  return (
    <div className="feed-meta">
      <span className="who">{ev.actor_name}</span>
      {to && <span className="feed-to">{to}</span>}
      <Time iso={ev.created_at} />
      {revised && (
        <span className="feed-updated" title={`Updated ${fullTime(ev.updated_at ?? ev.created_at)}`}>
          updated
        </span>
      )}
      {ev.kind === 'report' && DOOR_WORDS[d.door] && <span className="feed-door">{DOOR_WORDS[d.door]}</span>}
      {row.orphan && ev.thread_id && <span className="feed-re">re: {ev.thread_id}</span>}
      {tag}
      {ev.kind === 'instruction' && <PriorityPill priority={d.priority} />}
      {ev.kind === 'proposal' && <PriorityPill priority={d.priority} />}
    </div>
  );
}

function PriorityPill({ priority }: { priority: string | undefined }) {
  if (priority === 'high') return <Pill tone="red">High priority</Pill>;
  if (priority === 'low') return <Pill>Low priority</Pill>;
  return null;
}

// ------------------------------------------------------------------------------------ bodies

function Body({ row, env }: { row: FeedRowModel; env: ItemEnv }) {
  const ev = row.root;
  const d = ev.data;
  switch (ev.kind) {
    case 'report':
      return <ReportBody ev={ev} env={env} />;
    case 'post':
    case 'message':
      return (
        <div className="feed-body">
          <RichText text={d.text ?? ev.text} env={env} />
        </div>
      );
    case 'question':
      return (
        <>
          <div className="feed-body">
            <RichText text={d.text ?? ev.text} env={env} />
          </div>
          {d.why && (
            <div className="feed-sub">
              Why: <SafeText text={d.why} />
            </div>
          )}
          <QuestionThread row={row} env={env} />
        </>
      );
    case 'answer':
      return (
        <>
          {d.question && (
            <div className="feed-sub">
              Question: <SafeText text={d.question} />
            </div>
          )}
          <div className="feed-body">
            <RichText text={d.answer ?? ev.text} env={env} />
          </div>
        </>
      );
    case 'instruction':
    case 'proposal':
      return (
        <>
          <InstructionBody ev={ev} env={env} />
          <InstructionThread row={row} env={env} />
        </>
      );
    case 'instruction_status':
      return (
        <div className="feed-body">
          {d.status && <StatusStep status={d.status} />} <SafeText text={ev.text} />
        </div>
      );
    case 'decision':
      return (
        <>
          <DecisionBody ev={ev} />
          <DecisionThread row={row} env={env} />
        </>
      );
    case 'decision_resolved':
      return (
        <div className="feed-body">
          {d.title && <span className="feed-title">{d.title}</span>}
          <div className="feed-resolution">
            Decided: <SafeText text={d.resolution ?? ev.text} />
          </div>
        </div>
      );
    case 'conductor_note':
      return (
        <div className="feed-body">
          <RichText text={d.text ?? ev.text} env={env} />
        </div>
      );
    case 'playbook':
      return (
        <div className="feed-body">
          <div className="feed-title">
            <SafeText text={d.title ?? ev.text} />
          </div>
          {d.body && (
            <Clamp text={d.body}>
              <SafeText text={d.body} />
            </Clamp>
          )}
        </div>
      );
    case 'brief':
      return (
        <div className="feed-body">
          <Clamp text={d.text ?? ev.text}>
            <RichText text={d.text ?? ev.text} env={env} />
          </Clamp>
        </div>
      );
    default:
      return (
        <div className="feed-body">
          <SafeText text={ev.text} />
        </div>
      );
  }
}

/** Long text is cut to a few lines with a button to read the rest. */
function Clamp({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 380 || text.split('\n').length > 6;
  if (!long) return <>{children}</>;
  return (
    <>
      <div className={open ? undefined : 'feed-clamp'}>{children}</div>
      <button type="button" className="feed-link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Show less' : 'Show more'}
      </button>
    </>
  );
}

// ------------------------------------------------------------------------------------ reports

interface Finished {
  what?: string;
  proof?: string;
}

function ReportBody({ ev, env }: { ev: FeedEvent; env: ItemEnv }) {
  const d = ev.data;
  const finished = (Array.isArray(d.finished) ? d.finished : []) as Finished[];
  const disagreements = (Array.isArray(d.disagreements) ? d.disagreements : []) as { with?: string; about?: string; my_view?: string }[];
  return (
    <div className="feed-report">
      <div className="feed-working">
        <span className="feed-label">Working on</span> <RichText text={d.working_on ?? ev.text} env={env} />
      </div>
      {finished.length > 0 && (
        <div>
          <span className="feed-label">Finished</span>
          <ul className="feed-list">
            {finished.map((f, i) => (
              <li key={i}>
                <span className="feed-tick" aria-hidden="true">
                  ✓
                </span>
                <span>
                  <SafeText text={f.what} />
                  {f.proof && (
                    <span className="feed-proof">
                      {' '}
                      Proof: <SafeText text={f.proof} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.notes_for_others && (
        <div className="feed-note">
          <span className="feed-label">Note for others</span> <RichText text={d.notes_for_others} env={env} />
        </div>
      )}
      {d.blocked?.reason && (
        <div className="feed-blocked">
          <strong>Blocked</strong> <SafeText text={d.blocked.reason} />
          {d.blocked.what_would_unblock && (
            <div className="small">
              What would unblock it: <SafeText text={d.blocked.what_would_unblock} />
            </div>
          )}
        </div>
      )}
      {disagreements.map((x, i) => (
        <div key={i} className="feed-disagree">
          <strong>Disagrees</strong>
          {x.with ? ` with ${x.with}` : ''} about <SafeText text={x.about} />
          {x.my_view && (
            <>
              : <SafeText text={x.my_view} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------ questions

function Reply({ head, time, children, tone }: { head: ReactNode; time?: string | null; children?: ReactNode; tone?: 'green' | 'red' | 'amber' }) {
  return (
    <div className={`feed-reply${tone ? ` feed-reply-${tone}` : ''}`}>
      <div className="feed-reply-head">
        {head} {time && <Time iso={time} className="feed-time" />}
      </div>
      {children}
    </div>
  );
}

function QuestionThread({ row, env }: { row: FeedRowModel; env: ItemEnv }) {
  const answers = row.replies.filter((r) => r.kind === 'answer');
  if (!answers.length && !env.complete) return null;
  return (
    <div className="thread">
      {answers.map((a) => (
        <Reply key={a.seq} tone="green" head={<strong>Answered by {a.actor_name}</strong>} time={a.created_at}>
          <div className="feed-body">
            <RichText text={a.data.answer ?? a.text} env={env} />
          </div>
        </Reply>
      ))}
      {!answers.length && <div className="feed-pending">Waiting for an answer</div>}
    </div>
  );
}

// ------------------------------------------------------------------------------------ instructions

function InstructionBody({ ev, env }: { ev: FeedEvent; env: ItemEnv }) {
  const d = ev.data;
  return (
    <>
      <div className="feed-body">
        <RichText text={d.text ?? ev.text} env={env} />
      </div>
      {d.done_when && (
        <div className="feed-sub">
          <span className="feed-label">Done when</span> <SafeText text={d.done_when} />
        </div>
      )}
      {d.due_at && (
        <div className="feed-sub">
          <span className="feed-label">Due</span> <Time iso={d.due_at} />
        </div>
      )}
      {d.why && (
        <div className="feed-sub">
          Why: <SafeText text={d.why} />
        </div>
      )}
    </>
  );
}

function StatusStep({ status }: { status: string }) {
  return <span className={`feed-step feed-step-${status}`}>{STATUS_WORDS[status] ?? status}</span>;
}

function InstructionThread({ row, env }: { row: FeedRowModel; env: ItemEnv }) {
  const ev = row.root;
  const steps = row.replies.filter((r) => r.kind === 'instruction_status');
  const approval = row.replies.find((r) => r.kind === 'instruction');
  const agent = ev.data.to_agent_name ?? 'the agent';
  const waitingForApproval = ev.kind === 'proposal' && !approval && steps.length === 0;
  if (!steps.length && !approval && !env.complete) return null;

  // "acknowledged → in progress → done", with repeats of the same status folded together.
  const trail = steps.filter((s, i) => i === 0 || steps[i - 1].data.status !== s.data.status);
  const details = steps.filter((s) => s.data.note || s.data.proof);
  const last = steps[steps.length - 1];
  return (
    <div className="thread">
      {approval && (
        <Reply head={<strong>Approved by {approval.data.approved_by ?? approval.actor_name}</strong>} time={approval.created_at} tone="green">
          <div className="feed-sub">Now on {agent}'s card.</div>
        </Reply>
      )}
      {waitingForApproval && <div className="feed-pending">Waiting for a person to approve this</div>}
      {steps.length === 0 && !waitingForApproval && !approval && <div className="feed-pending">Waiting for {agent} to pick this up</div>}
      {trail.length > 0 && (
        <div className="feed-trail" aria-label="Status so far">
          {trail.map((s, i) => (
            <Fragment key={s.seq}>
              {i > 0 && (
                <span className="feed-arrow" aria-hidden="true">
                  →
                </span>
              )}
              <StatusStep status={s.data.status} />
            </Fragment>
          ))}
          {last && <Time iso={last.created_at} className="feed-time" />}
        </div>
      )}
      {details.map((s) => (
        <div key={s.seq} className="feed-detail">
          {s.data.note && (
            <div>
              {trail.length > 1 && <span className="feed-label">{STATUS_WORDS[s.data.status] ?? s.data.status}</span>}
              <SafeText text={s.data.note} />{' '}
              <span className="feed-time">
                {s.actor_name}, <Time iso={s.created_at} />
              </span>
            </div>
          )}
          {s.data.proof && (
            <div className="feed-proof">
              {!s.data.note && trail.length > 1 && <span className="feed-label">{STATUS_WORDS[s.data.status] ?? s.data.status}</span>}
              Proof: <SafeText text={s.data.proof} />
              {!s.data.note && (
                <>
                  {' '}
                  <span className="feed-time">
                    {s.actor_name}, <Time iso={s.created_at} />
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------ decisions

function DecisionBody({ ev }: { ev: FeedEvent }) {
  const d = ev.data;
  const options = (Array.isArray(d.options) ? d.options : []) as string[];
  return (
    <div className="feed-decision">
      <div className="feed-title">
        <SafeText text={d.title ?? ev.text} />
      </div>
      {d.context && (
        <div className="feed-sub">
          <SafeText text={d.context} />
        </div>
      )}
      {options.length > 0 && (
        <ul className="feed-options" aria-label="Options">
          {options.map((o, i) => (
            <li key={i} className={`feed-option${d.resolution === o ? ' feed-option-chosen' : ''}`}>
              {o}
            </li>
          ))}
        </ul>
      )}
      {d.recommendation && (
        <div className="feed-sub">
          <span className="feed-label">Suggested</span> <SafeText text={d.recommendation} />
          {d.why && (
            <>
              {' '}
              (<SafeText text={d.why} />)
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DecisionThread({ row, env }: { row: FeedRowModel; env: ItemEnv }) {
  const ev = row.root;
  const resolved = row.replies.filter((r) => r.kind === 'decision_resolved');
  // A person approved something that could no longer go out: Tempo says why, under its own heading.
  const notSent = row.replies.filter((r) => r.kind === 'system' && r.data.event === 'held_not_applied');
  const dismissed = row.replies.filter((r) => r.kind === 'system' && r.data.event !== 'held_not_applied');
  const resolvedInRoot = ev.data.status === 'resolved' && resolved.length === 0 ? ev.data.resolution : null;
  const open = !resolved.length && !dismissed.length && !resolvedInRoot;
  if (open && !env.complete) return null;
  return (
    <div className="thread">
      {resolved.map((r) => (
        <Reply key={r.seq} tone="green" head={<strong>Decided by {r.actor_name}</strong>} time={r.created_at}>
          <div className="feed-body">
            <SafeText text={r.data.resolution ?? r.text} />
          </div>
        </Reply>
      ))}
      {resolvedInRoot && (
        <Reply tone="green" head={<strong>Decided</strong>}>
          <div className="feed-body">
            <SafeText text={resolvedInRoot} />
          </div>
        </Reply>
      )}
      {notSent.map((r) => (
        <Reply key={r.seq} tone="amber" head={<strong>Not sent</strong>} time={r.created_at}>
          <div className="feed-sub">
            <SafeText text={r.text} />
          </div>
        </Reply>
      ))}
      {dismissed.map((r) => (
        <Reply key={r.seq} head={<strong>Dismissed</strong>} time={r.created_at}>
          <div className="feed-sub">
            <SafeText text={r.text} />
          </div>
        </Reply>
      ))}
      {open && (
        <div className="feed-pending">
          Waiting for a decision
          {env.narrow && (
            <>
              {' · '}
              <a {...linkProps(`/rooms/${env.roomId}/decisions`)}>Decide</a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
