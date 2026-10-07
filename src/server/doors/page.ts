import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.js';
import { parseJson } from '../db/index.js';
import { TempoError, tooLarge } from '../lib/errors.js';
import { html, linkify, raw, type SafeHtml } from '../lib/html.js';
import type { CardRoomT, CardT, ReportResultT } from '../schemas/agent.js';
import { isAgentInRoom, roomAgents } from '../services/repo.js';
import { quoted } from '../services/render-text.js';
import { internalError, pageNotFound, type AgentAuth, type DoorLimits } from './agent-auth.js';
import {
  FIELD,
  INSTRUCTION_STATUS_CHOICES,
  MAX_FINISHED_ROWS,
  MAX_LESSONS,
  MAX_NEW_QUESTIONS,
  formToReport,
} from './page-form.js';
import { clientLabel } from './rest.js';
import { authenticateForDoor, runLogged } from './run.js';

/**
 * Door C: the agent page at /a/<page token>, for agents that can only use a browser.
 *
 * GET shows the briefing card as readable text followed by one ordinary HTML form. POST takes the
 * form, runs it through the same shared service as the other doors, and shows either the problems
 * (at the top, with everything the agent typed still in place) or a confirmation.
 *
 * It works with JavaScript off, because there is no JavaScript: no script, no external styles,
 * fonts or images, no pop-ups, no browser validation bubbles (no `required` attributes; the shared
 * validator explains problems in plain words). The page token is a separate secret from the API
 * key. Every response is no-index, no-referrer and no-store, with a CSP that allows only inline
 * styles and posting back to this site. Everything written by agents or people is escaped; the only
 * thing ever turned into markup is an http(s) address, as a plain link.
 */

const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function applyPageHeaders(reply: FastifyReply): void {
  reply.header('X-Robots-Tag', 'noindex, nofollow');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Cache-Control', 'no-store');
  reply.header('Content-Security-Policy', CSP);
  reply.header('X-Content-Type-Options', 'nosniff');
}

function sendHtml(reply: FastifyReply, status: number, document: string): FastifyReply {
  applyPageHeaders(reply);
  return reply.code(status).type('text/html; charset=utf-8').send(document);
}

// ---------------------------------------------------------------------------------------------
// Link-preview bots
// ---------------------------------------------------------------------------------------------

const PREVIEW_BOT_WORDS = [
  'facebookexternalhit',
  'facebot',
  'twitterbot',
  'whatsapp',
  'slackbot',
  'slack-imgproxy',
  'telegrambot',
  'discordbot',
  'googlebot',
  'google-inspectiontool',
  'bingbot',
  'bingpreview',
  'linkedinbot',
  'skypeuripreview',
  'applebot',
  'redditbot',
  'embedly',
  'pinterest',
  'vkshare',
  'mastodon',
  'preview',
];
// "bot" at the end of a word (Googlebot, AhrefsBot, "bot/1.0"), and crawler or spider anywhere.
const GENERIC_BOT = /bot(?![a-z])|crawler|spider/i;

/**
 * True for the programs that fetch a link to build a preview (messaging apps) or to index it
 * (search engines). They must never open a card: opening a card starts a check-in. A request with
 * no User-Agent at all is treated as a person's browser, because real browsers always send one.
 */
export function isPreviewBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return PREVIEW_BOT_WORDS.some((w) => ua.includes(w)) || GENERIC_BOT.test(ua);
}

// ---------------------------------------------------------------------------------------------
// Page frame
// ---------------------------------------------------------------------------------------------

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #ffffff; color: #111111; font: 18px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
main { max-width: 42rem; margin: 0 auto; padding: 16px 16px 48px; }
h1 { font-size: 1.6rem; line-height: 1.25; margin: 0.5rem 0 1rem; }
h2 { font-size: 1.35rem; line-height: 1.3; margin: 2rem 0 0.75rem; }
h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
p, ul { margin: 0 0 1rem; }
ul { padding-left: 1.25rem; }
li { margin-bottom: 0.6rem; }
a { color: #0b4fb3; overflow-wrap: anywhere; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; }
.quote { display: block; border-left: 4px solid #777777; padding: 2px 0 2px 10px; margin: 4px 0; }
.room { border-top: 4px solid #111111; margin-top: 2rem; }
.box { border: 4px solid #555555; background: #f3f3f3; padding: 12px 16px; margin: 0 0 1.5rem; }
.box h2 { margin-top: 0; }
.box p:last-child, .box ul:last-child { margin-bottom: 0; }
.alert { border-color: #b00020; background: #fdecea; }
.alert h2 { color: #7a0016; }
.ok { border-color: #0a6b2d; background: #e8f6ed; }
form { margin-top: 2rem; border-top: 4px solid #111111; }
fieldset { border: 2px solid #555555; padding: 8px 12px 14px; margin: 0 0 2rem; min-width: 0; }
fieldset fieldset { margin: 1.5rem 0 0; border-color: #999999; }
legend { font-size: 1.2rem; font-weight: 700; padding: 0 6px; }
label { display: block; font-weight: 700; margin: 1.25rem 0 0.25rem; }
.hint { color: #444444; font-size: 0.95rem; margin: 0 0 0.5rem; }
input[type="text"], textarea, select { display: block; width: 100%; font: inherit; padding: 12px; border: 2px solid #333333; border-radius: 6px; background: #ffffff; color: #111111; }
textarea { min-height: 7rem; }
.choice { display: flex; align-items: flex-start; gap: 12px; padding: 8px 0; }
.choice input { flex: none; width: 28px; height: 28px; margin: 2px 0 0; }
.choice label { flex: 1; min-width: 0; margin: 0; font-weight: 400; overflow-wrap: anywhere; }
button { display: block; width: 100%; font: inherit; font-size: 1.3rem; font-weight: 700; padding: 18px; margin-top: 1.5rem; background: #0b4fb3; color: #ffffff; border: 0; border-radius: 8px; cursor: pointer; }
`;

function layout(title: string, body: SafeHtml): string {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>${raw(CSS)}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`.value;
}

/**
 * Free text written by someone else: escaped, line breaks kept, http(s) addresses made clickable,
 * and every line after the first marked "|" exactly as on the text card (quoted()). Agents often
 * read this page as plain text, where borders and styling are gone, so the marks are what keep a
 * line of someone's text from passing for a line of the card.
 */
function textOf(text: string | null | undefined): SafeHtml {
  return html`<span class="text">${linkify(quoted(text))}</span>`;
}

/** Text another agent wrote: marked like textOf, and set off in a bordered block as well. */
function quotedOf(text: string | null | undefined): SafeHtml {
  return html`<span class="text quote">${linkify(quoted(text))}</span>`;
}

function pagePath(token: string): string {
  return `/a/${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------------------------
// Simple pages: link-preview page, message and error pages, confirmation
// ---------------------------------------------------------------------------------------------

function previewPage(): string {
  return layout(
    'Tempo agent page',
    html`<h1>Tempo agent page</h1>
<p>Tempo agent page. Open this link in a browser to see your briefing card.</p>`,
  );
}

interface MessagePage {
  title: string;
  message: string;
  problems?: { field: string; message: string }[];
  extra?: SafeHtml;
}

function alertBox(m: MessagePage): SafeHtml {
  return html`<section class="box alert" role="alert" aria-labelledby="problem-title">
<h2 id="problem-title">${m.title}</h2>
<p class="text">${m.message}</p>
${m.problems && m.problems.length
    ? html`<p>What is missing or needs fixing:</p>
<ul>${m.problems.map((p) => html`<li>${textOf(p.message)}</li>`)}</ul>`
    : ''}
${m.extra ?? ''}
</section>`;
}

function messagePage(m: MessagePage): string {
  return layout('Tempo agent page', html`<h1>Tempo agent page</h1>
${alertBox(m)}`);
}

function sendTempoError(reply: FastifyReply, err: TempoError, extra?: SafeHtml): FastifyReply {
  if (err.retryAfterSeconds !== undefined) reply.header('Retry-After', String(err.retryAfterSeconds));
  const title =
    err.status === 404 ? 'This link does not work' : err.status === 429 ? 'Please wait a moment' : 'This page could not be opened';
  return sendHtml(reply, err.status, messagePage({ title, message: err.message, extra }));
}

function confirmationPage(r: ReportResultT): string {
  return layout(
    'Tempo report received',
    html`<h1>Report received</h1>
<section class="box ok" role="status">
<p class="text">${r.message}</p>
</section>
<p><strong>Next check-in due:</strong> ${r.next_check_in_due_text}</p>
${r.arrived_since_card.length
    ? html`<h2>Arrived for you after your card was issued</h2>
<p>These will also be on your next card.</p>
<ul>${r.arrived_since_card.map((a) => html`<li>${a.kind} ${a.id} from ${a.from} (${a.at}): ${quotedOf(a.text)}</li>`)}</ul>`
    : ''}
<p><strong>You are done until your next check-in.</strong></p>`,
  );
}

// ---------------------------------------------------------------------------------------------
// The card, as readable HTML with the same facts as renderCardText
// ---------------------------------------------------------------------------------------------

const REPLY_HINT =
  'Fill in the form below and press "Send report". If anything is missing, this page lists it at the top and keeps what you typed. Fix it and press "Send report" again.';

function roomSection(r: CardRoomT): SafeHtml {
  const head = html`<h2>Room "${r.room_name}" (room_id ${r.room_id})${r.paused ? ' (paused: nothing to do here for now)' : ''}</h2>
<p><strong>Goal:</strong> ${textOf(r.goal)}</p>
${r.rules.length ? html`<h3>Rules</h3><ul>${r.rules.map((rule) => html`<li>${textOf(rule)}</li>`)}</ul>` : ''}
<p><strong>Limits:</strong> you may ${r.limits.you_may.join(', ') || '(nothing listed)'}. Ask a person first before ${r.limits.ask_a_person_first.join(', ') || '(nothing listed)'}.</p>
${r.others_here.length ? html`<p><strong>Also in this room:</strong> ${r.others_here.join(', ')}</p>` : ''}`;
  if (r.paused) return html`<section class="room">${head}</section>`;

  const since = r.since_last_check_in.length
    ? r.since_last_check_in.map((i) => html`<li>[${i.at}] ${i.from} (${i.kind}, ${i.id}): ${quotedOf(i.text)}</li>`)
    : html`<li>Nothing new.</li>`;
  const questions = r.questions_for_you.length
    ? r.questions_for_you.map((q) => html`<li><strong>${q.id}</strong> from ${q.from} (${q.asked_at}): ${quotedOf(q.text)}</li>`)
    : html`<li>None.</li>`;
  const instructions = r.instructions_for_you.length
    ? r.instructions_for_you.map(
        (i) => html`<li><strong>${i.id}</strong> from ${i.from} (${i.issued_at}), priority ${i.priority}${i.due ? `, due ${i.due}` : ''}, current status: ${i.status}
<div><strong>Do:</strong> ${textOf(i.text)}</div>
<div><strong>Done when:</strong> ${textOf(i.done_when)}</div></li>`,
      )
    : html`<li>None.</li>`;
  return html`<section class="room">${head}
<h3>Since your last check-in (newest first)</h3>
<ul>${since}</ul>
<h3>Questions for you (answer each one)</h3>
<ul>${questions}</ul>
<h3>Instructions for you (send a status for each one)</h3>
<ul>${instructions}</ul>
${r.playbook.length
    ? html`<h3>Playbook (lessons saved by the team)</h3>
<ul>${r.playbook.map((p) => html`<li>${p.id}, saved by ${p.from}: ${shorten(p.title, 200)}: ${quotedOf(p.text)}</li>`)}</ul>`
    : ''}
</section>`;
}

function cardSections(card: CardT): SafeHtml {
  return html`<h1>Tempo briefing card ${card.card_id}</h1>
<p><strong>Time:</strong> ${card.now_text}</p>
<p><strong>For:</strong> ${card.agent.name} (owner: ${card.agent.owner})</p>
<p><strong>About this card:</strong> ${textOf(card.about)}</p>
${card.paused
    ? html`<div class="box"><p><strong>Paused:</strong> Tempo is paused for you. Do no work for these projects until a later card says it has resumed. To acknowledge, press "Send report" at the bottom of this page.</p></div>`
    : ''}
${card.rooms.map(roomSection)}
${card.left_out ? html`<p><strong>Left out:</strong> ${textOf(card.left_out)}</p>` : ''}
<h2>You must send back</h2>
<ul>${card.you_must_send_back.map((line) => html`<li>${textOf(line)}</li>`)}</ul>
<p><strong>How to reply:</strong> ${REPLY_HINT}</p>
<p><strong>Next check-in due:</strong> ${card.next_check_in_due_text}</p>`;
}

// ---------------------------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------------------------

type Value = (name: string) => string;

function fid(name: string): string {
  return 'f-' + name.replace(/[^A-Za-z0-9_-]/g, '-');
}

function shorten(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function describedBy(id: string, hint: unknown): SafeHtml {
  return hint ? html` aria-describedby="${id}-hint"` : raw('');
}

function hintOf(id: string, hint: SafeHtml | string | undefined): SafeHtml {
  return hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : raw('');
}

function textarea(name: string, label: string, value: string, opts: { hint?: SafeHtml | string; rows?: number } = {}): SafeHtml {
  const id = fid(name);
  // A newline right after <textarea> is dropped by browsers, so add one: values that start with a newline survive.
  return html`<label for="${id}">${label}</label>
${hintOf(id, opts.hint)}
<textarea id="${id}" name="${name}" rows="${opts.rows ?? 4}"${describedBy(id, opts.hint)}>${raw('\n')}${value}</textarea>`;
}

function textInput(name: string, label: string, value: string, opts: { hint?: SafeHtml | string } = {}): SafeHtml {
  const id = fid(name);
  return html`<label for="${id}">${label}</label>
${hintOf(id, opts.hint)}
<input type="text" id="${id}" name="${name}" value="${value}"${describedBy(id, opts.hint)}>`;
}

function select(
  name: string,
  label: string,
  placeholder: string,
  options: { value: string; text: string }[],
  current: string,
  opts: { hint?: SafeHtml | string } = {},
): SafeHtml {
  const id = fid(name);
  // A value that is not on the menu (a form filled in by a program) is kept, so nothing typed is lost.
  const all = current && !options.some((o) => o.value === current) ? [...options, { value: current, text: current }] : options;
  return html`<label for="${id}">${label}</label>
${hintOf(id, opts.hint)}
<select id="${id}" name="${name}"${describedBy(id, opts.hint)}>
<option value=""${current === '' ? raw(' selected') : ''}>${placeholder}</option>
${all.map((o) => html`<option value="${o.value}"${o.value === current ? raw(' selected') : ''}>${o.text}</option>`)}
</select>`;
}

function instructionFieldset(i: CardRoomT['instructions_for_you'][number], v: Value): SafeHtml {
  const statusName = FIELD.insStatus(i.id);
  const current = v(statusName).trim();
  return html`<fieldset>
<legend>Your status for instruction ${i.id} (required)</legend>
<p class="text">Instruction: ${linkify(shorten(i.text, 200))}</p>
${INSTRUCTION_STATUS_CHOICES.map((c) => {
    const id = `${fid(statusName)}-${c.value}`;
    return html`<div class="choice"><input type="radio" id="${id}" name="${statusName}" value="${c.value}"${current === c.value ? raw(' checked') : ''}><label for="${id}">${c.label}</label></div>`;
  })}
${textarea(FIELD.insNote(i.id), `Note for ${i.id} (required if blocked or declined, optional otherwise)`, v(FIELD.insNote(i.id)), { rows: 3 })}
${textarea(FIELD.insProof(i.id), `Proof for ${i.id} (required if done): a link, or a sentence saying where the result is`, v(FIELD.insProof(i.id)), { rows: 3 })}
</fieldset>`;
}

function roomFieldset(r: CardRoomT, v: Value): SafeHtml {
  const rid = r.room_id;
  const finishedRows = Array.from({ length: MAX_FINISHED_ROWS }, (_, k) => k + 1).map(
    (n) => html`${textInput(FIELD.finishedWhat(rid, n), `Finished item ${n}: what you finished`, v(FIELD.finishedWhat(rid, n)))}
${textInput(FIELD.finishedProof(rid, n), `Finished item ${n}: proof (a link, or a sentence saying where the result is)`, v(FIELD.finishedProof(rid, n)))}`,
  );
  return html`<fieldset>
<legend>Room "${r.room_name}" (${rid})</legend>
${textarea(FIELD.workingOn(rid), `What are you working on right now in "${r.room_name}"? (required)`, v(FIELD.workingOn(rid)), {
    hint: 'One to three sentences.',
  })}
${r.questions_for_you.map((q) =>
    textarea(FIELD.answer(q.id), `Your answer to question ${q.id} (required)`, v(FIELD.answer(q.id)), {
      hint: html`Question from ${q.from}: ${quotedOf(q.text)} "I can't answer this because..." is a fine answer. Leaving it empty is not.`,
    }),
  )}
${r.instructions_for_you.map((i) => instructionFieldset(i, v))}
<fieldset>
<legend>Finished since your last check-in (optional)</legend>
<p class="hint">Leave unused rows empty.</p>
${finishedRows}
</fieldset>
${textarea(FIELD.notesForOthers(rid), `Notes for the others in "${r.room_name}" (optional)`, v(FIELD.notesForOthers(rid)), { rows: 3 })}
<fieldset>
<legend>Are you blocked in "${r.room_name}"? (optional)</legend>
<p class="hint">Leave both boxes empty if you are not blocked.</p>
${textarea(FIELD.blockedReason(rid), 'Why you are blocked', v(FIELD.blockedReason(rid)), { rows: 3 })}
${textarea(FIELD.blockedUnblock(rid), 'What would unblock you, and who could do it', v(FIELD.blockedUnblock(rid)), { rows: 3 })}
</fieldset>
</fieldset>`;
}

function roomChoices(rooms: CardRoomT[]): { value: string; text: string }[] {
  return rooms.map((r) => ({ value: r.room_id, text: `${r.room_name} (${r.room_id})` }));
}

function newQuestionsFieldset(rooms: CardRoomT[], agentNames: string[], v: Value): SafeHtml {
  const toOptions = [...agentNames, 'conductor', 'people'].map((n) => ({ value: n, text: n }));
  const pickRoom = rooms.length > 1;
  const rows = Array.from({ length: MAX_NEW_QUESTIONS }, (_, k) => k + 1).map(
    (n) => html`<fieldset>
<legend>Question ${n}</legend>
${select(FIELD.questionTo(n), `Question ${n}: who should answer?`, 'Choose who should answer', toOptions, v(FIELD.questionTo(n)).trim(), {
      hint: '"conductor" is Tempo\'s coordinator. "people" means the people in the room. Only needed if you write a question below.',
    })}
${pickRoom ? select(FIELD.questionRoom(n), `Question ${n}: which room is it about?`, 'Choose a room', roomChoices(rooms), v(FIELD.questionRoom(n)).trim()) : ''}
${textarea(FIELD.questionText(n), `Question ${n}: your question`, v(FIELD.questionText(n)), { rows: 3 })}
</fieldset>`,
  );
  return html`<fieldset>
<legend>Questions you want answered (optional)</legend>
<p class="hint">Leave the question box empty to skip a question.${pickRoom && agentNames.length ? ' Agent names come from all your rooms; choose a room that the agent is in.' : ''}</p>
${rows}
</fieldset>`;
}

function lessonFieldset(rooms: CardRoomT[], v: Value): SafeHtml {
  const pickRoom = rooms.length > 1;
  const rows = Array.from({ length: MAX_LESSONS }, (_, k) => k + 1).map(
    (n) => html`${textInput(FIELD.lessonTitle(n), 'Lesson: short title', v(FIELD.lessonTitle(n)))}
${textarea(FIELD.lessonText(n), 'Lesson: what you learned, written so another agent could act on it', v(FIELD.lessonText(n)), { rows: 4 })}
${pickRoom ? select(FIELD.lessonRoom(n), 'Lesson: which room is it for?', 'Choose a room', roomChoices(rooms), v(FIELD.lessonRoom(n)).trim()) : ''}`,
  );
  return html`<fieldset>
<legend>A lesson worth saving for everyone (optional)</legend>
<p class="hint">Leave empty to skip.</p>
${rows}
</fieldset>`;
}

function reportForm(card: CardT, token: string, agentNames: string[], v: Value): SafeHtml {
  const action = pagePath(token);
  const hidden = html`<input type="hidden" name="card_id" value="${card.card_id}">`;
  if (card.paused) {
    return html`<form method="post" action="${action}" enctype="application/x-www-form-urlencoded">
${hidden}
<h2>Acknowledge this card</h2>
<p>Tempo is paused for you, so there is nothing to fill in. Press the button to tell Tempo you have seen this card.</p>
<button type="submit">Send report</button>
</form>`;
  }
  const rooms = card.rooms.filter((r) => !r.paused);
  return html`<form method="post" action="${action}" enctype="application/x-www-form-urlencoded">
${hidden}
<h2>Your report</h2>
<p>Fields marked "required" must be filled in. Everything else is optional. Nothing is saved until you press "Send report".</p>
${rooms.map((r) => roomFieldset(r, v))}
${newQuestionsFieldset(rooms, agentNames, v)}
${lessonFieldset(rooms, v)}
<button type="submit">Send report</button>
</form>`;
}

function cardPage(args: {
  card: CardT;
  token: string;
  agentNames: string[];
  values?: URLSearchParams;
  alert?: MessagePage;
}): string {
  const values = args.values;
  const v: Value = (name) => values?.get(name) ?? '';
  return layout(
    `Tempo briefing card ${args.card.card_id}`,
    html`${args.alert ? alertBox(args.alert) : ''}
${cardSections(args.card)}
${reportForm(args.card, args.token, args.agentNames, v)}`,
  );
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

/** Errors that sending the same form again cannot fix: the agent needs a fresh card. */
const NEEDS_FRESH_CARD = new Set(['card_replaced', 'card_expired', 'card_unknown']);

function loadCard(ctx: AppContext, agentId: string, cardId: string): CardT | null {
  const row = ctx.db.prepare('SELECT content FROM cards WHERE id = ? AND agent_id = ?').get(cardId, agentId) as
    | { content: string }
    | undefined;
  return row ? parseJson<CardT | null>(row.content, null) : null;
}

/** The other agents in the card's active rooms, for the "who should answer" menu. */
function otherAgentNames(ctx: AppContext, card: CardT, selfId: string): string[] {
  const names: string[] = [];
  for (const r of card.rooms) {
    if (r.paused || !isAgentInRoom(ctx.db, selfId, r.room_id)) continue;
    for (const a of roomAgents(ctx.db, r.room_id)) if (a.id !== selfId && !names.includes(a.name)) names.push(a.name);
  }
  return names;
}

function openAgainLink(token: string): SafeHtml {
  return html`<p>To get your current briefing card, <a href="${pagePath(token)}">open your Tempo page again</a>.</p>`;
}

export async function registerPageDoor(app: FastifyInstance, ctx: AppContext, limits: DoorLimits): Promise<void> {
  await app.register(async (scope) => {
    // Only plain HTML form posts are accepted here, parsed with the built-in URLSearchParams.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string', bodyLimit: ctx.config.agentBodyLimitBytes },
      (_req, body, done) => {
        done(null, new URLSearchParams(typeof body === 'string' ? body : body.toString('utf8')));
      },
    );

    // Every response from this door carries the privacy headers, whatever produced it.
    scope.addHook('onSend', async (_req, reply, payload) => {
      applyPageHeaders(reply);
      return payload;
    });

    scope.setErrorHandler((error: Error & { code?: string; statusCode?: number }, req, reply) => {
      const token = (req.params as { token?: string } | undefined)?.token;
      const again = token ? openAgainLink(token) : undefined;
      if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.statusCode === 413) {
        return sendTempoError(
          reply,
          tooLarge(ctx.config.agentBodyLimitBytes),
          html`<p>Nothing was saved. Use your browser's Back button to return to the form, shorten the long text, and press "Send report" again.</p>${again ?? ''}`,
        );
      }
      if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || error.statusCode === 415) {
        return sendTempoError(
          reply,
          new TempoError(415, 'unsupported_form', 'This page only accepts the form that is shown on it. Open your Tempo page link again and use that form.'),
          again,
        );
      }
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
        return sendTempoError(
          reply,
          new TempoError(400, 'bad_request', 'Tempo could not read what was sent. Open your Tempo page link again and use the form on it.'),
          again,
        );
      }
      ctx.log.error({ err: error.message }, 'agent page error');
      return sendTempoError(reply, internalError(), again);
    });

    const authenticate = (token: string, action: 'check_in' | 'report', client: string | null, clientAddress: string): AgentAuth =>
      authenticateForDoor(ctx, limits, { secret: token, kind: 'page', door: 'page', action, client, clientAddress });

    // GET: open (or re-show) the card and draw the form.
    scope.get<{ Params: { token: string } }>('/a/:token', async (req, reply) => {
      // Messaging apps fetch links to build previews, and HEAD only asks what is there. Neither may
      // open a card, so they get a tiny page without touching the service or the connection log.
      const ua = req.headers['user-agent'];
      if (req.method === 'HEAD' || isPreviewBot(typeof ua === 'string' ? ua : null)) {
        return sendHtml(reply, 200, previewPage());
      }
      const token = req.params.token;
      if (!token) return sendTempoError(reply, pageNotFound());
      const client = clientLabel(req);
      let auth: AgentAuth;
      try {
        auth = authenticate(token, 'check_in', client, req.ip);
      } catch (e) {
        return sendTempoError(reply, e as TempoError);
      }
      const result = runLogged(ctx, auth, 'check_in', {}, 'page', client);
      if (!result.ok) return sendTempoError(reply, result.error);
      const card = result.value;
      return sendHtml(reply, 200, cardPage({ card, token, agentNames: otherAgentNames(ctx, card, auth.agent.id) }));
    });

    // POST: the form. Same URL, same shared service as the other doors.
    scope.post<{ Params: { token: string } }>(
      '/a/:token',
      { bodyLimit: ctx.config.agentBodyLimitBytes },
      async (req, reply) => {
        const token = req.params.token;
        if (!token) return sendTempoError(reply, pageNotFound());
        const client = clientLabel(req);
        let auth: AgentAuth;
        try {
          auth = authenticate(token, 'report', client, req.ip);
        } catch (e) {
          return sendTempoError(reply, e as TempoError);
        }
        const fields = req.body instanceof URLSearchParams ? req.body : new URLSearchParams();
        const cardId = (fields.get(FIELD.cardId) ?? '').trim();
        // Validate against the card the form was drawn from. If there is none, the shared service
        // still answers (with its standard "not a card Tempo gave you" error).
        const card = cardId ? loadCard(ctx, auth.agent.id, cardId) : null;
        const report = card ? formToReport(fields, card) : { card_id: cardId };
        const result = runLogged(ctx, auth, 'report', report, 'page', client);

        if (result.ok) return sendHtml(reply, 200, confirmationPage(result.value));

        const err = result.error;
        const alert: MessagePage = {
          title: 'Your report was not saved',
          message: err.message,
          problems: err.problems,
          extra: !card || NEEDS_FRESH_CARD.has(err.code) ? openAgainLink(token) : undefined,
        };
        if (!card || NEEDS_FRESH_CARD.has(err.code)) return sendHtml(reply, err.status, messagePage(alert));
        return sendHtml(
          reply,
          err.status,
          cardPage({ card, token, agentNames: otherAgentNames(ctx, card, auth.agent.id), values: fields, alert }),
        );
      },
    );

    // Anything else under /a/ (wrong method, extra path parts) gets a plain page with the same headers.
    scope.all('/a/*', async (req, reply) => {
      if (/^\/a\/[^/]+$/.test(req.url.split('?')[0])) {
        reply.header('Allow', 'GET, HEAD, POST');
        return sendTempoError(
          reply,
          new TempoError(405, 'method_not_allowed', 'This page only accepts opening the link (GET) and sending the form on it (POST).'),
        );
      }
      return sendTempoError(reply, pageNotFound());
    });
  });
}
