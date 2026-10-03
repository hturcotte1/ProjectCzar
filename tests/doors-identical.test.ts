import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parse } from 'node-html-parser';
import { checkIn, makeWorld, report, rest, type World } from './helpers.js';
import { personPost } from '../src/server/services/people-actions.js';

/**
 * Definition of done #2: an agent completes a full check-in through each of the three doors, and
 * the stored records match. Three identical worlds; the same agent does the same check-in through
 * a different door in each; the stored records are compared field by field.
 */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c().catch(() => {});
});

async function world(): Promise<World & { qid: string; iid: string }> {
  const w = await makeWorld();
  const q = personPost(w.ctx, w.sam, w.room.id, { kind: 'question', to: 'Muse Henry', text: 'Which headline did you pick?' });
  const i = personPost(w.ctx, w.henry, w.room.id, { kind: 'instruction', to: 'Muse Henry', text: 'Write the FAQ section.', done_when: 'The FAQ is in the doc.' });
  return { ...w, qid: q.ids[0], iid: i.ids[0] };
}

const WORKING = 'Writing the FAQ section and checking the headline.';
const FINISHED = { what: 'Headline options', proof: 'https://docs.example.com/launch#headlines' };
const NOTES = 'FAQ draft is half done.';
const ANSWER = 'Option two: "Plan launches together".';
const PROOF = 'https://docs.example.com/launch#faq';

function reportBody(w: { room: { id: string }; qid: string; iid: string }, cardId: string) {
  return {
    card_id: cardId,
    rooms: [{ room_id: w.room.id, working_on: WORKING, finished: [FINISHED], notes_for_others: NOTES }],
    answers: [{ question_id: w.qid, answer: ANSWER }],
    instruction_updates: [{ instruction_id: w.iid, status: 'done', proof: PROOF }],
    questions: [{ to: 'Muse Sam', text: 'Can you review the FAQ?' }],
  };
}

function snapshot(w: World) {
  const db = w.ctx.db;
  const strip = (rows: any[], drop: string[]) =>
    rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))));
  const TIMES = ['created_at', 'updated_at', 'issued_at', 'completed_at', 'expires_at', 'answered_at', 'last_movement_at', 'at', 'door', 'feed_seq', 'answer_feed_seq', 'last_seen_at', 'first_seen_at', 'last_card_at', 'last_checkin_at', 'status_changed_at'];
  return {
    reports: strip(db.prepare('SELECT * FROM reports').all() as any[], TIMES).map((r) => ({ ...r, body: JSON.parse(r.body) })),
    report_rooms: strip(db.prepare('SELECT * FROM report_rooms').all() as any[], TIMES),
    questions: strip(db.prepare('SELECT * FROM questions ORDER BY id').all() as any[], TIMES),
    instructions: strip(db.prepare('SELECT * FROM instructions ORDER BY id').all() as any[], TIMES),
    instruction_events: strip(db.prepare('SELECT * FROM instruction_events ORDER BY id').all() as any[], TIMES),
    cards: strip(db.prepare('SELECT id, agent_id, status, requirements FROM cards').all() as any[], TIMES),
    feed: (db.prepare('SELECT kind, actor_kind, actor_id, target_agent_id, thread_id, ref_id, text, data FROM feed_events ORDER BY seq').all() as any[]).map((r) => {
      const data = JSON.parse(r.data);
      delete data.door;
      return { ...r, data };
    }),
    agent: strip([db.prepare('SELECT id, status, last_checkin_card_id FROM agents WHERE id = ?').get(w.a.agent.id)], TIMES),
  };
}

describe('all three doors behave identically', () => {
  it('stores the same records for the same check-in via REST, MCP and the agent page', async () => {
    // Door B: REST.
    const wb = await world();
    const cb = (await checkIn(wb, wb.a.apiKey)).body;
    const rb = await report(wb, wb.a.apiKey, reportBody(wb, cb.card_id));
    expect(rb.status).toBe(200);

    // Door A: MCP with the official client.
    const wa = await world();
    const url = await wa.app.listen({ port: 0, host: '127.0.0.1' });
    cleanups.push(() => wa.app.close());
    const client = new Client({ name: 'doors-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${wa.a.apiKey}` } } }));
    cleanups.unshift(() => client.close());
    const ca = (await client.callTool({ name: 'tempo_check_in', arguments: {} })).structuredContent as any;
    const ra = await client.callTool({ name: 'tempo_report', arguments: reportBody(wa, ca.card_id) });
    expect(ra.isError).toBeFalsy();

    // Door C: the agent page, filling in the real HTML form.
    const wc = await world();
    const page = await wc.app.inject({ method: 'GET', url: `/a/${wc.a.pageToken}`, headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140' } });
    expect(page.statusCode).toBe(200);
    const doc = parse(page.body);
    const forms = doc.querySelectorAll('form');
    expect(forms.length).toBe(1);
    const fields = new URLSearchParams();
    const set = (name: string, value: string) => {
      expect(doc.querySelector(`[name="${name}"]`), `form field ${name}`).toBeTruthy();
      fields.set(name, value);
    };
    set('card_id', doc.querySelector('input[name="card_id"]')!.getAttribute('value')!);
    set(`room.${wc.room.id}.working_on`, WORKING);
    set(`room.${wc.room.id}.finished.1.what`, FINISHED.what);
    set(`room.${wc.room.id}.finished.1.proof`, FINISHED.proof);
    set(`room.${wc.room.id}.notes_for_others`, NOTES);
    set(`answer.${wc.qid}`, ANSWER);
    set(`ins.${wc.iid}.status`, 'done');
    set(`ins.${wc.iid}.proof`, PROOF);
    set('question.1.to', 'Muse Sam');
    set('question.1.text', 'Can you review the FAQ?');
    const posted = await wc.app.inject({
      method: 'POST',
      url: `/a/${wc.a.pageToken}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 Chrome/140' },
      payload: fields.toString(),
    });
    expect(posted.statusCode).toBe(200);
    expect(posted.body).toContain('Next check-in due');

    const sb = snapshot(wb);
    const sa = snapshot(wa);
    const sc = snapshot(wc);
    expect(sb.report_rooms[0].working_on).toBe(WORKING);
    expect(sa).toEqual(sb);
    expect(sc).toEqual(sb);

    // The doors are recorded, and every request is in each agent's connection log.
    expect((wa.ctx.db.prepare('SELECT door FROM reports').get() as any).door).toBe('mcp');
    expect((wb.ctx.db.prepare('SELECT door FROM reports').get() as any).door).toBe('rest');
    expect((wc.ctx.db.prepare('SELECT door FROM reports').get() as any).door).toBe('page');
    for (const [w, door] of [[wa, 'mcp'], [wb, 'rest'], [wc, 'page']] as const) {
      const actions = (w.ctx.db.prepare("SELECT action FROM connection_log WHERE result = 'ok' AND door = ?").all(door) as any[]).map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(['check_in', 'report']));
    }
  });

  it('rejects the same incomplete report with the same words through every door', async () => {
    const wb = await world();
    const cb = (await checkIn(wb, wb.a.apiKey)).body;
    const restMsg = (await report(wb, wb.a.apiKey, { card_id: cb.card_id })).body.error.message as string;

    const wa = await world();
    const url = await wa.app.listen({ port: 0, host: '127.0.0.1' });
    cleanups.push(() => wa.app.close());
    const client = new Client({ name: 'doors-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${wa.a.apiKey}` } } }));
    cleanups.unshift(() => client.close());
    const ca = (await client.callTool({ name: 'tempo_check_in', arguments: {} })).structuredContent as any;
    const mcpRes = await client.callTool({ name: 'tempo_report', arguments: { card_id: ca.card_id } });
    const mcpMsg = (mcpRes.content as any[])[0].text as string;

    expect(restMsg).toMatch(/^Report not accepted\. Missing:/);
    expect(mcpMsg).toBe(restMsg);

    // Through the page, a form with only the card id gives the same requirement list (worded for the form fields).
    const wc = await world();
    const page = await wc.app.inject({ method: 'GET', url: `/a/${wc.a.pageToken}`, headers: { 'user-agent': 'Mozilla/5.0 Chrome/140' } });
    const cardId = parse(page.body).querySelector('input[name="card_id"]')!.getAttribute('value')!;
    const posted = await wc.app.inject({ method: 'POST', url: `/a/${wc.a.pageToken}`, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 Chrome/140' }, payload: `card_id=${cardId}` });
    expect(posted.statusCode).toBe(422);
    const text = parse(posted.body).querySelector('[role="alert"]')!.text;
    expect(text).toContain('Report not accepted. Missing:');
    expect(text).toContain('a working_on line for room "Launch"');
    expect(text).toContain(wc.qid);
    expect(text).toContain(wc.iid);
    // Same agent-facing check through REST for completeness.
    const who = await rest(wb.app, wb.a.apiKey, 'GET', '/api/v1/agent/whoami');
    expect(who.status).toBe(200);
  });
});
