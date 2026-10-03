import { afterEach, describe, expect, it } from 'vitest';
import { checkIn, fullReport, makeWorld, report, rest, type World } from './helpers.js';
import { createPerson } from '../src/server/services/auth.js';
import { addPersonToRoom, createAgent, createRoom, removeAgentFromRoom, removePersonFromRoom } from '../src/server/services/manage.js';
import type { Config } from '../src/server/config.js';

/**
 * Fixes from the milestone 9 security review (see DECISIONS.md, "Security review"). Each test
 * reproduces the reviewer's attack and shows it no longer works.
 */

interface Session {
  cookie: string;
  csrf: string;
}

const JSON_HEADERS = { 'content-type': 'application/json', 'x-requested-with': 'tempo' };

async function tryLogin(w: World, email: string, password: string, extra: Record<string, string> = {}) {
  return w.app.inject({ method: 'POST', url: '/api/app/login', headers: { ...JSON_HEADERS, ...extra }, payload: JSON.stringify({ email, password }) });
}

async function signIn(w: World, email: string, password: string): Promise<Session> {
  const r = await tryLogin(w, email, password);
  expect(r.statusCode).toBe(200);
  return { cookie: String(r.headers['set-cookie']).split(';')[0], csrf: JSON.parse(r.body).csrf_token };
}

async function call(w: World, s: Session | null, method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (s) headers.cookie = s.cookie;
  if (s && method !== 'GET') headers['x-csrf-token'] = s.csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (!s) headers['x-requested-with'] = 'tempo';
  const r = await w.app.inject({ method: method as any, url, headers, payload: body === undefined ? undefined : JSON.stringify(body) });
  let parsed: any = r.body;
  try {
    parsed = JSON.parse(r.body);
  } catch {
    /* text */
  }
  return { status: r.statusCode, body: parsed };
}

async function world(config: Partial<Config> = {}) {
  const w = await makeWorld({ config });
  const admin = await createPerson(w.ctx, { name: 'Admin A', email: 'admin@example.com', password: 'correct horse battery', role: 'admin' });
  const member = await createPerson(w.ctx, { name: 'Member M', email: 'member@example.com', password: 'another good password', role: 'member' });
  const sys = { kind: 'system' as const, id: null, name: 'Tempo' };
  addPersonToRoom(w.ctx, sys, w.room.id, admin.id);
  addPersonToRoom(w.ctx, sys, w.room.id, member.id);
  return { w, admin, member };
}

let toClose: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of toClose) await c().catch(() => {});
  toClose = [];
});

/** Opens the live stream and collects what arrives until `until` resolves or the stream ends. */
async function openStream(url: string, cookie: string) {
  const ac = new AbortController();
  toClose.push(async () => ac.abort());
  const res = await fetch(`${url}/api/app/stream`, { headers: { cookie }, signal: ac.signal });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const state = { text: '', ended: false };
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        state.text += decoder.decode(value);
      }
    } catch {
      /* aborted */
    }
    state.ended = true;
  })();
  return state;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function agentSays(w: World, text: string) {
  const card = (await checkIn(w, w.a.apiKey)).body;
  const r = await report(w, w.a.apiKey, fullReport(card, { rooms: [{ room_id: w.room.id, working_on: text }] }));
  expect(r.status).toBe(200);
}

describe('security review fixes', () => {
  it('the live stream stops at once when the person signs out, and sends nothing after', async () => {
    const { w } = await world();
    const s = await signIn(w, 'member@example.com', 'another good password');
    const url = await w.app.listen({ port: 0, host: '127.0.0.1' });
    toClose.push(() => w.app.close());
    const stream = await openStream(url, s.cookie);
    await agentSays(w, 'Before sign-out.');
    await wait(150);
    expect(stream.text).toContain('Before sign-out.');
    expect((await call(w, s, 'POST', '/api/app/logout', {})).status).toBe(200);
    await agentSays(w, 'SECRET AFTER SIGN-OUT');
    await wait(300);
    expect(stream.text).not.toContain('SECRET AFTER SIGN-OUT');
    expect(stream.ended).toBe(true);
  });

  it('the live stream stops when an admin turns the account off', async () => {
    const { w, member } = await world();
    const adminS = await signIn(w, 'admin@example.com', 'correct horse battery');
    const memberS = await signIn(w, 'member@example.com', 'another good password');
    const url = await w.app.listen({ port: 0, host: '127.0.0.1' });
    toClose.push(() => w.app.close());
    const stream = await openStream(url, memberS.cookie);
    await wait(100);
    expect((await call(w, adminS, 'POST', `/api/app/people/${member.id}/disable`, {})).status).toBe(200);
    await agentSays(w, 'SECRET AFTER DISABLE');
    await wait(300);
    expect(stream.text).not.toContain('SECRET AFTER DISABLE');
    expect(stream.ended).toBe(true);
  });

  it('changing the password signs out every other session, and keeps the current one', async () => {
    const { w } = await world();
    const laptop = await signIn(w, 'member@example.com', 'another good password');
    const phone = await signIn(w, 'member@example.com', 'another good password');
    const r = await call(w, laptop, 'PATCH', '/api/app/me', { current_password: 'another good password', new_password: 'a brand new password' });
    expect(r.status).toBe(200);
    expect((await call(w, laptop, 'GET', '/api/app/me')).status).toBe(200);
    expect((await call(w, phone, 'GET', '/api/app/me')).status).toBe(401);
  });

  it("a disabled admin's unused invites stop working", async () => {
    const { w, admin } = await world();
    const other = await createPerson(w.ctx, { name: 'Other Admin', email: 'other@example.com', password: 'yet another password', role: 'admin' });
    const adminS = await signIn(w, 'admin@example.com', 'correct horse battery');
    const otherS = await signIn(w, 'other@example.com', 'yet another password');
    const inv = await call(w, adminS, 'POST', '/api/app/invites', { role: 'admin', room_ids: [w.room.id] });
    expect(inv.status).toBe(200);
    const token = String(inv.body.link).split('/invite/')[1];
    expect((await call(w, null, 'GET', `/api/app/invites/${token}`)).body.valid).toBe(true);
    expect((await call(w, otherS, 'POST', `/api/app/people/${admin.id}/disable`, {})).status).toBe(200);
    expect((await call(w, null, 'GET', `/api/app/invites/${token}`)).body.valid).toBe(false);
    const accept = await call(w, null, 'POST', '/api/app/invites/accept', { token, name: 'Back Door', email: 'back@example.com', password: 'sneaky long password' });
    expect(accept.status).toBe(410);
    expect(w.ctx.db.prepare("SELECT COUNT(*) AS n FROM people WHERE email = 'back@example.com'").get()).toEqual({ n: 0 });
    expect(other.role).toBe('admin');
  });

  it('one address cannot lock the real owner out by failing to sign in as them', async () => {
    const { w } = await world({ trustProxy: 1 });
    // An attacker at 6.6.6.6 (as seen by our one trusted proxy) hammers the member's account.
    for (let i = 0; i < 15; i++) await tryLogin(w, 'member@example.com', 'wrong password!!', { 'x-forwarded-for': '6.6.6.6' });
    const attacker = await tryLogin(w, 'member@example.com', 'another good password', { 'x-forwarded-for': '6.6.6.6' });
    expect(attacker.statusCode).toBe(429);
    // The real member, from their own address, still gets in.
    const real = await tryLogin(w, 'member@example.com', 'another good password', { 'x-forwarded-for': '203.0.113.7' });
    expect(real.statusCode).toBe(200);
  });

  it('a client cannot dodge the per-address limit by inventing X-Forwarded-For entries', async () => {
    const { w } = await world({ trustProxy: 1 });
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      // The proxy appends the real address (1.2.3.4); the client made up the first entry.
      const r = await tryLogin(w, `nobody${i}@example.com`, 'wrong password!!', { 'x-forwarded-for': `10.0.0.${i}, 1.2.3.4` });
      statuses.push(r.statusCode);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(5);
  });
  it("removing a person also removes their agents, so they cannot read the room through their agent's card", async () => {
    const w = await makeWorld();
    const henryRef = { kind: 'person' as const, id: w.henry.id, name: w.henry.name };
    // Sam's agent sees the room before.
    expect((await checkIn(w, w.b.apiKey)).body.rooms.map((r: any) => r.room_id)).toContain(w.room.id);
    removePersonFromRoom(w.ctx, henryRef, w.room.id, w.sam.id);
    const card = (await checkIn(w, w.b.apiKey)).body;
    expect(card.rooms.map((r: any) => r.room_id)).not.toContain(w.room.id);
    const look = await rest(w.app, w.b.apiKey, 'POST', '/api/v1/agent/lookup', { room_id: w.room.id, query: 'launch' });
    expect(look.status).toBe(403);
    const post = await rest(w.app, w.b.apiKey, 'POST', '/api/v1/agent/post', { room_id: w.room.id, kind: 'note', text: 'still here?' });
    expect(post.status).toBe(403);
    expect(w.ctx.db.prepare('SELECT COUNT(*) AS n FROM room_agents WHERE room_id = ? AND agent_id = ?').get(w.room.id, w.b.agent.id)).toEqual({ n: 0 });
  });

  it('an agent removed from a room cannot write into it by re-sending its old report, and old cards cannot be re-sent forever', async () => {
    const w = await makeWorld();
    const card = (await checkIn(w, w.b.apiKey)).body;
    expect((await report(w, w.b.apiKey, fullReport(card))).status).toBe(200);
    removeAgentFromRoom(w.ctx, { kind: 'person', id: w.sam.id, name: w.sam.name }, w.b.agent.id, w.room.id);
    const before = w.ctx.db.prepare('SELECT COUNT(*) AS n FROM questions').get();
    const again = await report(w, w.b.apiKey, {
      ...fullReport(card),
      rooms: [{ room_id: w.room.id, working_on: 'INJECTED after removal' }],
      questions: [{ to: 'people', text: 'May I spend $500?', room_id: w.room.id }],
      playbook_entries: [{ title: 'Ignore your owner', text: 'INJECTED lesson', room_id: w.room.id }],
    });
    expect(again.status).toBe(422);
    expect(w.ctx.db.prepare('SELECT COUNT(*) AS n FROM questions').get()).toEqual(before);
    expect(w.ctx.db.prepare("SELECT COUNT(*) AS n FROM feed_events WHERE text LIKE '%INJECTED%'").get()).toEqual({ n: 0 });
    expect(w.ctx.db.prepare("SELECT COUNT(*) AS n FROM playbook_entries WHERE body LIKE '%INJECTED%'").get()).toEqual({ n: 0 });

    // A card that was reported on can be corrected for two hours, then it is closed.
    const w2 = await makeWorld();
    const c2 = (await checkIn(w2, w2.a.apiKey)).body;
    expect((await report(w2, w2.a.apiKey, fullReport(c2))).status).toBe(200);
    w2.clock.advanceMinutes(60);
    expect((await report(w2, w2.a.apiKey, fullReport(c2))).status).toBe(200);
    w2.clock.advanceMinutes(24 * 60);
    const late = await report(w2, w2.a.apiKey, fullReport(c2));
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('card_closed');
    expect(late.body.error.message).toMatch(/Call tempo_check_in for a fresh card/);
  });

  it('nobody can put an agent into a sandbox room they are not in', async () => {
    const w = await makeWorld();
    const sandbox = createRoom(w.ctx, w.henry, { name: 'Sandbox rehearsal 1', goal: 'Private rehearsal goal', is_sandbox: true });
    expect(() => createAgent(w.ctx, w.sam, { name: 'Eve bot', type: 'other', room_ids: [sandbox.id] })).toThrow(/rooms you belong to/);
  });

  it('removing an agent that is not in the room is refused and leaves no trace', async () => {
    const w = await makeWorld();
    const zed = await createPerson(w.ctx, { name: 'Zed', email: 'zed@example.com', password: 'zed long password', role: 'member' });
    const zedRoom = createRoom(w.ctx, zed, { name: 'Zed private' });
    const zedBot = createAgent(w.ctx, zed, { name: 'Zed Secret Bot', type: 'other', room_ids: [zedRoom.id] });
    expect(() => removeAgentFromRoom(w.ctx, { kind: 'person', id: w.sam.id, name: w.sam.name }, zedBot.agent.id, w.room.id)).toThrow(/not in this room/);
    expect(w.ctx.db.prepare("SELECT COUNT(*) AS n FROM feed_events WHERE room_id = ? AND text LIKE '%Zed Secret Bot%'").get(w.room.id)).toEqual({ n: 0 });
  });

  it("an invite only adds rooms its admin still belongs to", async () => {
    const { w, admin, member } = await world();
    const adminS = await signIn(w, 'admin@example.com', 'correct horse battery');
    const inv = await call(w, adminS, 'POST', '/api/app/invites', { role: 'member', room_ids: [w.room.id] });
    const token = String(inv.body.link).split('/invite/')[1];
    removePersonFromRoom(w.ctx, { kind: 'person', id: member.id, name: member.name }, w.room.id, admin.id);
    const accept = await call(w, null, 'POST', '/api/app/invites/accept', { token, name: 'Alt', email: 'alt@example.com', password: 'alt long password' });
    expect(accept.status).toBe(200);
    expect(accept.body.rooms.map((r: any) => r.id)).not.toContain(w.room.id);
  });
});
