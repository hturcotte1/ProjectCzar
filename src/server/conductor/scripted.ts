import type { ConductorModel, ModelCallResult } from './model.js';
import type { ConductorOutputT } from './schema.js';
import type { StructuredRoom } from './prompt.js';
import { limitConcern } from '../services/limits.js';

/**
 * A rules-based stand-in for the Conductor, used ONLY in sandbox (rehearsal) rooms when there is
 * no Anthropic API key, so a rehearsal can still show the whole loop. It is labeled "scripted" in
 * the log, costs nothing, and does simple, predictable things:
 *  - two agents reporting overlapping work: redirect one and tell it why;
 *  - an agent with nothing to do: a small step toward the goal;
 *  - an agent asking for something outside the limits: an instruction flagged for approval
 *    (which Tempo turns into a decision);
 *  - a blocked agent: ask another agent to help unblock it;
 *  - questions to the Conductor: say it doesn't know and leave them for people.
 */

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'working', 'on', 'now', 'our', 'are', 'its', 'their', 'draft', 'drafting', 'writing', 'section', 'page']);

function words(s: string | null): Set<string> {
  return new Set(
    (s ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

function overlap(a: string | null, b: string | null): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

function empty(summary: string, nothing = true): ConductorOutputT {
  return { summary, nothing_to_do: nothing, instructions: [], questions: [], instruction_changes: [], decisions: [], answers: [], room_note: null, playbook_suggestions: [] };
}

export function scriptedDecide(s: StructuredRoom): ConductorOutputT {
  const mode = s.room.mode;
  const out = empty('Scripted Conductor (rehearsal stand-in): checked the room.', false);
  const notes: string[] = [];
  const active = s.agents.filter((a) => !a.paused && !a.status.startsWith('red'));
  const openFor = (name: string) => s.open_instructions.filter((i) => i.agent === name);
  const askFirst = s.room.limits.ask_a_person_first;

  // Requests outside the limits seen in agents' posts and reports.
  for (const ev of s.feed) {
    if (ev.actor_kind !== 'agent') continue;
    const text = String(ev.data?.text ?? ev.data?.working_on ?? ev.text ?? '');
    const concern = limitConcern(text, askFirst, [...s.agents.map((a) => a.name), ...s.people]);
    if (concern && /\b(may i|can i|should i|i want to|i'd like to|i plan to|plan to|going to|let me)\b/i.test(text) && mode !== 'relay') {
      out.instructions.push({
        agent: ev.actor_name,
        text: `Go ahead with: ${text.slice(0, 200)}`,
        done_when: 'Done and reported with proof.',
        priority: 'normal',
        due: null,
        why: `${ev.actor_name} asked to do this.`,
        needs_approval: true,
        approval_reason: `It involves ${concern}, which needs a person first.`,
        routed_from: null,
      });
      notes.push(`flagged a request from ${ev.actor_name} that involves ${concern}`);
    }
  }

  // Overlapping work.
  if (mode !== 'relay') {
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (overlap(a.working_on, b.working_on) >= 0.5 && b.open_instructions < b.max_open && !openFor(b.name).some((x) => x.issuer_kind === 'conductor')) {
          out.instructions.push({
            agent: b.name,
            text: `Leave "${(a.working_on ?? '').slice(0, 80)}" to ${a.name}. Instead, review ${a.name}'s work on it and post a list of gaps.`,
            done_when: `A list of gaps in ${a.name}'s work is posted in Tempo.`,
            priority: 'normal',
            due: null,
            why: `${a.name} and ${b.name} reported the same work; splitting it avoids duplicate effort.`,
            needs_approval: false,
            approval_reason: null,
            routed_from: null,
          });
          notes.push(`${a.name} and ${b.name} overlapped, so ${b.name} was redirected`);
        }
      }
    }
  }

  // Idle agents get a small step toward the goal.
  if (mode !== 'relay' && s.room.goal) {
    for (const a of active) {
      const already = out.instructions.some((x) => x.agent === a.name);
      if (!already && a.open_instructions === 0 && a.working_on === null) {
        out.instructions.push({
          agent: a.name,
          text: `Read the room goal and post a short plan for your part of it: ${s.room.goal.slice(0, 160)}`,
          done_when: 'A plan of three or fewer steps is in your next report.',
          priority: 'normal',
          due: null,
          why: `${a.name} has no work assigned yet.`,
          needs_approval: false,
          approval_reason: null,
          routed_from: null,
        });
        notes.push(`gave ${a.name} a first step`);
      }
    }
  }

  // Blocked agents: ask someone else to help.
  for (const a of active) {
    if (!a.blocked) continue;
    const helper = active.find((x) => x.name !== a.name);
    if (helper && !s.open_questions.some((q) => q.to === helper.name && q.text.includes(a.name))) {
      out.questions.push({ to: helper.name, text: `${a.name} is blocked (${a.blocked.slice(0, 160)}). Can you help unblock it?`, why: 'Try to unblock through another agent before asking people.' });
      notes.push(`asked ${helper.name} to help unblock ${a.name}`);
    }
  }

  // Questions addressed to the Conductor: it doesn't invent facts.
  for (const q of s.open_questions) {
    if (q.to_kind === 'conductor') {
      out.answers.push({ question_id: q.id, answer: "I don't have that information in the room yet, so I've left this question for the people to answer." });
    }
  }

  if (!out.instructions.length && !out.questions.length && !out.answers.length) return empty('Scripted Conductor (rehearsal stand-in): the agents are on track; nothing to do.');
  out.summary = `Scripted Conductor (rehearsal stand-in): ${notes.join('; ') || 'answered questions addressed to it'}.`;
  return out;
}

export class ScriptedConductorModel implements ConductorModel {
  readonly name = 'scripted rehearsal Conductor';
  readonly scripted = true;
  async call(args: { structuredInput?: unknown; purpose: string }): Promise<ModelCallResult> {
    const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    if (args.purpose === 'brief') return { output: null, usage, model: this.name, stopReason: 'scripted_no_brief' };
    return { output: scriptedDecide(args.structuredInput as StructuredRoom), usage, model: this.name, stopReason: null };
  }
}
