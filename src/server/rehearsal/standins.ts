import Anthropic from '@anthropic-ai/sdk';
import { Client as V1Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as V1Transport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client as V2Client, StreamableHTTPClientTransport as V2Transport } from '@modelcontextprotocol/client';
import { parse, type HTMLElement as El } from 'node-html-parser';
import { FIELD } from '../doors/page-form.js';
import { MAX_TEXT, type CardT, type InstructionStatusT } from '../schemas/agent.js';

/**
 * Stand-in agents for rehearsals: clients that drive the three doors the way real agents would
 * (official MCP clients for Door A, plain fetch for Door B, an HTML form post for Door C), so a
 * rehearsal exercises the whole system end to end, including deliberate misbehavior.
 */

export type StandInDoor = 'mcp-v1' | 'mcp-v2' | 'rest' | 'page';

/** What a stand-in should send on one check-in. Misbehavior is opt-in per check-in. */
export interface CheckInPlan {
  /** Leave out the answers on the first attempt (misbehavior), then send a corrected report. */
  skipAnswersFirst?: boolean;
  /** New questions to ask (to an agent name, "conductor" or "people"). */
  questions?: { to: string; text: string }[];
  /** Disagree with another agent in this room. */
  disagreements?: { with: string; about: string; my_view: string }[];
  /** Override the working_on text (otherwise the writer writes it). */
  workingOn?: string;
  /** Mark every open instruction with this status (done needs proof; the stand-in supplies one). */
  instructionStatus?: 'acknowledged' | 'in_progress' | 'done';
}

export interface Attempt {
  ok: boolean;
  /** HTTP status (MCP tool errors count as 422 when isError is set). */
  status: number;
  /** The message the agent was shown (success message or the error text). */
  message: string;
}

export interface CheckInOutcome {
  door: StandInDoor;
  cardId: string;
  /** The card as the stand-in understood it (for the page door, reconstructed from the HTML). */
  questionIds: string[];
  instructionIds: string[];
  roomIds: string[];
  /** Text of everything new on the card (since_last_check_in items), for checks like "the answer came back". */
  newItemsText: string;
  attempts: Attempt[];
}

/** Writes the free-text parts of a report. */
export interface StandInWriter {
  readonly label: string;
  write(input: {
    agentName: string;
    cardText: string;
    questions: { id: string; text: string }[];
    instructions: { id: string; text: string }[];
  }): Promise<{
    working_on: string;
    notes_for_others: string | null;
    answers: Record<string, string>;
    instruction_notes: Record<string, string>;
  }>;
}

export interface StandInOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  pageLink: string;
  /** Doors to use, in rotation (one per check-in). */
  doors: StandInDoor[];
  writer: StandInWriter;
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/** A normal browser User-Agent: a bot-like one makes the agent page return a preview stub. */
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36';
const REQUEST_TIMEOUT_MS = 20_000;
const CARD_TEXT_MAX = 4000;

type WriterResult = Awaited<ReturnType<StandInWriter['write']>>;

function describe(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  return e.cause instanceof Error ? `${e.message} (${e.cause.message})` : e.message;
}

/** An HTTP status carried by an SDK error, or 0 when the error is not an HTTP one. */
function statusOf(e: unknown): number {
  const o = (e ?? {}) as { status?: unknown; statusCode?: unknown; code?: unknown };
  for (const v of [o.status, o.statusCode, o.code]) if (typeof v === 'number' && v >= 100 && v < 600) return v;
  return 0;
}

function collapse(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

/** What the stand-in understood about a card, whichever door it came through. */
interface CardView {
  cardId: string;
  /** True when there is nothing to report on: the card (or every room) is paused. */
  paused: boolean;
  /** Active (not paused) rooms. `others` are lowercase names of the other agents and people there. */
  rooms: { id: string; others: string[] }[];
  questions: { id: string; text: string }[];
  instructions: { id: string; text: string }[];
  newItemsText: string;
  /** A short plain-text summary of the card for the writer. */
  text: string;
}

/** The report the stand-in intends to send, independent of the door's wire format. */
interface Draft {
  rooms: {
    roomId: string;
    workingOn: string;
    notes: string | null;
    disagreements: { with: string; about: string; my_view: string }[];
  }[];
  answers: { questionId: string; answer: string }[];
  instructions: { id: string; status: InstructionStatusT; note: string | null; proof: string | null }[];
  questions: { to: string; text: string; roomId: string }[];
}

type Opened = { view: CardView } | { failure: Attempt };

/** One door, for one check-in: open the card, send report attempts, then close. */
interface Channel {
  open(): Promise<Opened>;
  /** A null draft sends only the card_id (a paused card). */
  send(cardId: string, draft: Draft | null): Promise<Attempt>;
  close(): Promise<void>;
}

type Clean = (text: string) => string;

function failure(status: number, message: string): { failure: Attempt } {
  return { failure: { ok: false, status, message } };
}

function otherName(entry: string): string {
  return entry.replace(/\s*\((agent|person)\)\s*$/i, '').trim().toLowerCase();
}

function viewOfCard(card: CardT): CardView {
  const active = card.rooms.filter((r) => !r.paused);
  const lines: string[] = [];
  for (const r of active) {
    lines.push(`Room "${r.room_name}": ${r.goal}`);
    if (r.rules.length) lines.push(`Rules: ${r.rules.join(' ')}`);
    for (const i of r.since_last_check_in.slice(0, 8)) lines.push(`New from ${i.from}: ${i.text}`);
  }
  return {
    cardId: card.card_id,
    paused: card.paused || active.length === 0,
    rooms: active.map((r) => ({ id: r.room_id, others: r.others_here.map(otherName) })),
    questions: active.flatMap((r) => r.questions_for_you.map((q) => ({ id: q.id, text: q.text }))),
    instructions: active.flatMap((r) => r.instructions_for_you.map((i) => ({ id: i.id, text: i.text }))),
    newItemsText: active.flatMap((r) => r.since_last_check_in.map((i) => i.text)).join('\n'),
    text: lines.join('\n').slice(0, CARD_TEXT_MAX),
  };
}

// ---------------------------------------------------------------------------------------------
// Building the report
// ---------------------------------------------------------------------------------------------

const FALLBACK_ANSWER = "I can't answer this one yet; I will look into it and answer at the next check-in.";

/** The room for something addressed to `name`: the first room that person or agent is in. */
function roomFor(view: CardView, name: string): string {
  const key = name.trim().toLowerCase();
  return (view.rooms.find((r) => r.others.includes(key)) ?? view.rooms[0]).id;
}

/** A complete report for the card, following the plan. The writer supplies the free text. */
function buildDraft(view: CardView, plan: CheckInPlan, written: WriterResult): Draft {
  const status = plan.instructionStatus ?? 'in_progress';
  const notes = written.notes_for_others?.trim() ? clip(written.notes_for_others.trim()) : null;
  const workingOn = clip((plan.workingOn ?? written.working_on).trim());

  const rooms: Draft['rooms'] = view.rooms.map((r) => ({ roomId: r.id, workingOn, notes, disagreements: [] }));
  for (const d of plan.disagreements ?? []) {
    const room = rooms.find((r) => r.roomId === roomFor(view, d.with))!;
    if (room.disagreements.length < 3) room.disagreements.push({ with: d.with, about: clip(d.about), my_view: clip(d.my_view) });
  }

  return {
    rooms,
    answers: view.questions.map((q) => ({ questionId: q.id, answer: clip(written.answers[q.id]?.trim() || FALLBACK_ANSWER) })),
    instructions: view.instructions.map((i) => ({
      id: i.id,
      status,
      note: status === 'in_progress' ? clip(written.instruction_notes[i.id]?.trim() || 'Working on it.') : null,
      proof: status === 'done' ? `https://example.com/rehearsal/${i.id}` : null,
    })),
    questions: (plan.questions ?? []).map((q) => ({ to: q.to, text: clip(q.text), roomId: roomFor(view, q.to) })),
  };
}

/** The JSON report for the MCP and REST doors. Empty lists are left out. */
function toReportBody(cardId: string, d: Draft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    card_id: cardId,
    rooms: d.rooms.map((r) => ({
      room_id: r.roomId,
      working_on: r.workingOn,
      ...(r.notes ? { notes_for_others: r.notes } : {}),
      ...(r.disagreements.length ? { disagreements: r.disagreements } : {}),
    })),
  };
  if (d.answers.length) body.answers = d.answers.map((a) => ({ question_id: a.questionId, answer: a.answer }));
  if (d.instructions.length) {
    body.instruction_updates = d.instructions.map((i) => ({
      instruction_id: i.id,
      status: i.status,
      ...(i.note ? { note: i.note } : {}),
      ...(i.proof ? { proof: i.proof } : {}),
    }));
  }
  if (d.questions.length) body.questions = d.questions.map((q) => ({ to: q.to, text: q.text, room_id: q.roomId }));
  return body;
}

/**
 * The form fields for the agent page, named exactly as page-form.ts documents.
 * The page has no disagreement fields, so disagreements in the plan are not sent through this door
 * (they need an API door: MCP or REST). It has room for two new questions.
 */
function toFormFields(cardId: string, d: Draft, hasRoomPicker: boolean): URLSearchParams {
  const f = new URLSearchParams();
  f.set(FIELD.cardId, cardId);
  for (const r of d.rooms) {
    f.set(FIELD.workingOn(r.roomId), r.workingOn);
    if (r.notes) f.set(FIELD.notesForOthers(r.roomId), r.notes);
  }
  for (const a of d.answers) f.set(FIELD.answer(a.questionId), a.answer);
  for (const i of d.instructions) {
    f.set(FIELD.insStatus(i.id), i.status);
    if (i.note) f.set(FIELD.insNote(i.id), i.note);
    if (i.proof) f.set(FIELD.insProof(i.id), i.proof);
  }
  d.questions.slice(0, 2).forEach((q, idx) => {
    const n = idx + 1;
    f.set(FIELD.questionTo(n), q.to);
    f.set(FIELD.questionText(n), q.text);
    if (hasRoomPicker) f.set(FIELD.questionRoom(n), q.roomId);
  });
  return f;
}

// ---------------------------------------------------------------------------------------------
// Door A: MCP
// ---------------------------------------------------------------------------------------------

interface McpClient {
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

/** A fresh client for one scheduled run: v1 SDK (older "initialize" protocol) or v2 (2026-07-28). */
async function connectMcp(door: 'mcp-v1' | 'mcp-v2', baseUrl: string, apiKey: string): Promise<McpClient> {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/mcp`);
  const requestInit = { headers: { Authorization: `Bearer ${apiKey}` } };
  const info = { name: 'tempo-standin', version: '1.0.0' };
  const client: McpClient =
    door === 'mcp-v1'
      ? (new V1Client(info) as unknown as McpClient)
      : (new V2Client(info, { versionNegotiation: { mode: { pin: '2026-07-28' } } } as never) as unknown as McpClient);
  const transport = door === 'mcp-v1' ? new V1Transport(url, { requestInit }) : new V2Transport(url, { requestInit });
  try {
    await (client as unknown as { connect(t: unknown): Promise<void> }).connect(transport);
  } catch (e) {
    await client.close().catch(() => {});
    throw e;
  }
  return client;
}

interface ToolOutcome {
  ok: boolean;
  status: number;
  text: string;
  structured: Record<string, unknown> | null;
}

/** Calls a tool. A result with isError means rejected (status 422); a thrown error carries its HTTP status if it has one. */
async function callTool(client: McpClient, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    const r = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content?: { type?: string; text?: string }[];
      structuredContent?: Record<string, unknown>;
    };
    const text = (r.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n');
    if (r.isError) return { ok: false, status: 422, text, structured: null };
    return { ok: true, status: 200, text, structured: r.structuredContent ?? null };
  } catch (e) {
    return { ok: false, status: statusOf(e), text: describe(e), structured: null };
  }
}

class McpChannel implements Channel {
  private client: McpClient | null = null;
  private readonly door: 'mcp-v1' | 'mcp-v2';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly clean: Clean;

  constructor(door: 'mcp-v1' | 'mcp-v2', baseUrl: string, apiKey: string, clean: Clean) {
    this.door = door;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.clean = clean;
  }

  async open(): Promise<Opened> {
    try {
      this.client = await connectMcp(this.door, this.baseUrl, this.apiKey);
    } catch (e) {
      return failure(statusOf(e), this.clean(describe(e)));
    }
    const r = await callTool(this.client, 'tempo_check_in', {});
    if (!r.ok) return failure(r.status, this.clean(r.text));
    const card = r.structured as CardT | null;
    if (!card || typeof card.card_id !== 'string' || !Array.isArray(card.rooms)) {
      return failure(502, 'tempo_check_in did not return a card.');
    }
    return { view: viewOfCard(card) };
  }

  async send(cardId: string, draft: Draft | null): Promise<Attempt> {
    const r = await callTool(this.client!, 'tempo_report', draft ? toReportBody(cardId, draft) : { card_id: cardId });
    const done = typeof r.structured?.message === 'string' ? r.structured.message : r.text;
    return { ok: r.ok, status: r.status, message: this.clean(r.ok ? done : r.text) };
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = null;
    if (c) await c.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------
// Door B: REST
// ---------------------------------------------------------------------------------------------

interface JsonReply {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
}

/** POSTs JSON with the Bearer key. Never throws: a network failure comes back as status 0. */
async function postJson(baseUrl: string, apiKey: string, path: string, body: unknown): Promise<JsonReply> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'tempo-standin/1.0',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
    } catch {
      /* not JSON: keep the text */
    }
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: describe(e) };
  }
}

function restMessage(r: JsonReply): string {
  const message = (r.json?.error as { message?: unknown } | undefined)?.message;
  if (typeof message === 'string' && message) return message;
  return r.text.trim().slice(0, 300) || `HTTP ${r.status}`;
}

class RestChannel implements Channel {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly clean: Clean;

  constructor(baseUrl: string, apiKey: string, clean: Clean) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.clean = clean;
  }

  async open(): Promise<Opened> {
    const r = await postJson(this.baseUrl, this.apiKey, '/api/v1/agent/check-in', {});
    if (r.status !== 200) return failure(r.status, this.clean(restMessage(r)));
    const card = r.json as CardT | null;
    if (!card || typeof card.card_id !== 'string' || !Array.isArray(card.rooms)) {
      return failure(r.status, 'The check-in answer was not a card.');
    }
    return { view: viewOfCard(card) };
  }

  async send(cardId: string, draft: Draft | null): Promise<Attempt> {
    const r = await postJson(this.baseUrl, this.apiKey, '/api/v1/agent/report', draft ? toReportBody(cardId, draft) : { card_id: cardId });
    const ok = r.status === 200;
    const message = ok && typeof r.json?.message === 'string' ? r.json.message : restMessage(r);
    return { ok, status: r.status, message: this.clean(message) };
  }

  async close(): Promise<void> {}
}

// ---------------------------------------------------------------------------------------------
// Door C: the agent page
// ---------------------------------------------------------------------------------------------

function alertText(doc: El): string {
  return collapse(doc.querySelector('[role="alert"]')?.text);
}

/** The card text a person would read: the page without the form. */
function pageCardText(html: string): string {
  const doc = parse(html);
  for (const n of doc.querySelectorAll('form, style, head')) n.remove();
  return collapse((doc.querySelector('main') ?? doc).text).slice(0, CARD_TEXT_MAX);
}

interface PageView {
  view: CardView;
  hasRoomPicker: boolean;
}

/**
 * Reconstructs the card from the HTML. Ids come from the form field names (the documented
 * contract); texts and "since your last check-in" come from the visible card, best effort.
 */
function readPage(html: string, cardId: string): PageView {
  const doc = parse(html);
  const names = doc.querySelectorAll('[name]').map((n) => n.getAttribute('name') ?? '');
  const unique = (list: (string | undefined)[]): string[] => [...new Set(list.filter((x): x is string => !!x))];
  const roomIds = unique(names.map((n) => /^room\.([^.]+)\.working_on$/.exec(n)?.[1]));
  const questionIds = unique(names.map((n) => /^answer\.(.+)$/.exec(n)?.[1]));
  const instructionIds = unique(names.map((n) => /^ins\.([^.]+)\.status$/.exec(n)?.[1]));

  // Question and instruction texts, from the list items of the card.
  const questionText = new Map<string, string>();
  const instructionText = new Map<string, string>();
  for (const li of doc.querySelectorAll('li')) {
    const id = li.querySelector('strong')?.text.trim() ?? '';
    if (/^q_\d+$/.test(id)) {
      questionText.set(id, li.querySelector('.text')?.text.trim() ?? '');
    } else if (/^ins_\d+$/.test(id)) {
      const doLine = li.querySelectorAll('div').find((d) => d.querySelector('strong')?.text.trim() === 'Do:');
      instructionText.set(id, doLine?.querySelector('.text')?.text.trim() ?? '');
    }
  }

  // Per room: who else is there, and what is new.
  const others = new Map<string, string[]>();
  const since: string[] = [];
  for (const section of doc.querySelectorAll('section.room')) {
    const id = /\(room_id ([^)\s]+)\)/.exec(section.querySelector('h2')?.text ?? '')?.[1];
    if (!id) continue;
    const also = section.querySelectorAll('p').find((p) => p.querySelector('strong')?.text.trim() === 'Also in this room:');
    others.set(
      id,
      (also?.text.replace(/^\s*Also in this room:/, '') ?? '')
        .split(',')
        .map(otherName)
        .filter(Boolean),
    );
    const heading = section.querySelectorAll('h3').find((h) => h.text.trim().startsWith('Since your last check-in'));
    for (const li of heading?.nextElementSibling?.querySelectorAll('li') ?? []) {
      const text = li.text.trim();
      if (text && text !== 'Nothing new.') since.push(text);
    }
  }

  const view: CardView = {
    cardId,
    paused: roomIds.length === 0,
    rooms: roomIds.map((id) => ({ id, others: others.get(id) ?? [] })),
    questions: questionIds.map((id) => ({ id, text: questionText.get(id) ?? '' })),
    instructions: instructionIds.map((id) => ({ id, text: instructionText.get(id) ?? '' })),
    newItemsText: since.join('\n'),
    text: pageCardText(html),
  };
  return { view, hasRoomPicker: names.some((n) => /^question\.\d+\.room_id$/.test(n)) };
}

class PageChannel implements Channel {
  private hasRoomPicker = false;
  private readonly pageLink: string;
  private readonly clean: Clean;

  constructor(pageLink: string, clean: Clean) {
    this.pageLink = pageLink;
    this.clean = clean;
  }

  async open(): Promise<Opened> {
    let status: number;
    let html: string;
    try {
      const res = await fetch(this.pageLink, {
        headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = res.status;
      html = await res.text();
    } catch (e) {
      return failure(0, this.clean(describe(e)));
    }
    if (status !== 200) return failure(status, this.clean(alertText(parse(html)) || `HTTP ${status}`));
    const cardId = parse(html).querySelector('input[name="card_id"]')?.getAttribute('value')?.trim();
    if (!cardId) return failure(status, 'The agent page had no report form (it may be a link-preview page).');
    const page = readPage(html, cardId);
    this.hasRoomPicker = page.hasRoomPicker;
    return { view: page.view };
  }

  async send(cardId: string, draft: Draft | null): Promise<Attempt> {
    const fields = draft ? toFormFields(cardId, draft, this.hasRoomPicker) : new URLSearchParams({ [FIELD.cardId]: cardId });
    try {
      const res = await fetch(this.pageLink, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml' },
        body: fields.toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const doc = parse(await res.text());
      if (res.status === 200) {
        return { ok: true, status: 200, message: this.clean(collapse(doc.querySelector('[role="status"]')?.text) || 'Report received.') };
      }
      return { ok: false, status: res.status, message: this.clean(alertText(doc) || `HTTP ${res.status}`) };
    } catch (e) {
      return { ok: false, status: 0, message: this.clean(describe(e)) };
    }
  }

  async close(): Promise<void> {}
}

// ---------------------------------------------------------------------------------------------
// The stand-in
// ---------------------------------------------------------------------------------------------

export class StandIn {
  readonly name: string;
  private readonly opts: StandInOptions;
  private readonly active = new Set<{ close(): Promise<void> }>();
  private next = 0;
  private readonly secrets: string[];

  constructor(opts: StandInOptions) {
    if (opts.doors.length === 0) throw new Error('A stand-in needs at least one door.');
    this.opts = opts;
    this.name = opts.name;
    let pageToken = '';
    try {
      pageToken = decodeURIComponent(new URL(opts.pageLink).pathname.split('/').filter(Boolean).pop() ?? '');
    } catch {
      /* not a URL: nothing to hide */
    }
    this.secrets = [opts.apiKey, pageToken].filter((s) => s.length >= 8);
  }

  /** Keeps keys and page tokens out of every message this stand-in returns. */
  private readonly clean: Clean = (text) => this.secrets.reduce((t, s) => t.split(s).join('[hidden]'), text);

  private channel(door: StandInDoor): Channel {
    const { baseUrl, apiKey, pageLink } = this.opts;
    if (door === 'rest') return new RestChannel(baseUrl, apiKey, this.clean);
    if (door === 'page') return new PageChannel(pageLink, this.clean);
    return new McpChannel(door, baseUrl, apiKey, this.clean);
  }

  /** Opens a card through the next door in the rotation and reports on it, following the plan. */
  async checkIn(plan: CheckInPlan = {}): Promise<CheckInOutcome> {
    const door = this.opts.doors[this.next++ % this.opts.doors.length];
    const channel = this.channel(door);
    this.active.add(channel);
    try {
      const opened = await channel.open();
      // A card that could not be opened is reported as one failed attempt with no card id.
      if ('failure' in opened) {
        return { door, cardId: '', questionIds: [], instructionIds: [], roomIds: [], newItemsText: '', attempts: [opened.failure] };
      }
      const view = opened.view;
      const outcome: CheckInOutcome = {
        door,
        cardId: view.cardId,
        questionIds: view.questions.map((q) => q.id),
        instructionIds: view.instructions.map((i) => i.id),
        roomIds: view.rooms.map((r) => r.id),
        newItemsText: view.newItemsText,
        attempts: [],
      };

      // A paused card needs only an acknowledgement: just the card_id.
      if (view.paused) {
        outcome.attempts.push(await channel.send(view.cardId, null));
        return outcome;
      }

      const written = await this.opts.writer.write({
        agentName: this.name,
        cardText: view.text,
        questions: view.questions,
        instructions: view.instructions,
      });
      const full = buildDraft(view, plan, written);
      // Misbehavior: leave the answers out first; the corrected report follows with the same card id.
      if (plan.skipAnswersFirst && view.questions.length > 0) {
        outcome.attempts.push(await channel.send(view.cardId, { ...full, answers: [] }));
      }
      outcome.attempts.push(await channel.send(view.cardId, full));
      return outcome;
    } finally {
      this.active.delete(channel);
      await channel.close();
    }
  }

  /** tempo_post through REST. Returns the HTTP status and message. */
  async post(input: { kind?: 'message' | 'question' | 'note'; text: string; to?: string; room_id?: string }): Promise<Attempt & { id: string | null }> {
    const r = await postJson(this.opts.baseUrl, this.opts.apiKey, '/api/v1/agent/post', input);
    const ok = r.status === 200;
    const message = ok && typeof r.json?.message === 'string' ? r.json.message : restMessage(r);
    return { ok, status: r.status, message: this.clean(message), id: ok && typeof r.json?.id === 'string' ? r.json.id : null };
  }

  /** tempo_whoami through MCP (v1 client). */
  async whoami(): Promise<Attempt> {
    let client: McpClient;
    try {
      client = await connectMcp('mcp-v1', this.opts.baseUrl, this.opts.apiKey);
    } catch (e) {
      return { ok: false, status: statusOf(e), message: this.clean(describe(e)) };
    }
    const handle = { close: () => client.close() };
    this.active.add(handle);
    try {
      const r = await callTool(client, 'tempo_whoami', {});
      return { ok: r.ok, status: r.status, message: this.clean(r.text) };
    } finally {
      this.active.delete(handle);
      await client.close().catch(() => {});
    }
  }

  /** Closes any client that is still open. */
  async close(): Promise<void> {
    const open = [...this.active];
    this.active.clear();
    await Promise.all(open.map((c) => c.close().catch(() => {})));
  }
}

// ---------------------------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------------------------

const TOPICS = [
  'pricing page copy',
  'launch announcement email',
  'onboarding checklist',
  'demo video script',
  'FAQ section',
  'release changelog',
  'landing page hero section',
  'press kit',
  'beta feedback summary',
  'launch day social posts',
];
const VERBS = ['Drafting', 'Reviewing', 'Polishing', 'Outlining', 'Proofreading', 'Tightening'];
const NOTES = [
  'The latest draft is in the shared doc; tell me if the tone is off.',
  'Pricing numbers are placeholders until the tiers are final.',
  "I reused last round's structure so the changes are easy to compare.",
  'Nothing is blocking me; a second pair of eyes on the headline would help.',
  'Screenshots are still the old ones; I will swap them when the build is final.',
  'I kept each section under 150 words so it fits on one screen.',
];
const REPLIES = [
  "I'd go with Team; most trials convert to it.",
  'I would keep it simple and ship the shorter version first.',
  'I do not have the numbers yet; I will check before the next check-in.',
  'Yes, that works for me. I will confirm it in the doc.',
  'Not yet. I would wait for the final screenshots first.',
  'Either is fine; I lean toward the first one because it is easier to explain.',
];
const INSTRUCTION_NOTES = [
  'Started on it; first draft by the next check-in.',
  'Working through the outline now; no blockers so far.',
  'Making progress; I will share a draft in the doc next time.',
];

/** A small stable string hash (FNV-1a). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Short quote of a question: single line, at most 60 characters. */
function shortQuote(text: string): string {
  const t = collapse(text);
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
}

/** No network: deterministic, plausible text for a small product launch. Varies by agent name, call count and seed. */
export class ScriptedWriter implements StandInWriter {
  readonly label: string;
  private readonly seed: number;
  private readonly calls = new Map<string, number>();

  constructor(seed?: number) {
    this.seed = seed ?? 0;
    this.label = seed === undefined ? 'Scripted' : `Scripted (seed ${seed})`;
  }

  write: StandInWriter['write'] = async (input) => {
    const n = (this.calls.get(input.agentName) ?? 0) + 1;
    this.calls.set(input.agentName, n);
    const h = hash(`${this.seed}:${input.agentName}`);
    // Different lists use different parts of the hash so they do not move in lock-step.
    const at = <T>(list: T[], shift: number, extra = 0): T => list[((h >>> shift) + n * 7 + extra) % list.length];

    const answers: Record<string, string> = {};
    input.questions.forEach((q, i) => {
      answers[q.id] = `About '${shortQuote(q.text)}': ${at(REPLIES, 4, i)}`;
    });
    const instruction_notes: Record<string, string> = {};
    input.instructions.forEach((ins, i) => {
      instruction_notes[ins.id] = at(INSTRUCTION_NOTES, 8, i);
    });
    return {
      working_on: `${at(VERBS, 0)} the ${at(TOPICS, 2)} (round ${n}).`,
      notes_for_others: (h + n) % 4 === 3 ? null : at(NOTES, 6),
      answers,
      instruction_notes,
    };
  };
}

const WRITER_SCHEMA = {
  type: 'object',
  properties: {
    working_on: { type: 'string' },
    notes_for_others: { type: ['string', 'null'] },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { question_id: { type: 'string' }, answer: { type: 'string' } },
        required: ['question_id', 'answer'],
        additionalProperties: false,
      },
    },
    instruction_notes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { instruction_id: { type: 'string' }, note: { type: 'string' } },
        required: ['instruction_id', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['working_on', 'notes_for_others', 'answers', 'instruction_notes'],
  additionalProperties: false,
};

const WRITER_SYSTEM =
  'You are a stand-in agent in a Tempo rehearsal: a dry run of a private control room where AI agents check in on a schedule. ' +
  'You are working on a small product launch (pricing page, launch email, FAQ, onboarding). ' +
  'Write short, plausible updates of one or two sentences each. Answer every question you are given, using its exact id. ' +
  'Give a note for every instruction you are given, using its exact id. ' +
  'Do not include personal data: no real names, email addresses, phone numbers, addresses, or credentials.';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Checks the model's JSON and turns the lists into the maps the writer contract uses. Throws on anything unusable. */
function readWriterJson(raw: unknown, questionIds: string[]): WriterResult {
  if (!isRecord(raw)) throw new Error('not an object');
  const workingOn = typeof raw.working_on === 'string' ? raw.working_on.trim() : '';
  if (!workingOn) throw new Error('no working_on');
  const notes = typeof raw.notes_for_others === 'string' && raw.notes_for_others.trim() ? raw.notes_for_others.trim() : null;
  if (!Array.isArray(raw.answers)) throw new Error('no answers');
  const answers: Record<string, string> = {};
  for (const a of raw.answers) {
    if (isRecord(a) && typeof a.question_id === 'string' && typeof a.answer === 'string' && a.answer.trim()) answers[a.question_id] = clip(a.answer.trim());
  }
  for (const id of questionIds) if (!answers[id]) throw new Error(`no answer for ${id}`);
  const instruction_notes: Record<string, string> = {};
  if (Array.isArray(raw.instruction_notes)) {
    for (const n of raw.instruction_notes) {
      if (isRecord(n) && typeof n.instruction_id === 'string' && typeof n.note === 'string' && n.note.trim()) instruction_notes[n.instruction_id] = clip(n.note.trim());
    }
  }
  return { working_on: clip(workingOn), notes_for_others: notes ? clip(notes) : null, answers, instruction_notes };
}

/** Asks Claude for the free text. On any failure the whole result comes from the fallback writer. */
export class ClaudeWriter implements StandInWriter {
  readonly label: string;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly fallback: StandInWriter;

  constructor(apiKey: string, model: string, fallback: StandInWriter, baseURL?: string) {
    this.label = `Claude (${model})`;
    this.model = model;
    this.fallback = fallback;
    this.client = new Anthropic({ apiKey, baseURL, timeout: 30000, maxRetries: 1 });
  }

  write: StandInWriter['write'] = async (input) => {
    try {
      const prompt = [
        `You are the agent "${input.agentName}". This is your briefing card:`,
        input.cardText || '(nothing new)',
        `Questions for you:\n${input.questions.map((q) => `- ${q.id}: ${q.text}`).join('\n') || '(none)'}`,
        `Instructions for you:\n${input.instructions.map((i) => `- ${i.id}: ${i.text}`).join('\n') || '(none)'}`,
        'Write your check-in: what you are working on now, an optional note for the others, an answer to every question, and a note for every instruction.',
      ].join('\n\n');
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8000,
        system: WRITER_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema: WRITER_SCHEMA } },
      });
      const block = response.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text') throw new Error('no text in the answer');
      return readWriterJson(JSON.parse(block.text), input.questions.map((q) => q.id));
    } catch {
      return this.fallback.write(input);
    }
  };
}

export type { CardT };
