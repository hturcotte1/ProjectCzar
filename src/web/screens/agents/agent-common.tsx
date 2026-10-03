import type { AgentType, AgentView, RoomSummary } from '../../../shared/app-types';
import { Pill } from '../../components/ui';

/** What each kind of agent is, in one plain line. Stand-ins are for rehearsals only and never offered. */
export const TYPE_CHOICES: { value: Exclude<AgentType, 'stand_in'>; label: string; blurb: string }[] = [
  { value: 'muse', label: 'Muse', blurb: "Meta's Muse. It checks in by itself on a schedule, once you have connected it." },
  { value: 'instinct', label: 'Instinct', blurb: 'Instinct checks in when you text it. It opens a private web page and fills in the report.' },
  { value: 'other', label: 'Other', blurb: 'Any other AI assistant that can use connected tools and run a repeating task.' },
];

export function typeLabel(t: AgentType): string {
  if (t === 'stand_in') return 'Rehearsal stand-in';
  return TYPE_CHOICES.find((c) => c.value === t)?.label ?? t;
}

/** "Muse", "Instinct", or "your agent" for the sentences that talk about the agent. */
export function typeNoun(t: AgentType): string {
  return t === 'muse' ? 'Muse' : t === 'instinct' ? 'Instinct' : 'your agent';
}

export function TypePill({ type }: { type: AgentType }) {
  return <Pill tone={type === 'muse' ? 'purple' : type === 'instinct' ? 'accent' : undefined}>{typeLabel(type)}</Pill>;
}

/** "Launch, Ops" for the rooms this person can see, plus a count for any they can't. */
export function roomNames(agent: AgentView, rooms: RoomSummary[]): string {
  const known = agent.room_ids.map((id) => rooms.find((r) => r.id === id)?.name).filter((n): n is string => !!n);
  const hidden = agent.room_ids.length - known.length;
  const parts = [...known];
  if (hidden > 0) parts.push(hidden === 1 ? '1 other room' : `${hidden} other rooms`);
  return parts.length ? parts.join(', ') : 'No rooms yet';
}

export function roomCount(n: number): string {
  return n === 0 ? 'No rooms' : n === 1 ? '1 room' : `${n} rooms`;
}
