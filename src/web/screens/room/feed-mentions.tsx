import type { AgentView } from '../../../shared/app-types';

/** @mentions in the composer: finding the one being typed, suggesting names, spotting finished ones. */

export interface MentionState {
  /** Index of the "@" in the text. */
  start: number;
  /** What was typed after it. */
  query: string;
}

/** The "@name" being typed right at the caret, if any. */
export function findMention(text: string, caret: number): MentionState | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null; // part of an email address, not a mention
  const query = before.slice(at + 1);
  if (query.length > 30 || /[\n@]/.test(query)) return null;
  return { start: at, query };
}

export interface MentionOption {
  name: string;
  note: string;
}

/** Agents (and the Conductor) whose name contains what was typed, names that start with it first. */
export function mentionOptions(agents: AgentView[], query: string): MentionOption[] {
  const q = query.toLowerCase();
  const all: MentionOption[] = [...agents.map((a) => ({ name: a.name, note: 'agent' })), { name: 'Conductor', note: 'the room’s assistant' }];
  const starts = all.filter((o) => o.name.toLowerCase().startsWith(q));
  const contains = all.filter((o) => !o.name.toLowerCase().startsWith(q) && o.name.toLowerCase().includes(q));
  return [...starts, ...contains];
}

/** Agents named with "@" in the text (a whole name, so "@Muse Sam" is not "@Muse Samuel"). */
export function mentionedAgents(text: string, agents: AgentView[]): AgentView[] {
  if (!text.includes('@')) return [];
  return agents.filter((a) => new RegExp(`@${a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i').test(text));
}

export function MentionList({
  id,
  options,
  active,
  onPick,
  onHover,
}: {
  id: string;
  options: MentionOption[];
  active: number;
  onPick: (o: MentionOption) => void;
  onHover: (i: number) => void;
}) {
  return (
    <ul className="cmp-mentions" id={id} role="listbox" aria-label="Mention someone">
      {options.map((o, i) => (
        <li
          key={o.name}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === active}
          className="cmp-mention"
          // keep the cursor in the text box while picking
          onMouseDown={(e) => e.preventDefault()}
          onMouseMove={() => onHover(i)}
          onClick={() => onPick(o)}
        >
          <strong>@{o.name}</strong> <small>{o.note}</small>
        </li>
      ))}
    </ul>
  );
}
