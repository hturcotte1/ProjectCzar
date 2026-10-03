import type { CardT, LookupResultT, PostResultT, ReportResultT, WhoamiResultT } from '../schemas/agent.js';

/**
 * Plain-text renderings of what the agent doors return. MCP returns these as the text content
 * next to the structured content; the agent page shows the card text above its form.
 * Written as plain facts with clear sources. No urgent or manipulative wording.
 */

/**
 * Text someone else wrote, made safe for this layout: every line after the first is indented and
 * marked with "|", so nothing written by an agent can start a line that looks like part of the
 * card (a fake heading or a fake instruction).
 */
export function quoted(text: string | null | undefined): string {
  return String(text ?? '').replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/\n/g, '\n    | ');
}

export function renderCardText(card: CardT, opts: { replyHint?: string } = {}): string {
  const out: string[] = [];
  out.push(`TEMPO BRIEFING CARD ${card.card_id}`);
  out.push(`Time: ${card.now_text}`);
  out.push(`For: ${card.agent.name} (owner: ${card.agent.owner})`);
  out.push(`About this card: ${card.about}`);
  if (card.paused) out.push('', 'PAUSED: Tempo is paused for you. Do no work for these projects until a later card says it has resumed. Just send the card_id back to acknowledge.');
  for (const r of card.rooms) {
    out.push('', `ROOM "${r.room_name}" (room_id ${r.room_id})${r.paused ? ' (paused: nothing to do here for now)' : ''}`);
    out.push(`Goal: ${quoted(r.goal)}`);
    if (r.rules.length) {
      out.push('Rules:');
      for (const rule of r.rules) out.push(`- ${quoted(rule)}`);
    }
    out.push(`Limits: you may ${r.limits.you_may.join(', ') || '(nothing listed)'}. Ask a person first before ${r.limits.ask_a_person_first.join(', ') || '(nothing listed)'}.`);
    if (r.others_here.length) out.push(`Also in this room: ${r.others_here.join(', ')}`);
    if (r.paused) continue;
    out.push('', 'Since your last check-in (newest first):');
    if (!r.since_last_check_in.length) out.push('- Nothing new.');
    for (const i of r.since_last_check_in) out.push(`- [${i.at}] ${i.from} (${i.kind}, ${i.id}): ${quoted(i.text)}`);
    out.push('', 'Questions for you (answer each one):');
    if (!r.questions_for_you.length) out.push('- None.');
    for (const q of r.questions_for_you) out.push(`- ${q.id} from ${q.from} (${q.asked_at}): ${quoted(q.text)}`);
    out.push('', 'Instructions for you (send a status for each one):');
    if (!r.instructions_for_you.length) out.push('- None.');
    for (const i of r.instructions_for_you) {
      out.push(
        `- ${i.id} from ${i.from} (${i.issued_at}), priority ${i.priority}${i.due ? `, due ${i.due}` : ''}, current status: ${i.status}`,
      );
      out.push(`  Do: ${quoted(i.text)}`);
      out.push(`  Done when: ${quoted(i.done_when)}`);
    }
    if (r.playbook.length) {
      out.push('', 'Playbook (lessons saved by the team):');
      for (const p of r.playbook) out.push(`- ${p.id} ${quoted(p.title)}: ${quoted(p.text)}`);
    }
  }
  if (card.left_out) out.push('', `Left out: ${quoted(card.left_out)}`);
  out.push('', 'YOU MUST SEND BACK');
  for (const line of card.you_must_send_back) out.push(`- ${line}`);
  out.push('', `How to reply: ${opts.replyHint ?? card.how_to_reply}`);
  out.push(`Next check-in due: ${card.next_check_in_due_text}`);
  return out.join('\n');
}

export function renderReportResultText(r: ReportResultT): string {
  const out = [r.message, `Report id: ${r.report_id}. Next check-in due: ${r.next_check_in_due_text}.`];
  if (r.arrived_since_card.length) {
    out.push('Arrived after your card was issued (also on your next card):');
    for (const a of r.arrived_since_card) out.push(`- ${a.kind} ${a.id} from ${a.from} (${a.at}): ${quoted(a.text)}`);
  }
  return out.join('\n');
}

export function renderWhoamiText(w: WhoamiResultT): string {
  return [
    w.message,
    `Next check-in due: ${w.next_check_in_due_text}.`,
    w.last_check_in ? `Last completed check-in: ${w.last_check_in}.` : 'No completed check-in yet.',
  ].join('\n');
}

export function renderPostText(p: PostResultT): string {
  return p.message;
}

export function renderLookupText(l: LookupResultT): string {
  const out = [l.message];
  for (const r of l.results) out.push(`- ${r.id} [${r.at}] ${r.from} (${r.kind}, room ${r.room_id}): ${quoted(r.text)}`);
  return out.join('\n');
}
