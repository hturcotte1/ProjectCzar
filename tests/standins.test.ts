import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { count, makeWorld, type World } from './helpers.js';
import { personPost } from '../src/server/services/people-actions.js';
import { addAgentToRoom, createRoom, setRoomPaused } from '../src/server/services/manage.js';
import { ClaudeWriter, ScriptedWriter, StandIn, type StandInDoor } from '../src/server/rehearsal/standins.js';

/**
 * The rehearsal stand-ins drive the real doors over real HTTP on localhost: the official MCP
 * clients (v1 and v2), plain fetch for REST, and a form post for the agent page.
 */

const DOORS: StandInDoor[] = ['mcp-v1', 'mcp-v2', 'rest', 'page'];

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c().catch(() => {});
});

interface Setup {
  w: World;
  url: string;
  qid: string;
  iid: string;
}

/** A world listening on a random local port, with one question and one instruction for Muse Henry. */
async function setup(): Promise<Setup> {
  const w = await makeWorld();
  const url = await w.app.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(() => w.app.close());
  const q = personPost(w.ctx, w.sam, w.room.id, { kind: 'question', to: 'Muse Henry', text: 'Which tier should the launch page lead with?' });
  const i = personPost(w.ctx, w.henry, w.room.id, { kind: 'instruction', to: 'Muse Henry', text: 'Write the FAQ section.', done_when: 'The FAQ is in the doc.' });
  return { w, url, qid: q.ids[0], iid: i.ids[0] };
}

function standIn(s: Setup, doors: StandInDoor[], which: 'a' | 'b' = 'a'): StandIn {
  const agent = s.w[which];
  const si = new StandIn({
    name: agent.agent.name,
    baseUrl: s.url,
    apiKey: agent.apiKey,
    pageLink: `${s.url}/a/${agent.pageToken}`,
    doors,
    writer: new ScriptedWriter(),
  });
  cleanups.push(() => si.close());
  return si;
}

const question = (s: Setup) => s.w.ctx.db.prepare('SELECT status, answer FROM questions WHERE id = ?').get(s.qid) as { status: string; answer: string | null };
const instruction = (s: Setup) => s.w.ctx.db.prepare('SELECT status, proof, status_note FROM instructions WHERE id = ?').get(s.iid) as { status: string; proof: string | null; status_note: string | null };

describe('stand-in check-ins through every door', () => {
  for (const door of DOORS) {
    it(`${door}: completes a check-in with a question and an instruction on the card`, async () => {
      const s = await setup();
      const outcome = await standIn(s, [door]).checkIn();

      expect(outcome.door).toBe(door);
      expect(outcome.cardId).toMatch(/^card_\d+$/);
      expect(outcome.questionIds).toEqual([s.qid]);
      expect(outcome.instructionIds).toEqual([s.iid]);
      expect(outcome.roomIds).toEqual([s.w.room.id]);
      expect(outcome.attempts).toHaveLength(1);
      expect(outcome.attempts[0]).toMatchObject({ ok: true, status: 200 });
      expect(outcome.attempts[0].message).toMatch(/Report accepted/);

      // The answer and the instruction status are stored, whichever door was used.
      const q = question(s);
      expect(q.status).toBe('answered');
      expect(q.answer).toContain("About 'Which tier should the launch page lead with?'");
      expect(instruction(s).status).toBe('in_progress');
      const row = s.w.ctx.db.prepare('SELECT door, body FROM reports WHERE card_id = ?').get(outcome.cardId) as { door: string; body: string };
      expect(row.door).toBe(door.startsWith('mcp') ? 'mcp' : door);
      expect(JSON.parse(row.body).rooms[0].working_on).toMatch(/\(round 1\)\.$/);
    });

    it(`${door}: skipAnswersFirst is rejected once, then the corrected report is accepted`, async () => {
      const s = await setup();
      const outcome = await standIn(s, [door]).checkIn({ skipAnswersFirst: true });

      expect(outcome.attempts).toHaveLength(2);
      expect(outcome.attempts[0].ok).toBe(false);
      expect(outcome.attempts[0].status).toBe(422);
      expect(outcome.attempts[0].message).toContain('an answer to q_');
      expect(outcome.attempts[1]).toMatchObject({ ok: true, status: 200 });
      // Same card, one report; nothing from the rejected attempt was kept.
      expect(count(s.w.ctx, 'SELECT COUNT(*) n FROM reports WHERE card_id = ?', outcome.cardId)).toBe(1);
      expect(count(s.w.ctx, 'SELECT COUNT(*) n FROM reports')).toBe(1);
      expect(question(s).status).toBe('answered');
    });

    it(`${door}: follows the plan (done with proof, new question, working_on)`, async () => {
      const s = await setup();
      const outcome = await standIn(s, [door]).checkIn({
        instructionStatus: 'done',
        workingOn: 'Writing the FAQ section.',
        questions: [{ to: 'Muse Sam', text: 'Can you review the FAQ?' }],
      });
      expect(outcome.attempts.map((a) => a.ok)).toEqual([true]);
      const ins = instruction(s);
      expect(ins.status).toBe('done');
      expect(ins.proof).toBe(`https://example.com/rehearsal/${s.iid}`);
      const asked = s.w.ctx.db.prepare("SELECT text, target_kind FROM questions WHERE asker_kind = 'agent'").all() as { text: string; target_kind: string }[];
      expect(asked).toEqual([{ text: 'Can you review the FAQ?', target_kind: 'agent' }]);
      const work = s.w.ctx.db.prepare('SELECT working_on FROM report_rooms').get() as { working_on: string };
      expect(work.working_on).toBe('Writing the FAQ section.');
    });
  }

  it('skipAnswersFirst with no questions on the card sends one complete attempt', async () => {
    const w = await makeWorld();
    const url = await w.app.listen({ port: 0, host: '127.0.0.1' });
    cleanups.push(() => w.app.close());
    const s: Setup = { w, url, qid: '', iid: '' };
    for (const door of DOORS) {
      const outcome = await standIn(s, [door]).checkIn({ skipAnswersFirst: true });
      expect(outcome.questionIds).toEqual([]);
      expect(outcome.attempts).toHaveLength(1);
      expect(outcome.attempts[0].ok).toBe(true);
      w.clock.advanceMinutes(60);
    }
  });

  for (const door of DOORS) {
    it(`${door}: reports on every active room and puts new questions in a room that fits`, async () => {
      const s = await setup();
      const henry = { kind: 'person' as const, id: s.w.henry.id, name: 'Henry' };
      const support = createRoom(s.w.ctx, s.w.henry, { name: 'Support', goal: 'Answer launch-week questions.' });
      addAgentToRoom(s.w.ctx, henry, s.w.a.agent.id, support.id);
      const q2 = personPost(s.w.ctx, s.w.henry, support.id, { kind: 'question', to: 'Muse Henry', text: 'What is the refund policy?' });

      const outcome = await standIn(s, [door]).checkIn({
        questions: [
          { to: 'Muse Sam', text: 'Can you review the FAQ?' },
          { to: 'people', text: 'Is Friday still the date?' },
        ],
      });
      expect(outcome.attempts.map((a) => a.ok)).toEqual([true]);
      expect([...outcome.roomIds].sort()).toEqual([s.w.room.id, support.id].sort());
      expect([...outcome.questionIds].sort()).toEqual([s.qid, q2.ids[0]].sort());
      expect(count(s.w.ctx, 'SELECT COUNT(*) n FROM report_rooms')).toBe(2);
      expect(count(s.w.ctx, "SELECT COUNT(*) n FROM questions WHERE status = 'answered'")).toBe(2);
      // Muse Sam is only in Launch, so that question goes there.
      const sam = s.w.ctx.db.prepare("SELECT room_id FROM questions WHERE text = 'Can you review the FAQ?'").get() as { room_id: string };
      expect(sam.room_id).toBe(s.w.room.id);
      expect(count(s.w.ctx, "SELECT COUNT(*) n FROM questions WHERE asker_kind = 'agent'")).toBe(2);
    });
  }

  it('sends disagreements through an API door', async () => {
    const s = await setup();
    const outcome = await standIn(s, ['rest']).checkIn({
      disagreements: [{ with: 'Muse Sam', about: 'Headline wording', my_view: 'Shorter is better.' }],
    });
    expect(outcome.attempts[0].ok).toBe(true);
    const row = s.w.ctx.db.prepare("SELECT title, context FROM decisions WHERE source = 'disagreement'").get() as { title: string; context: string };
    expect(row.title).toContain('Muse Sam');
    expect(row.context).toContain('Shorter is better.');
  });

  it('a paused room: only the card_id is sent and it is acknowledged', async () => {
    for (const door of DOORS) {
      const s = await setup();
      setRoomPaused(s.w.ctx, { kind: 'person', id: s.w.henry.id, name: 'Henry' }, s.w.room.id, true);
      const outcome = await standIn(s, [door]).checkIn({ skipAnswersFirst: true });
      expect(outcome.roomIds).toEqual([]);
      expect(outcome.attempts).toHaveLength(1);
      expect(outcome.attempts[0].ok).toBe(true);
      expect(outcome.attempts[0].message).toMatch(/Tempo is paused/);
      expect(question(s).status).toBe('open');
    }
  });

  it('reports what was new on the card (REST, then the page)', async () => {
    const s = await setup();
    const si = standIn(s, ['rest', 'page']);
    await si.checkIn();
    s.w.clock.advanceMinutes(60);
    personPost(s.w.ctx, s.w.sam, s.w.room.id, { kind: 'note', to: 'room', text: 'New hero image is in the doc.' });
    const second = await si.checkIn();
    expect(second.door).toBe('page');
    expect(second.attempts[0].ok).toBe(true);
    expect(second.newItemsText).toContain('New hero image is in the doc.');
  });

  it('rotates through the doors, one per check-in', async () => {
    const s = await setup();
    const si = standIn(s, ['rest', 'page']);
    const doors: StandInDoor[] = [];
    for (let i = 0; i < 3; i++) {
      const outcome = await si.checkIn();
      expect(outcome.attempts.every((a) => a.ok)).toBe(true);
      doors.push(outcome.door);
      s.w.clock.advanceMinutes(60);
    }
    expect(doors).toEqual(['rest', 'page', 'rest']);
    expect(count(s.w.ctx, 'SELECT COUNT(*) n FROM reports')).toBe(3);
  });

  it('a card that cannot be opened comes back as one failed attempt, without the key in the message', async () => {
    const s = await setup();
    for (const door of DOORS) {
      const si = new StandIn({
        name: 'Muse Henry',
        baseUrl: s.url,
        apiKey: 'tempo_ak_not_a_real_key_0000',
        pageLink: `${s.url}/a/not-a-real-page-token`,
        doors: [door],
        writer: new ScriptedWriter(),
      });
      cleanups.push(() => si.close());
      const outcome = await si.checkIn();
      expect(outcome.cardId).toBe('');
      expect(outcome.attempts).toHaveLength(1);
      expect(outcome.attempts[0].ok).toBe(false);
      expect(outcome.attempts[0].status).toBeGreaterThanOrEqual(400);
      expect(outcome.attempts[0].message).not.toContain('tempo_ak_not_a_real_key_0000');
      expect(outcome.attempts[0].message).not.toContain('not-a-real-page-token');
      expect(outcome.attempts[0].message.length).toBeGreaterThan(0);
    }
  });
});

describe('stand-in post and whoami', () => {
  it('post() sends a question to people and returns its id', async () => {
    const s = await setup();
    const r = await standIn(s, ['rest']).post({ kind: 'question', to: 'people', text: 'Is the Friday date firm?' });
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(r.id).toMatch(/^q_\d+$/);
    const row = s.w.ctx.db.prepare('SELECT text, target_kind, asker_kind FROM questions WHERE id = ?').get(r.id) as { text: string; target_kind: string; asker_kind: string };
    expect(row).toEqual({ text: 'Is the Friday date firm?', target_kind: 'people', asker_kind: 'agent' });
  });

  it('post() reports a refusal with its status and message', async () => {
    const s = await setup();
    const r = await standIn(s, ['rest']).post({ kind: 'question', text: 'Who should answer this?' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(r.id).toBeNull();
    expect(r.message.length).toBeGreaterThan(0);
  });

  it('whoami() connects through MCP and says who the agent is', async () => {
    const s = await setup();
    const r = await standIn(s, ['rest']).whoami();
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(r.message).toMatch(/Connected to Tempo as Muse Henry/);
  });

  it('whoami() with a bad key fails without leaking it', async () => {
    const s = await setup();
    const si = new StandIn({ name: 'x', baseUrl: s.url, apiKey: 'tempo_ak_not_a_real_key_0000', pageLink: `${s.url}/a/x`, doors: ['rest'], writer: new ScriptedWriter() });
    const r = await si.whoami();
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.message).not.toContain('tempo_ak_not_a_real_key_0000');
  });
});

describe('ScriptedWriter', () => {
  const input = {
    agentName: 'Muse Henry',
    cardText: '',
    questions: [{ id: 'q_1', text: 'Which tier?' }],
    instructions: [{ id: 'ins_1', text: 'Write the FAQ.' }],
  };

  it('is deterministic for the same agent, seed and call number', async () => {
    const a = new ScriptedWriter(7);
    const b = new ScriptedWriter(7);
    expect(await a.write(input)).toEqual(await b.write(input));
    expect(await a.write(input)).toEqual(await b.write(input));
  });

  it('varies by call, by agent name and by seed, and quotes the question', async () => {
    const w = new ScriptedWriter();
    const first = await w.write(input);
    const second = await w.write(input);
    expect(first.working_on).toMatch(/^[A-Z][a-z]+ the .+ \(round 1\)\.$/);
    expect(second.working_on).toMatch(/\(round 2\)\.$/);
    expect(second.working_on).not.toBe(first.working_on);
    expect(first.answers.q_1).toMatch(/^About 'Which tier\?': .+/);
    expect(first.instruction_notes.ins_1.length).toBeGreaterThan(10);

    const names = new Set<string>();
    for (const agentName of ['Muse Henry', 'Muse Sam', 'Scout', 'Scribe', 'Rook']) {
      names.add((await new ScriptedWriter().write({ ...input, agentName })).working_on);
    }
    expect(names.size).toBeGreaterThan(1);
    const seeds = new Set<string>();
    for (let seed = 0; seed < 5; seed++) seeds.add((await new ScriptedWriter(seed).write(input)).working_on);
    expect(seeds.size).toBeGreaterThan(1);
  });

  it('needs nothing from the network', async () => {
    const w = new ScriptedWriter();
    expect(w.label).toBe('Scripted');
    const r = await w.write({ agentName: 'x', cardText: '', questions: [], instructions: [] });
    expect(r.answers).toEqual({});
    expect(r.instruction_notes).toEqual({});
  });
});

/** A local stand-in for the Anthropic API, so no test touches the real one. */
async function fakeAnthropic(reply: (body: any) => { status: number; body: unknown }): Promise<{ baseURL: string; requests: any[] }> {
  const requests: any[] = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const body = JSON.parse(data || '{}');
      requests.push({ url: req.url, body });
      const r = reply(body);
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return { baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

const message = (text: string) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-test',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

describe('ClaudeWriter', () => {
  const input = {
    agentName: 'Muse Henry',
    cardText: 'Room "Launch": Ship the launch page by Friday.',
    questions: [{ id: 'q_1', text: 'Which tier?' }],
    instructions: [{ id: 'ins_1', text: 'Write the FAQ.' }],
  };

  it('has a label with the model name', () => {
    expect(new ClaudeWriter('sk-ant-test', 'claude-test', new ScriptedWriter()).label).toBe('Claude (claude-test)');
  });

  it('falls back to the scripted writer when the API is unreachable', async () => {
    const started = Date.now();
    const writer = new ClaudeWriter('sk-ant-test', 'claude-test', new ScriptedWriter(), 'http://127.0.0.1:9');
    const result = await writer.write(input);
    expect(result).toEqual(await new ScriptedWriter().write(input));
    expect(result.answers.q_1).toContain('Which tier?');
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('asks for structured JSON and uses what comes back', async () => {
    const api = await fakeAnthropic(() => ({
      status: 200,
      body: message(
        JSON.stringify({
          working_on: 'Drafting the FAQ and checking the tier names.',
          notes_for_others: null,
          answers: [{ question_id: 'q_1', answer: 'Team, because most trials convert to it.' }],
          instruction_notes: [{ instruction_id: 'ins_1', note: 'Outline done; draft next.' }],
        }),
      ),
    }));
    const writer = new ClaudeWriter('sk-ant-test', 'claude-test', new ScriptedWriter(), api.baseURL);
    const result = await writer.write(input);
    expect(result).toEqual({
      working_on: 'Drafting the FAQ and checking the tier names.',
      notes_for_others: null,
      answers: { q_1: 'Team, because most trials convert to it.' },
      instruction_notes: { ins_1: 'Outline done; draft next.' },
    });

    expect(api.requests).toHaveLength(1);
    const sent = api.requests[0];
    expect(sent.url).toBe('/v1/messages');
    expect(sent.body.model).toBe('claude-test');
    expect(sent.body.output_config.format.type).toBe('json_schema');
    const schema = sent.body.output_config.format.schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['working_on', 'notes_for_others', 'answers', 'instruction_notes']);
    expect(schema.properties.notes_for_others.type).toEqual(['string', 'null']);
    expect(JSON.stringify(sent.body.messages)).toContain('q_1: Which tier?');
    expect(sent.body.system).toMatch(/personal data/);
  });

  it('uses the fallback for the whole result when an answer is missing, the JSON is bad, or the API errors', async () => {
    const replies: { status: number; body: unknown }[] = [
      { status: 200, body: message(JSON.stringify({ working_on: 'x', notes_for_others: null, answers: [], instruction_notes: [] })) },
      { status: 200, body: message('this is not json') },
      { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'nope' } } },
    ];
    for (const reply of replies) {
      const api = await fakeAnthropic(() => reply);
      const writer = new ClaudeWriter('sk-ant-test', 'claude-test', new ScriptedWriter(), api.baseURL);
      expect(await writer.write(input)).toEqual(await new ScriptedWriter().write(input));
    }
  });

  it('drives a stand-in end to end', async () => {
    const s = await setup();
    const api = await fakeAnthropic((body) => {
      const ids = [...JSON.stringify(body.messages).matchAll(/(q_\d+): /g)].map((m) => m[1]);
      return {
        status: 200,
        body: message(
          JSON.stringify({
            working_on: 'Polishing the launch email.',
            notes_for_others: 'Draft is in the doc.',
            answers: ids.map((id) => ({ question_id: id, answer: 'Lead with the Team tier.' })),
            instruction_notes: [],
          }),
        ),
      };
    });
    const si = new StandIn({
      name: 'Muse Henry',
      baseUrl: s.url,
      apiKey: s.w.a.apiKey,
      pageLink: `${s.url}/a/${s.w.a.pageToken}`,
      doors: ['page'],
      writer: new ClaudeWriter('sk-ant-test', 'claude-test', new ScriptedWriter(), api.baseURL),
    });
    cleanups.push(() => si.close());
    const outcome = await si.checkIn();
    expect(outcome.attempts[0].ok).toBe(true);
    expect(question(s).answer).toBe('Lead with the Team tier.');
    expect(instruction(s).status_note).toBe('Working on it.');
  });
});
