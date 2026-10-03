import { describe, expect, it } from 'vitest';
import { checkIn, count, fullReport, makeWorld, report, rest } from './helpers.js';
import { personPost } from '../src/server/services/people-actions.js';
import { createRoom, revokeKeys, rotateKey, setRoomPaused, addAgentToRoom } from '../src/server/services/manage.js';
import { estimateTokens } from '../src/server/services/card.js';

describe('check-in service through Door B (REST)', () => {
  it('whoami confirms the connection with name, owner, rooms and schedule', async () => {
    const w = await makeWorld();
    const r = await rest(w.app, w.a.apiKey, 'GET', '/api/v1/agent/whoami');
    expect(r.status).toBe(200);
    expect(r.body.connected).toBe(true);
    expect(r.body.agent.name).toBe('Muse Henry');
    expect(r.body.agent.owner).toBe('Henry');
    expect(r.body.rooms).toEqual([{ room_id: w.room.id, name: 'Launch', paused: false }]);
    expect(r.body.message).toMatch(/Connected to Tempo as Muse Henry/);
    expect(r.body.schedule.text).toMatch(/Monday to Friday/);
    // X-API-Key works too.
    const r2 = await rest(w.app, w.a.apiKey, 'GET', '/api/v1/agent/whoami', undefined, 'x-api-key');
    expect(r2.status).toBe(200);
  });

  it('opens a card and accepts a complete report, storing matching records', async () => {
    const w = await makeWorld();
    const c = await checkIn(w, w.a.apiKey);
    expect(c.status).toBe(200);
    const card = c.body;
    expect(card.card_id).toMatch(/^card_\d+$/);
    expect(card.now_text).toMatch(/Monday 9:00 am Mountain Time/);
    expect(card.about).toMatch(/private workspace run by your owner, Henry/);
    expect(card.rooms[0].goal).toBe('Ship the launch page by Friday.');
    expect(card.rooms[0].limits.ask_a_person_first).toContain('spending money');
    expect(card.you_must_send_back.join(' ')).toMatch(/working_on line for room "Launch"/);

    const rep = await report(w, w.a.apiKey, {
      card_id: card.card_id,
      rooms: [{ room_id: w.room.id, working_on: 'Drafting the hero copy.', finished: [{ what: 'Outline', proof: 'https://docs.example.com/outline' }], notes_for_others: 'Hero copy draft lands by noon.' }],
    });
    expect(rep.status).toBe(200);
    expect(rep.body.ok).toBe(true);
    expect(rep.body.updated).toBe(false);
    expect(rep.body.message).toMatch(/Report accepted/);
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM reports')).toBe(1);
    const rr = w.ctx.db.prepare('SELECT * FROM report_rooms').get() as any;
    expect(rr.working_on).toBe('Drafting the hero copy.');
    expect(JSON.parse(rr.finished)).toEqual([{ what: 'Outline', proof: 'https://docs.example.com/outline' }]);
    expect(count(w.ctx, "SELECT COUNT(*) n FROM feed_events WHERE kind = 'report'")).toBe(1);
    const cardRow = w.ctx.db.prepare('SELECT status FROM cards WHERE id = ?').get(card.card_id) as any;
    expect(cardRow.status).toBe('completed');
    const agent = w.ctx.db.prepare('SELECT last_checkin_at, status FROM agents WHERE id = ?').get(w.a.agent.id) as any;
    expect(agent.last_checkin_at).toBe('2026-10-05T15:00:00.000Z');
    expect(agent.status).toBe('green');
  });

  it('rejects a report missing required items, naming every one, then accepts the corrected report without duplicates', async () => {
    const w = await makeWorld();
    // B asks A a question; a person gives A an instruction.
    const cb = (await checkIn(w, w.b.apiKey)).body;
    await report(w, w.b.apiKey, fullReport(cb, { questions: [{ to: 'Muse Henry', text: 'Which pricing tier are we launching with?' }] }));
    personPost(w.ctx, w.henry, w.room.id, { kind: 'instruction', to: 'Muse Henry', text: 'Draft the launch email.', done_when: 'The draft is in the shared doc.' });

    const card = (await checkIn(w, w.a.apiKey)).body;
    const qid = card.rooms[0].questions_for_you[0].id;
    const iid = card.rooms[0].instructions_for_you[0].id;
    expect(card.rooms[0].instructions_for_you[0].from).toBe('Henry');

    const bad = await report(w, w.a.apiKey, { card_id: card.card_id });
    expect(bad.status).toBe(422);
    expect(bad.body.ok).toBe(false);
    expect(bad.body.error.code).toBe('report_incomplete');
    const msg: string = bad.body.error.message;
    expect(msg).toMatch(/^Report not accepted\. Missing: /);
    expect(msg).toContain('a working_on line for room "Launch"');
    expect(msg).toContain(`an answer to ${qid} ('Which pricing tier are we launching with?') in answers`);
    expect(msg).toContain(`a status for ${iid}`);
    expect(msg).toContain(`same card_id (${card.card_id})`);
    expect(bad.body.error.problems.length).toBe(3);
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM reports WHERE card_id = ?', card.card_id)).toBe(0);

    // done without proof and blocked without a note are also named.
    const bad2 = await report(w, w.a.apiKey, {
      card_id: card.card_id,
      rooms: [{ room_id: w.room.id, working_on: 'x'.repeat(2001) }],
      answers: [{ question_id: qid, answer: 'Pro.' }],
      instruction_updates: [{ instruction_id: iid, status: 'done' }],
    });
    expect(bad2.status).toBe(422);
    expect(bad2.body.error.message).toContain('2,001 characters long; the limit is 2,000');
    expect(bad2.body.error.message).toContain(`proof for ${iid}, which is marked done`);

    const good = await report(w, w.a.apiKey, fullReport(card, { answers: [{ question_id: qid, answer: 'Pro tier.' }] }));
    expect(good.status).toBe(200);
    // Same card again: updates the same report.
    const again = await report(w, w.a.apiKey, fullReport(card, { answers: [{ question_id: qid, answer: 'Pro tier, monthly.' }], questions: [{ to: 'people', text: 'Ok to use the blue logo?' }] }));
    expect(again.status).toBe(200);
    expect(again.body.updated).toBe(true);
    const again2 = await report(w, w.a.apiKey, fullReport(card, { answers: [{ question_id: qid, answer: 'Pro tier, monthly.' }], questions: [{ to: 'people', text: 'Ok to use the blue logo?' }] }));
    expect(again2.body.updated).toBe(true);
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM reports WHERE card_id = ?', card.card_id)).toBe(1);
    expect(count(w.ctx, "SELECT COUNT(*) n FROM feed_events WHERE kind = 'report' AND actor_id = ?", w.a.agent.id)).toBe(1);
    expect(count(w.ctx, "SELECT COUNT(*) n FROM feed_events WHERE kind = 'answer'")).toBe(1);
    expect(count(w.ctx, "SELECT COUNT(*) n FROM questions WHERE text = 'Ok to use the blue logo?'")).toBe(1);
    expect((w.ctx.db.prepare('SELECT answer FROM questions WHERE id = ?').get(qid) as any).answer).toBe('Pro tier, monthly.');
  });

  it("puts A's question on B's next card, blocks B's check-in until answered, and shows the answer to A and in the feed", async () => {
    const w = await makeWorld();
    const ca = (await checkIn(w, w.a.apiKey)).body;
    await report(w, w.a.apiKey, fullReport(ca, { questions: [{ to: 'Muse Sam', text: 'Is the pricing table final?' }] }));
    const qrow = w.ctx.db.prepare("SELECT id FROM questions WHERE text = 'Is the pricing table final?'").get() as any;

    w.clock.advanceMinutes(30);
    const cb = (await checkIn(w, w.b.apiKey)).body;
    expect(cb.rooms[0].questions_for_you).toEqual([expect.objectContaining({ id: qrow.id, from: 'Muse Henry', text: 'Is the pricing table final?' })]);
    const noAnswer = await report(w, w.b.apiKey, { card_id: cb.card_id, rooms: [{ room_id: w.room.id, working_on: 'Pricing table.' }] });
    expect(noAnswer.status).toBe(422);
    expect(noAnswer.body.error.message).toContain(`an answer to ${qrow.id}`);
    const ok = await report(w, w.b.apiKey, { ...fullReport(cb), answers: [{ question_id: qrow.id, answer: "I can't answer this because the CFO hasn't signed off yet." }] });
    expect(ok.status).toBe(200);

    w.clock.advanceMinutes(30);
    const ca2 = (await checkIn(w, w.a.apiKey)).body;
    const answerItem = ca2.rooms[0].since_last_check_in.find((i: any) => i.kind === 'answer');
    expect(answerItem.text).toContain("CFO hasn't signed off");
    expect(answerItem.from).toBe('Muse Sam');
    // B's report also shows up for A.
    expect(ca2.rooms[0].since_last_check_in.some((i: any) => i.kind === 'report' && i.from === 'Muse Sam')).toBe(true);
    const feedAnswer = w.ctx.db.prepare("SELECT * FROM feed_events WHERE kind = 'answer'").get() as any;
    expect(feedAnswer.thread_id).toBe(qrow.id);
  });

  it("an instruction typed by a person reaches the agent's card with the person's name and moves to done with proof, each change in the feed", async () => {
    const w = await makeWorld();
    const res = personPost(w.ctx, w.sam, w.room.id, { kind: 'instruction', to: 'Muse Henry', text: 'Collect three competitor launch pages.', done_when: 'Links are in the shared doc.', priority: 'high' });
    const iid = res.ids[0];
    const c1 = (await checkIn(w, w.a.apiKey)).body;
    const ins = c1.rooms[0].instructions_for_you[0];
    expect(ins).toMatchObject({ id: iid, from: 'Sam', priority: 'high', done_when: 'Links are in the shared doc.' });
    await report(w, w.a.apiKey, fullReport(c1, { instruction_updates: [{ instruction_id: iid, status: 'acknowledged' }] }));
    w.clock.advanceMinutes(60);
    const c2 = (await checkIn(w, w.a.apiKey)).body;
    await report(w, w.a.apiKey, fullReport(c2, { instruction_updates: [{ instruction_id: iid, status: 'in_progress', note: 'Found two so far.' }] }));
    w.clock.advanceMinutes(60);
    const c3 = (await checkIn(w, w.a.apiKey)).body;
    const done = await report(w, w.a.apiKey, fullReport(c3, { instruction_updates: [{ instruction_id: iid, status: 'done', proof: 'https://docs.example.com/competitors' }] }));
    expect(done.status).toBe(200);
    const statuses = (w.ctx.db.prepare("SELECT data FROM feed_events WHERE kind = 'instruction_status' AND thread_id = ? ORDER BY seq").all(iid) as any[]).map((r) => JSON.parse(r.data).status);
    expect(statuses).toEqual(['acknowledged', 'in_progress', 'done']);
    expect(count(w.ctx, "SELECT COUNT(*) n FROM feed_events WHERE kind = 'instruction' AND thread_id = ?", iid)).toBe(1);
    const row = w.ctx.db.prepare('SELECT status, proof FROM instructions WHERE id = ?').get(iid) as any;
    expect(row).toEqual({ status: 'done', proof: 'https://docs.example.com/competitors' });
    w.clock.advanceMinutes(60);
    const c4 = (await checkIn(w, w.a.apiKey)).body;
    expect(c4.rooms[0].instructions_for_you).toEqual([]);
  });

  it('keeps rooms isolated: an agent cannot read or write another room', async () => {
    const w = await makeWorld();
    const other = createRoom(w.ctx, w.sam, { name: 'Secret', goal: 'Top secret goal.' });
    // Sam's agent is only in Launch. Henry's agent too. Put a third agent in Secret.
    const r1 = await rest(w.app, w.a.apiKey, 'POST', '/api/v1/agent/post', { room_id: other.id, text: 'hello' });
    expect(r1.status).toBe(403);
    expect(r1.body.error.message).toMatch(/not a member of room/);
    const r2 = await rest(w.app, w.a.apiKey, 'GET', `/api/v1/agent/lookup?room_id=${other.id}`);
    expect(r2.status).toBe(403);
    addAgentToRoom(w.ctx, { kind: 'person', id: w.sam.id, name: 'Sam' }, w.b.agent.id, other.id);
    personPost(w.ctx, w.sam, other.id, { kind: 'note', to: 'room', text: 'The secret code is 1234.' });
    const ca = (await checkIn(w, w.a.apiKey)).body;
    expect(JSON.stringify(ca)).not.toContain('Top secret');
    expect(JSON.stringify(ca)).not.toContain('1234');
    const evtSecret = w.ctx.db.prepare("SELECT seq FROM feed_events WHERE room_id = ? AND kind = 'message'").get(other.id) as any;
    const r3 = await rest(w.app, w.a.apiKey, 'GET', `/api/v1/agent/lookup?id=evt_${evtSecret.seq}`);
    expect(r3.status).toBe(404);
    // B (in both rooms) gets both rooms, and a question to an agent who is not in that room is refused.
    const cb = (await checkIn(w, w.b.apiKey)).body;
    expect(cb.rooms.map((r: any) => r.room_name).sort()).toEqual(['Launch', 'Secret']);
    const bad = await report(w, w.b.apiKey, fullReport(cb, { questions: [{ to: 'Muse Henry', text: 'Psst', room_id: other.id }] }));
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toContain('is not an agent in room "Secret"');
    // A report entry for a room the agent isn't in is refused.
    const ca2 = (await checkIn(w, w.a.apiKey)).body;
    const bad2 = await report(w, w.a.apiKey, { ...fullReport(ca2), rooms: [...(fullReport(ca2).rooms as any[]), { room_id: other.id, working_on: 'sneaky' }] });
    expect(bad2.status).toBe(422);
    expect(bad2.body.error.message).toContain('is not one of your rooms');
  });

  it('revoked keys stop working at once; rotated keys work', async () => {
    const w = await makeWorld();
    expect((await rest(w.app, w.a.apiKey, 'GET', '/api/v1/agent/whoami')).status).toBe(200);
    const actor = { kind: 'person' as const, id: w.henry.id, name: 'Henry' };
    const fresh = rotateKey(w.ctx, actor, w.a.agent.id, 'api');
    const old = await rest(w.app, w.a.apiKey, 'GET', '/api/v1/agent/whoami');
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe('key_revoked');
    expect(old.body.error.message).toMatch(/revoked or replaced/);
    expect(old.headers['www-authenticate']).toMatch(/Bearer/);
    expect((await rest(w.app, fresh, 'GET', '/api/v1/agent/whoami')).status).toBe(200);
    revokeKeys(w.ctx, actor, w.a.agent.id, 'api');
    expect((await rest(w.app, fresh, 'GET', '/api/v1/agent/whoami')).status).toBe(401);
    const missing = await rest(w.app, null, 'GET', '/api/v1/agent/whoami');
    expect(missing.status).toBe(401);
    expect(missing.body.error.message).toMatch(/No agent key was sent/);
    // Every attempt is in the connection log with the exact text shown.
    const logged = w.ctx.db.prepare("SELECT * FROM connection_log WHERE agent_id = ? AND result = 'rejected' ORDER BY id").all(w.a.agent.id) as any[];
    expect(logged.length).toBe(2);
    expect(logged[0].message).toBe(old.body.error.message);
  });

  it('rate-limits each key with a plain-language 429', async () => {
    const w = await makeWorld({ config: { agentRateLimitPerMinute: 5 } });
    let last;
    for (let i = 0; i < 6; i++) last = await rest(w.app, w.a.apiKey, 'GET', '/api/v1/agent/whoami');
    expect(last!.status).toBe(429);
    expect(last!.body.error.message).toMatch(/Too many requests: this key is limited to 5 requests per minute/);
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
    // Another agent's key is unaffected.
    expect((await rest(w.app, w.b.apiKey, 'GET', '/api/v1/agent/whoami')).status).toBe(200);
  });

  it('keeps the card within its token budget and says what was left out', async () => {
    const w = await makeWorld({ config: { cardTokenBudget: 900 } });
    for (let i = 0; i < 30; i++) personPost(w.ctx, w.sam, w.room.id, { kind: 'note', to: 'room', text: `Update number ${i}: ${'detail '.repeat(20)}` });
    const card = (await checkIn(w, w.a.apiKey)).body;
    expect(estimateTokens(card)).toBeLessThanOrEqual(900);
    expect(card.left_out).toMatch(/older updates in Launch/);
    expect(card.left_out).toMatch(/tempo_lookup/);
    // Newest are kept.
    expect(card.rooms[0].since_last_check_in[0].text).toContain('Update number 29');
  });

  it('a paused room tells the agent to do nothing and needs only an acknowledgement', async () => {
    const w = await makeWorld();
    setRoomPaused(w.ctx, { kind: 'person', id: w.henry.id, name: 'Henry' }, w.room.id, true);
    const card = (await checkIn(w, w.a.apiKey)).body;
    expect(card.paused).toBe(true);
    expect(card.rooms[0].paused).toBe(true);
    expect(card.you_must_send_back[0]).toMatch(/only, to acknowledge/);
    const ack = await report(w, w.a.apiKey, { card_id: card.card_id });
    expect(ack.status).toBe(200);
    expect(ack.body.message).toMatch(/Tempo is paused/);
    const post = await rest(w.app, w.a.apiKey, 'POST', '/api/v1/agent/post', { text: 'hi' });
    expect(post.status).toBe(409);
    setRoomPaused(w.ctx, { kind: 'person', id: w.henry.id, name: 'Henry' }, w.room.id, false);
    w.clock.advanceMinutes(60);
    const card2 = (await checkIn(w, w.a.apiKey)).body;
    expect(card2.paused).toBe(false);
  });

  it('returns the same open card when the agent checks in again, and refuses old or unknown cards clearly', async () => {
    const w = await makeWorld();
    const c1 = (await checkIn(w, w.a.apiKey)).body;
    w.clock.advanceMinutes(5);
    const c2 = (await checkIn(w, w.a.apiKey)).body;
    expect(c2.card_id).toBe(c1.card_id);
    const unknown = await report(w, w.a.apiKey, { card_id: 'card_999' });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.message).toMatch(/not a card Tempo gave you/);
    // After the card times out a new one is issued; the old one is refused with a pointer to the new one.
    w.clock.advanceMinutes(30);
    const c3 = (await checkIn(w, w.a.apiKey)).body;
    expect(c3.card_id).not.toBe(c1.card_id);
    const old = await report(w, w.a.apiKey, fullReport(c1));
    expect(old.status).toBe(409);
    expect(old.body.error.message).toContain(`replaced by a newer card, "${c3.card_id}"`);
    expect(count(w.ctx, "SELECT COUNT(*) n FROM cards WHERE id = ? AND status = 'expired'", c1.card_id)).toBe(1);
  });

  it('accepts a late report for an expired card within the late window', async () => {
    const w = await makeWorld();
    const c1 = (await checkIn(w, w.a.apiKey)).body;
    w.clock.advanceMinutes(45);
    const late = await report(w, w.a.apiKey, fullReport(c1));
    expect(late.status).toBe(200);
  });

  it('gives plain-language errors for bad JSON and unknown endpoints', async () => {
    const w = await makeWorld();
    const r = await w.app.inject({ method: 'POST', url: '/api/v1/agent/report', headers: { authorization: `Bearer ${w.a.apiKey}`, 'content-type': 'application/json' }, payload: '{"card_id": ' });
    expect(r.statusCode).toBe(422);
    expect(JSON.parse(r.body).error.message).toMatch(/not valid JSON/);
    const u = await rest(w.app, w.a.apiKey, 'POST', '/api/v1/agent/nope', {});
    expect(u.status).toBe(404);
    expect(u.body.error.message).toMatch(/agent endpoints are/);
    const big = await w.app.inject({ method: 'POST', url: '/api/v1/agent/report', headers: { authorization: `Bearer ${w.a.apiKey}`, 'content-type': 'application/json' }, payload: JSON.stringify({ card_id: 'x', pad: 'y'.repeat(70_000) }) });
    expect(big.statusCode).toBe(413);
    expect(JSON.parse(big.body).error.message).toMatch(/larger than 64 KB/);
  });

  it('accepts forgiving shapes: maps, strings and status synonyms', async () => {
    const w = await makeWorld();
    personPost(w.ctx, w.henry, w.room.id, { kind: 'instruction', to: 'Muse Henry', text: 'Write the FAQ.', done_when: 'FAQ in doc.' });
    personPost(w.ctx, w.henry, w.room.id, { kind: 'question', to: 'Muse Henry', text: 'ETA?' });
    const card = (await checkIn(w, w.a.apiKey)).body;
    const qid = card.rooms[0].questions_for_you[0].id;
    const iid = card.rooms[0].instructions_for_you[0].id;
    const r = await report(w, w.a.apiKey, {
      card_id: card.card_id,
      rooms: [{ working_on: 'FAQ.', finished: 'Outline of the FAQ', blocked: 'none' }],
      answers: { [qid]: 'Tomorrow noon.' },
      instruction_updates: { [iid]: 'in progress' },
    });
    expect(r.status).toBe(200);
    expect((w.ctx.db.prepare('SELECT status FROM instructions WHERE id = ?').get(iid) as any).status).toBe('in_progress');
  });
});
