import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from 'react';
import type { AgentView, RoomDetail } from '../../../shared/app-types';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui';
import { FEED_JUMP_EVENT } from './feed-model';
import { notSentText } from './composer-words';
import { MentionList, findMention, mentionOptions, mentionedAgents, type MentionOption } from './feed-mentions';
import './feed.css';

/**
 * Where people write to the room: a note for everyone, a question, or an instruction for one agent
 * (or for every agent). Type "@" to mention an agent. Ctrl or Cmd + Enter sends.
 *
 * It sits as one line under the feed until someone taps or tabs into it; then To, Type and the rest
 * open. It folds back to one line when focus leaves it with nothing written or chosen. It is never
 * folded while it shows a problem (a send that failed), so the problem line is always visible.
 */

type Kind = 'note' | 'question' | 'instruction';

interface Draft {
  text: string;
  kind: Kind;
  /** "room", "conductor" or an agent id. */
  to: string;
  /** The person picked "To" themselves, so an @mention no longer changes it. */
  toManual: boolean;
  doneWhen: string;
  priority: 'low' | 'normal' | 'high';
  /** Value of a datetime-local input (the viewer's own time). */
  due: string;
}

const EMPTY: Draft = { text: '', kind: 'note', to: 'room', toManual: false, doneWhen: '', priority: 'normal', due: '' };

/** Nothing written and nothing chosen: safe to fold the composer back to one line. */
function isBlank(d: Draft): boolean {
  return !d.text.trim() && !d.doneWhen.trim() && d.kind === 'note' && d.to === 'room' && d.priority === 'normal' && !d.due;
}
const MAX_TEXT = 2000;

/** Unsent drafts survive switching tabs inside the room (the composer unmounts). */
const drafts = new Map<string, Draft>();

const KIND_WORDS: Record<Kind, string> = { note: 'Note', question: 'Question', instruction: 'Instruction' };
const PLACEHOLDERS: Record<Kind, string> = {
  note: 'Write a note to the room. Type @ to mention an agent.',
  question: 'Ask a question. Type @ to pick who it is for.',
  instruction: 'What should the agent do? Type @ to pick the agent.',
};

function hint(kind: Kind, to: string, toAgent: AgentView | undefined, agentCount: number, viaMention: boolean): string {
  const name = toAgent?.name;
  const why = viaMention ? ` (sent to ${name} because you mentioned them)` : '';
  if (kind === 'instruction') {
    if (toAgent) return `${name} will see this instruction on its next card, with your name on it.${why}`;
    if (agentCount === 0) return 'There are no agents in this room yet, so there is nobody to instruct.';
    return `This creates one instruction for each of the ${agentCount} agents in the room. Pick one agent to send it to just them.`;
  }
  if (kind === 'question') {
    if (to === 'conductor') return 'The Conductor will read and answer this on its next run.';
    if (toAgent) return `${name} will see this question on its next card. The answer appears in the feed.${why}`;
    if (agentCount === 0) return 'There are no agents in this room yet to ask.';
    return `Every agent in the room (${agentCount}) gets this question on its next card. Answers appear in the feed.`;
  }
  if (to === 'conductor') return 'The Conductor will read this on its next run.';
  if (toAgent) return `${name} will see this note on its next card. Everyone in the room can read it.`;
  return 'Everyone in the room sees this note, and agents read it on their next card.';
}

export function Composer({ detail }: { detail: RoomDetail }) {
  const roomId = detail.room.id;
  const agents = detail.agents;
  const toast = useToast();
  const [draft, setDraftState] = useState<Draft>(() => drafts.get(roomId) ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [more, setMore] = useState(() => (drafts.get(roomId)?.priority ?? 'normal') !== 'normal' || !!drafts.get(roomId)?.due);
  const [open, setOpen] = useState(() => !isBlank(drafts.get(roomId) ?? EMPTY));
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  // Unfolded while it shows a problem, whatever happened to focus.
  const unfolded = open || !!error;

  const setDraft = (patch: Partial<Draft>) =>
    setDraftState((d) => {
      const next = { ...d, ...patch };
      drafts.set(roomId, next);
      return next;
    });

  useEffect(() => {
    setDraftState(drafts.get(roomId) ?? EMPTY);
    setOpen(!isBlank(drafts.get(roomId) ?? EMPTY));
    setError(null);
  }, [roomId]);

  // ---------------------------------------------------------------- who it goes to

  const mentioned = useMemo(() => mentionedAgents(draft.text, agents), [draft.text, agents]);
  // Mentioning exactly one agent in a question or instruction sends it to that agent.
  const autoTarget = !draft.toManual && draft.kind !== 'note' && draft.to === 'room' && mentioned.length === 1 ? mentioned[0] : null;
  const known = draft.to === 'room' || draft.to === 'conductor' || agents.some((a) => a.id === draft.to);
  const to = autoTarget ? autoTarget.id : known ? draft.to : 'room';
  const toAgent = agents.find((a) => a.id === to);
  const kind: Kind = to === 'conductor' && draft.kind === 'instruction' ? 'note' : draft.kind;
  const nobody = kind !== 'note' && to === 'room' && agents.length === 0;

  // ---------------------------------------------------------------- @mention suggestions

  const found = findMention(draft.text, caret);
  const mention = found && found.start !== dismissed ? found : null;
  const options = mention ? mentionOptions(agents, mention.query) : [];
  const listOpen = options.length > 0;
  const shown = Math.min(active, Math.max(options.length - 1, 0));
  useEffect(() => setActive(0), [mention?.query]);

  const pick = (opt: MentionOption) => {
    if (!mention) return;
    const before = draft.text.slice(0, mention.start);
    const after = draft.text.slice(caret);
    const insert = `@${opt.name}${/^\s/.test(after) ? '' : ' '}`;
    pendingCaret.current = before.length + insert.length + (/^\s/.test(after) ? 1 : 0);
    setDraft({ text: before + insert + after });
    setDismissed(null);
  };

  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    if (pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCaret(pendingCaret.current);
      pendingCaret.current = null;
    }
    // grow with the text, up to the height set in CSS
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 200)}px`;
  }, [draft.text, kind, unfolded]);

  // ---------------------------------------------------------------- sending

  const canSend = !busy && draft.text.trim().length > 0 && !nobody;
  const optionsSet = draft.priority !== 'normal' || !!draft.due;
  const optionsSummary = optionsSet ? `${draft.priority === 'normal' ? 'Normal' : draft.priority === 'high' ? 'High' : 'Low'} priority${draft.due ? `, due ${draft.due.replace('T', ' ')}` : ''}` : 'Priority and due date';
  const duePast = kind === 'instruction' && !!draft.due && new Date(draft.due).getTime() < Date.now();

  async function send() {
    if (!canSend) return;
    const body: Record<string, unknown> = { kind, to, text: draft.text.trim() };
    if (kind === 'instruction') {
      body.done_when = draft.doneWhen.trim();
      body.priority = draft.priority;
      if (draft.due) {
        const when = new Date(draft.due);
        if (Number.isNaN(when.getTime())) return setError('That due date and time is not valid. Pick it again or clear it.');
        body.due_at = when.toISOString();
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ message: string }>(`/rooms/${roomId}/messages`, body);
      toast(res.message);
      setDraft({ text: '', doneWhen: '', due: '', priority: 'normal' });
      window.dispatchEvent(new Event(FEED_JUMP_EVENT));
      taRef.current?.focus();
    } catch (e) {
      // Nothing re-sends it: the message stays in the box, and the words say so.
      setError(notSentText(e));
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (listOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((shown + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
        return;
      }
      if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(options[shown]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(mention!.start);
        return;
      }
    }
    // Escape with nothing written folds the composer back to one line.
    if (e.key === 'Escape' && unfolded && isBlank(draft)) {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Fold back to one line when focus leaves the composer and nothing was written or chosen.
  const onFormBlur = (e: FocusEvent<HTMLFormElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    if (isBlank(draft) && !error && !busy) setOpen(false);
  };

  // Ctrl or Cmd + Enter sends from anywhere in the composer.
  const onFormKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void send();
  };

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const listId = 'cmp-mention-list';

  return (
    <form
      className={`composer${unfolded ? '' : ' composer-folded'}`}
      onSubmit={onSubmit}
      onKeyDown={onFormKeyDown}
      onFocus={() => setOpen(true)}
      onBlur={onFormBlur}
      aria-label="Write to the room"
    >
      {unfolded && detail.room.paused && <div className="cmp-paused">This room is paused. Agents won't act on anything until it is resumed, but you can still write.</div>}

      {unfolded && (
        <div className="cmp-row">
          <div className="cmp-pick">
            <label htmlFor="cmp-to">To</label>
            <select
              id="cmp-to"
              className="select"
              value={to}
              onChange={(e) => {
                const v = e.target.value;
                setDraft({ to: v, toManual: true, kind: v === 'conductor' && draft.kind === 'instruction' ? 'note' : draft.kind });
              }}
            >
              <option value="room">Whole room</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="conductor">The Conductor</option>
            </select>
          </div>
          <div className="cmp-pick">
            <label htmlFor="cmp-kind">Type</label>
            <select id="cmp-kind" className="select" value={kind} onChange={(e) => setDraft({ kind: e.target.value as Kind })}>
              {(Object.keys(KIND_WORDS) as Kind[]).map((k) => (
                <option key={k} value={k} disabled={k === 'instruction' && to === 'conductor'}>
                  {KIND_WORDS[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {unfolded && kind === 'instruction' && (
        <div className="cmp-extra">
          <div className="cmp-inline cmp-done">
            <label htmlFor="cmp-done">Done when</label>
            <input
              id="cmp-done"
              className="input"
              value={draft.doneWhen}
              maxLength={500}
              placeholder="How will you know it is finished?"
              onChange={(e) => setDraft({ doneWhen: e.target.value })}
              onKeyDown={(e) => {
                // Enter here must not send by accident (the form would submit)
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) e.preventDefault();
              }}
            />
            <button type="button" className="btn btn-sm cmp-more" aria-expanded={more} aria-controls="cmp-options" onClick={() => setMore(!more)} title={optionsSummary}>
              Options
              {optionsSet && <span className="cmp-dot" aria-label="set" />}
            </button>
          </div>
          {more && (
            <div id="cmp-options" className="cmp-options">
              <div className="cmp-inline">
                <label htmlFor="cmp-priority">Priority</label>
                <select id="cmp-priority" className="select" value={draft.priority} onChange={(e) => setDraft({ priority: e.target.value as Draft['priority'] })}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="cmp-inline">
                <label htmlFor="cmp-due">Due</label>
                <input id="cmp-due" className="input" type="datetime-local" value={draft.due} onChange={(e) => setDraft({ due: e.target.value })} />
              </div>
              {duePast && <div className="cmp-hint">That time has already passed.</div>}
            </div>
          )}
          {!draft.doneWhen.trim() && <div className="cmp-hint cmp-tip">A clear finish line helps the agent know when to stop and what proof to bring back.</div>}
        </div>
      )}

      <div className="cmp-field">
        {listOpen && <MentionList id={listId} options={options} active={shown} onPick={pick} onHover={setActive} />}
        <label htmlFor="cmp-text" className="sr-only">
          Your message
        </label>
        <textarea
          id="cmp-text"
          ref={taRef}
          className="textarea"
          rows={unfolded ? 2 : 1}
          value={draft.text}
          maxLength={MAX_TEXT}
          placeholder={unfolded ? PLACEHOLDERS[kind] : 'Write to the room…'}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setDraft({ text: e.target.value });
            setCaret(e.target.selectionStart);
            setError(null);
            if (!findMention(e.target.value, e.target.selectionStart)) setDismissed(null);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-activedescendant={listOpen ? `${listId}-${shown}` : undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
        />
      </div>

      {error && (
        <div className="banner banner-error cmp-error" role="alert">
          {error}
        </div>
      )}

      <div className="cmp-foot">
        {unfolded && (
          <div className="cmp-hint" aria-live="polite">
            {hint(kind, to, toAgent, agents.length, !!autoTarget)}
            {draft.text.length > MAX_TEXT - 300 && <span className="cmp-count"> {draft.text.length.toLocaleString()} of {MAX_TEXT.toLocaleString()} characters.</span>}
          </div>
        )}
        <div className="cmp-send">
          <button type="submit" className="btn btn-primary" disabled={!canSend}>
            {busy ? 'Sending…' : 'Send'}
          </button>
          <span className="cmp-keys">{isMac ? '⌘' : 'Ctrl'}+Enter</span>
        </div>
      </div>
    </form>
  );
}
