import { describe, expect, it } from 'vitest';
import { checkIn, count, fullReport, makeWorld, report, rest, type World } from './helpers.js';
import { isPreviewBot } from '../src/server/doors/page.js';
import { FIELD, formToReport } from '../src/server/doors/page-form.js';
import { escapeHtml, html, linkify, raw } from '../src/server/lib/html.js';
import type { CardRoomT, CardT } from '../src/server/schemas/agent.js';
import { personPost } from '../src/server/services/people-actions.js';
import { addAgentToRoom, createRoom, rotateKey, setRoomPaused } from '../src/server/services/manage.js';

const BROWSER =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

async function getPage(w: World, token: string, userAgent: string = BROWSER, method: 'GET' | 'HEAD' = 'GET') {
  return w.app.inject({ method, url: `/a/${token}`, headers: { 'user-agent': userAgent } });
}

async function postPage(w: World, token: string, fields: Record<string, string> | string, headers: Record<string, string> = {}) {
  const payload = typeof fields === 'string' ? fields : new URLSearchParams(fields).toString();
  return w.app.inject({
    method: 'POST',
    url: `/a/${token}`,
    headers: { 'user-agent': BROWSER, 'content-type': 'application/x-www-form-urlencoded', ...headers },
    payload,
  });
}

function decode(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function cardIdOf(body: string): string {
  const m = /<input type="hidden" name="card_id" value="([^"]+)">/.exec(body);
  if (!m) throw new Error('no card_id field on the page');
  return m[1];
}

function fieldNames(body: string): string[] {
  return [...body.matchAll(/<(?:input|textarea|select)\b[^>]*?\bname="([^"]+)"/g)].map((m) => m[1]);
}

function textareaValue(body: string, name: string): string | null {
  const m = new RegExp(`<textarea[^>]*name="${name.replace(/\./g, '\\.')}"[^>]*>\\n?([\\s\\S]*?)</textarea>`).exec(body);
  return m ? decode(m[1]) : null;
}

function inputValue(body: string, name: string): string | null {
  const m = new RegExp(`<input[^>]*name="${name.replace(/\./g, '\\.')}"[^>]*value="([^"]*)"`).exec(body);
  return m ? decode(m[1]) : null;
}

function isChecked(body: string, name: string, value: string): boolean {
  const re = new RegExp(`<input type="radio"[^>]*name="${name.replace(/\./g, '\\.')}" value="${value}"([^>]*)>`);
  const m = re.exec(body);
  return !!m && /\bchecked\b/.test(m[1]);
}

function selectedOption(body: string, name: string): string | null {
  const sel = new RegExp(`<select[^>]*name="${name.replace(/\./g, '\\.')}"[^>]*>([\\s\\S]*?)</select>`).exec(body);
  if (!sel) return null;
  const m = /<option value="([^"]*)" selected>/.exec(sel[1]);
  return m ? decode(m[1]) : '';
}

const SECURITY_HEADERS = (h: Record<string, unknown>) => {
  expect(String(h['content-type'])).toBe('text/html; charset=utf-8');
  expect(h['x-robots-tag']).toBe('noindex, nofollow');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['cache-control']).toBe('no-store');
  expect(h['content-security-policy']).toBe(
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
};

/** A world where a person has given Muse Henry one instruction and one question. */
async function worldWithWork(config: Parameters<typeof makeWorld>[0] = {}) {
  const w = await makeWorld(config);
  const ins = personPost(w.ctx, w.henry, w.room.id, {
    kind: 'instruction',
    to: 'Muse Henry',
    text: 'Draft the launch email.',
    done_when: 'The draft is in the shared doc.',
  });
  const q = personPost(w.ctx, w.henry, w.room.id, { kind: 'question', to: 'Muse Henry', text: 'Which pricing tier are we launching with?' });
  return { w, iid: ins.ids[0], qid: q.ids[0] };
}

// ---------------------------------------------------------------------------------------------
// isPreviewBot
// ---------------------------------------------------------------------------------------------

describe('isPreviewBot', () => {
  it('recognises link-preview and search bots', () => {
    const bots = [
      'Mozilla/5.0 (Macintosh) facebookexternalhit/1.1 Facebot Twitterbot/1.0',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Twitterbot/1.0',
      'WhatsApp/2.23.20.0',
      'WhatsApp/2.23.20.0 A',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
      'Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
      'redditbot/1.0',
      'Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)',
      'Some Link Preview Fetcher 3',
      'AhrefsBot/7.0',
      'MyCoolCrawler/2',
      'Baiduspider/2.0',
      'bot',
    ];
    for (const ua of bots) expect(isPreviewBot(ua), ua).toBe(true);
  });

  it('lets browsers and tools through, including headless ones and requests with no User-Agent', () => {
    const people = [
      BROWSER,
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'node',
      'curl/8.5.0',
      'lightMyRequest',
      '',
      undefined,
      null,
    ];
    for (const ua of people) expect(isPreviewBot(ua), String(ua)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// html helpers
// ---------------------------------------------------------------------------------------------

describe('html helpers', () => {
  it('escapes everything interpolated into the html template, except markup marked safe', () => {
    const evil = `<script>alert("x")</script> & 'q'`;
    expect(html`<p>${evil}</p>`.value).toBe('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>');
    expect(html`<a title="${evil}">x</a>`.value).not.toContain('"x"');
    expect(html`<ul>${['a<b', 'c'].map((t) => html`<li>${t}</li>`)}</ul>`.value).toBe('<ul><li>a&lt;b</li><li>c</li></ul>');
    expect(html`<i>${raw('<b>ok</b>')}</i>${null}${undefined}${false}`.value).toBe('<i><b>ok</b></i>');
    expect(escapeHtml(5)).toBe('5');
  });

  it('turns only http and https addresses into links, escaped, with the sentence punctuation outside', () => {
    const out = linkify('See https://docs.example.com/a?x=1&y=2. Or (http://example.org/wiki/Foo_(bar)), not javascript:alert(1) or ftp://x.test/f <b>bold</b>').value;
    expect(out).toContain('<a href="https://docs.example.com/a?x=1&amp;y=2" rel="noopener noreferrer nofollow">https://docs.example.com/a?x=1&amp;y=2</a>.');
    expect(out).toContain('<a href="http://example.org/wiki/Foo_(bar)" rel="noopener noreferrer nofollow">http://example.org/wiki/Foo_(bar)</a>)');
    expect(out).toContain('not javascript:alert(1) or ftp://x.test/f &lt;b&gt;bold&lt;/b&gt;');
    expect(out).not.toMatch(/<a href="(?!https?:)/);
    expect(out).not.toContain('<b>');
    // A quote inside the address cannot break out of the attribute.
    const sneaky = linkify('https://x.test/"onmouseover="alert(1)').value;
    expect(sneaky).not.toContain('onmouseover="');
    expect(linkify(null).value).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------
// formToReport (the field naming contract)
// ---------------------------------------------------------------------------------------------

function room(id: string, name: string, over: Partial<CardRoomT> = {}): CardRoomT {
  return {
    room_id: id,
    room_name: name,
    paused: false,
    goal: 'A goal.',
    rules: [],
    limits: { you_may: [], ask_a_person_first: [] },
    others_here: [],
    since_last_check_in: [],
    questions_for_you: [],
    instructions_for_you: [],
    playbook: [],
    ...over,
  };
}

function cardOf(rooms: CardRoomT[], over: Partial<CardT> = {}): CardT {
  return {
    ok: true,
    card_id: 'card_7',
    now: '2026-10-05T15:00:00.000Z',
    now_text: 'Monday 9:00 am',
    agent: { name: 'Muse Henry', owner: 'Henry' },
    about: 'About.',
    paused: false,
    rooms,
    you_must_send_back: [],
    how_to_reply: '',
    next_check_in_due: null,
    next_check_in_due_text: 'not scheduled',
    left_out: null,
    ...over,
  };
}

const ins = (id: string) => ({ id, from: 'Henry', issued_at: 'x', text: 'Do it.', done_when: 'Done.', priority: 'normal' as const, due: null, status: 'new' });
const qn = (id: string) => ({ id, from: 'Sam', asked_at: 'x', text: 'Why?' });

describe('formToReport', () => {
  const card = cardOf([
    room('room_1', 'Launch', { questions_for_you: [qn('q_12')], instructions_for_you: [ins('ins_31'), ins('ins_32')] }),
    room('room_3', 'Secret', { questions_for_you: [qn('q_13')] }),
    room('room_4', 'Quiet', { paused: true }),
  ]);

  it('maps the flat field names to the canonical report, one entry per active room, question and instruction', () => {
    const fields = new URLSearchParams({
      card_id: 'card_7',
      'room.room_1.working_on': 'Drafting the hero copy.',
      'room.room_1.finished.1.what': 'Outline',
      'room.room_1.finished.1.proof': 'https://docs.example.com/outline',
      'room.room_1.notes_for_others': 'Copy lands by noon.',
      'room.room_1.blocked_reason': 'Waiting on logo',
      'room.room_1.blocked_unblock': 'Sam sends the logo',
      'room.room_3.working_on': 'Secret things.',
      'room.room_4.working_on': 'Ignored: this room is paused.',
      'answer.q_12': 'Pro tier.',
      'answer.q_13': 'Not sure.',
      'ins.ins_31.status': 'done',
      'ins.ins_31.proof': 'https://docs.example.com/email',
      'ins.ins_32.status': 'declined',
      'ins.ins_32.note': 'Out of scope.',
      'question.1.to': 'Muse Sam',
      'question.1.text': 'Is the table final?',
      'question.1.room_id': 'room_1',
      'lesson.1.title': 'Use the shared doc',
      'lesson.1.text': 'Always link the doc.',
      'lesson.1.room_id': 'room_3',
    });
    expect(formToReport(fields, card)).toEqual({
      card_id: 'card_7',
      rooms: [
        {
          room_id: 'room_1',
          working_on: 'Drafting the hero copy.',
          finished: [{ what: 'Outline', proof: 'https://docs.example.com/outline' }],
          notes_for_others: 'Copy lands by noon.',
          blocked: { reason: 'Waiting on logo', what_would_unblock: 'Sam sends the logo' },
        },
        { room_id: 'room_3', working_on: 'Secret things.', finished: [], blocked: null },
      ],
      answers: [
        { question_id: 'q_12', answer: 'Pro tier.' },
        { question_id: 'q_13', answer: 'Not sure.' },
      ],
      instruction_updates: [
        { instruction_id: 'ins_31', status: 'done', proof: 'https://docs.example.com/email' },
        { instruction_id: 'ins_32', status: 'declined', note: 'Out of scope.' },
      ],
      questions: [{ to: 'Muse Sam', text: 'Is the table final?', room_id: 'room_1' }],
      playbook_entries: [{ title: 'Use the shared doc', text: 'Always link the doc.', room_id: 'room_3' }],
    });
  });

  it('includes every room (even empty) and leaves out untouched answers and statuses, so the shared validator names them', () => {
    const r = formToReport({ card_id: 'card_7' }, card) as any;
    expect(r.rooms).toEqual([
      { room_id: 'room_1', working_on: '', finished: [], blocked: null },
      { room_id: 'room_3', working_on: '', finished: [], blocked: null },
    ]);
    expect(r.answers).toEqual([]);
    expect(r.instruction_updates).toEqual([]);
    expect(r.questions).toEqual([]);
    expect(r.playbook_entries).toEqual([]);
  });

  it('ignores empty rows and passes half-filled rows on so they get flagged', () => {
    const r = formToReport(
      {
        card_id: 'card_7',
        'room.room_1.finished.1.what': '',
        'room.room_1.finished.1.proof': '   ',
        'room.room_1.finished.2.what': 'Wrote the FAQ',
        'room.room_1.finished.3.proof': 'https://example.com/only-proof',
        'question.1.to': 'people',
        'question.1.text': '',
        'question.2.to': 'Muse Sam',
        'question.2.text': 'Second question only?',
        'lesson.1.title': 'Title but no text',
      },
      card,
    ) as any;
    expect(r.rooms[0].finished).toEqual([{ what: 'Wrote the FAQ' }, { what: '', proof: 'https://example.com/only-proof' }]);
    // The row with empty text is dropped even though a recipient was chosen; no room_id field means none is sent.
    expect(r.questions).toEqual([{ to: 'Muse Sam', text: 'Second question only?' }]);
    expect(r.playbook_entries).toEqual([{ title: 'Title but no text', text: '' }]);
  });

  it('passes the five radio values through and leaves note and proof out when empty', () => {
    for (const status of ['acknowledged', 'in_progress', 'done', 'blocked', 'declined']) {
      const r = formToReport({ card_id: 'card_7', [FIELD.insStatus('ins_31')]: status }, card) as any;
      expect(r.instruction_updates[0]).toEqual({ instruction_id: 'ins_31', status });
    }
    const r = formToReport({ card_id: 'card_7', 'ins.ins_31.status': 'in_progress', 'ins.ins_31.note': 'On it.' }, card) as any;
    expect(r.instruction_updates[0]).toEqual({ instruction_id: 'ins_31', status: 'in_progress', note: 'On it.' });
  });

  it('treats a blocker with only one half filled in as a blocker, and both empty as not blocked', () => {
    const only = formToReport({ card_id: 'card_7', 'room.room_1.blocked_reason': 'No access' }, card) as any;
    expect(only.rooms[0].blocked).toEqual({ reason: 'No access', what_would_unblock: '' });
    const none = formToReport({ card_id: 'card_7', 'room.room_1.blocked_reason': '  ', 'room.room_1.blocked_unblock': '' }, card) as any;
    expect(none.rooms[0].blocked).toBeNull();
  });

  it('reads URLSearchParams and plain objects the same, normalises line breaks, and keeps agent names with spaces', () => {
    const plain = {
      card_id: 'card_7',
      'room.room_1.working_on': '  Line one\r\nLine two  ',
      'question.1.to': 'Muse Sam the Second',
      'question.1.text': 'Hi?',
    };
    const a = formToReport(plain, card) as any;
    const b = formToReport(new URLSearchParams(plain), card) as any;
    expect(a).toEqual(b);
    expect(a.rooms[0].working_on).toBe('Line one\nLine two');
    expect(a.questions[0].to).toBe('Muse Sam the Second');
  });

  it('for a paused card sends just the card_id with empty lists', () => {
    const paused = cardOf([room('room_1', 'Launch', { paused: true })], { paused: true });
    expect(formToReport({ card_id: 'card_7' }, paused)).toEqual({
      card_id: 'card_7',
      rooms: [],
      answers: [],
      instruction_updates: [],
      questions: [],
      playbook_entries: [],
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Door C over HTTP
// ---------------------------------------------------------------------------------------------

describe('agent page: showing the card', () => {
  it('shows the card as readable text followed by one form, with every privacy header and nothing external', async () => {
    const { w, iid, qid } = await worldWithWork();
    const res = await getPage(w, w.a.pageToken);
    expect(res.statusCode).toBe(200);
    SECURITY_HEADERS(res.headers);
    const body = res.body;

    // The card: goal, the question for the agent, the instruction with its done_when.
    expect(body).toContain('Tempo briefing card card_1');
    expect(body).toContain('Ship the launch page by Friday.');
    expect(body).toContain('Keep drafts in the shared doc.');
    expect(body).toContain(`<strong>${qid}</strong> from Henry`);
    expect(body).toContain('Which pricing tier are we launching with?');
    expect(body).toContain(`<strong>${iid}</strong> from Henry`);
    expect(body).toContain('Draft the launch email.');
    expect(body).toMatch(/<strong>Done when:<\/strong> <span class="text">The draft is in the shared doc\.<\/span>/);
    expect(body).toContain('Next check-in due:</strong> Monday 10:00 am Mountain Time');
    expect(body).toContain('Muse Sam (agent)');

    // Meta tags, one form, one hidden field, one button.
    expect(body).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(body).toContain('<meta name="referrer" content="no-referrer">');
    expect(body.match(/<form\b/g)).toHaveLength(1);
    expect(body).toContain(`<form method="post" action="/a/${w.a.pageToken}" enctype="application/x-www-form-urlencoded">`);
    expect(body.match(/type="hidden"/g)).toHaveLength(1);
    expect(body.match(/<button\b/g)).toHaveLength(1);
    expect(body).toContain('>Send report</button>');

    // No script, no external anything, no browser-side validation that could pop up.
    expect(body).not.toMatch(/<script/i);
    expect(body).not.toMatch(/\son[a-z]+\s*=/i);
    expect(body).not.toMatch(/<link\b|<img\b|<iframe\b|<object\b|<embed\b|@import|url\(/i);
    expect(body).not.toMatch(/\b(?:src|href)\s*=\s*"(?:https?:)?\/\//i);
    expect(body).not.toMatch(/\s(?:required|maxlength|pattern)\b/i);
    expect(body).not.toContain('href='); // no links at all unless an agent wrote an address

    // Every control has a visible label, and the page is readable on a phone.
    expect(body).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    for (const id of [...body.matchAll(/<(?:input|textarea|select)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1])) {
      expect(body, id).toContain(`<label for="${id}">`);
    }
    expect(body).toContain('<legend>');
  });

  it('draws the fields named in the contract, and only those', async () => {
    const { w, iid, qid } = await worldWithWork();
    const names = fieldNames((await getPage(w, w.a.pageToken)).body).sort();
    const r = w.room.id;
    const expected = [
      'card_id',
      `room.${r}.working_on`,
      ...[1, 2, 3].flatMap((n) => [`room.${r}.finished.${n}.what`, `room.${r}.finished.${n}.proof`]),
      `room.${r}.notes_for_others`,
      `room.${r}.blocked_reason`,
      `room.${r}.blocked_unblock`,
      `answer.${qid}`,
      `ins.${iid}.status`,
      `ins.${iid}.status`,
      `ins.${iid}.status`,
      `ins.${iid}.status`,
      `ins.${iid}.status`,
      `ins.${iid}.note`,
      `ins.${iid}.proof`,
      'question.1.to',
      'question.1.text',
      'question.2.to',
      'question.2.text',
      'lesson.1.title',
      'lesson.1.text',
    ].sort();
    expect(names).toEqual(expected);

    // The five radio values, each with a plain-words label, and the "to" menu with exact agent names.
    const body = (await getPage(w, w.a.pageToken)).body;
    for (const v of ['acknowledged', 'in_progress', 'done', 'blocked', 'declined']) {
      expect(body).toContain(`name="ins.${iid}.status" value="${v}"`);
    }
    const menu = /<select[^>]*name="question.1.to"[^>]*>([\s\S]*?)<\/select>/.exec(body)![1];
    expect([...menu.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(['', 'Muse Sam', 'conductor', 'people']);
  });

  it('asks for a room on new questions and lessons only when the agent has more than one active room', async () => {
    const { w } = await worldWithWork();
    const other = createRoom(w.ctx, w.henry, { name: 'Secret', goal: 'Hidden goal.' });
    addAgentToRoom(w.ctx, { kind: 'person', id: w.henry.id, name: 'Henry' }, w.a.agent.id, other.id);
    const body = (await getPage(w, w.a.pageToken)).body;
    const names = fieldNames(body);
    for (const n of ['question.1.room_id', 'question.2.room_id', 'lesson.1.room_id', `room.${other.id}.working_on`, `room.${w.room.id}.working_on`]) {
      expect(names, n).toContain(n);
    }
    const menu = /<select[^>]*name="question.1.room_id"[^>]*>([\s\S]*?)<\/select>/.exec(body)![1];
    expect([...menu.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(['', w.room.id, other.id]);

    // Leaving the room out is explained in the shared validator's words.
    const bad = await postPage(w, w.a.pageToken, {
      card_id: cardIdOf(body),
      [`room.${w.room.id}.working_on`]: 'a',
      [`room.${other.id}.working_on`]: 'b',
      'question.1.to': 'people',
      'question.1.text': 'Which room am I asking about?',
    });
    expect(bad.statusCode).toBe(422);
    expect(decode(bad.body)).toContain('needs a room_id because you are in more than one room');
  });

  it('works for a paused room: says so plainly and needs only the Send report button', async () => {
    const { w } = await worldWithWork();
    setRoomPaused(w.ctx, { kind: 'person', id: w.henry.id, name: 'Henry' }, w.room.id, true);
    const res = await getPage(w, w.a.pageToken);
    expect(res.statusCode).toBe(200);
    SECURITY_HEADERS(res.headers);
    const body = res.body;
    expect(body).toContain('Tempo is paused for you');
    expect(body).toContain('(paused: nothing to do here for now)');
    expect(body.match(/<form\b/g)).toHaveLength(1);
    expect(fieldNames(body)).toEqual(['card_id']);
    expect(body).toContain('>Send report</button>');
    expect(body).not.toMatch(/<script/i);

    // Pressing the button acknowledges the card.
    const ack = await postPage(w, w.a.pageToken, { card_id: cardIdOf(body) });
    expect(ack.statusCode).toBe(200);
    expect(ack.body).toContain('Acknowledged card_1');
    expect(ack.body).toContain('You are done until your next check-in.');
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM reports')).toBe(1);
  });

  it('writes the same facts as the plain-text card, including playbook entries and what was left out', async () => {
    const w = await makeWorld({ config: { cardTokenBudget: 900 } });
    for (let i = 0; i < 30; i++) personPost(w.ctx, w.sam, w.room.id, { kind: 'note', to: 'room', text: `Update number ${i}: ${'detail '.repeat(20)}` });
    personPost(w.ctx, w.henry, w.room.id, { kind: 'instruction', to: 'Muse Henry', text: 'Check the footer.', done_when: 'Footer matches the mock.', priority: 'high' });
    const card = (await checkIn(w, w.a.apiKey)).body as CardT;
    const body = (await getPage(w, w.a.pageToken)).body;
    expect(card.left_out).toBeTruthy();
    expect(decode(body)).toContain(card.left_out!);
    expect(body).toContain('priority high');
    expect(decode(body)).toContain(card.rooms[0].since_last_check_in[0].text);
    for (const line of card.you_must_send_back) expect(decode(body)).toContain(line);
    expect(decode(body)).toContain(card.rooms[0].limits.ask_a_person_first.join(', '));
    // The page opened the same card the REST door had opened, not a second one.
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM cards WHERE agent_id = ?', w.a.agent.id)).toBe(1);
  });
});

describe('agent page: link-preview bots and HEAD', () => {
  it('gives preview bots a tiny page and never opens a card or logs a check-in', async () => {
    const { w } = await worldWithWork();
    const cards = () => count(w.ctx, 'SELECT COUNT(*) n FROM cards');
    const logRows = () => count(w.ctx, 'SELECT COUNT(*) n FROM connection_log');
    expect(cards()).toBe(0);
    for (const ua of [
      'Mozilla/5.0 (Macintosh) facebookexternalhit/1.1 Facebot Twitterbot/1.0',
      'WhatsApp/2.23.20.0',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    ]) {
      const res = await getPage(w, w.a.pageToken, ua);
      expect(res.statusCode, ua).toBe(200);
      SECURITY_HEADERS(res.headers);
      expect(res.body).toContain('Tempo agent page. Open this link in a browser to see your briefing card.');
      expect(res.body).not.toContain('<form');
      expect(res.body).not.toContain('Ship the launch page');
      expect(res.body).not.toContain(w.a.pageToken);
      expect(cards()).toBe(0);
    }
    // It does not even say whether the link is valid.
    const bogus = await getPage(w, 'not-a-real-token', 'WhatsApp/2.23.20.0');
    expect(bogus.statusCode).toBe(200);
    expect(bogus.body).toContain('Open this link in a browser');
    expect(logRows()).toBe(0);
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM agents WHERE first_seen_at IS NOT NULL')).toBe(0);

    // A real browser opens the card.
    expect((await getPage(w, w.a.pageToken)).statusCode).toBe(200);
    expect(cards()).toBe(1);
  });

  it('answers HEAD without opening a card', async () => {
    const { w } = await worldWithWork();
    const res = await getPage(w, w.a.pageToken, BROWSER, 'HEAD');
    expect(res.statusCode).toBe(200);
    SECURITY_HEADERS(res.headers);
    expect(res.body).toBe('');
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM cards')).toBe(0);
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM connection_log')).toBe(0);
    // Even HEAD on a bad link says nothing about it.
    expect((await getPage(w, 'nope', BROWSER, 'HEAD')).statusCode).toBe(200);
  });
});

describe('agent page: sending the report', () => {
  it('rejects an incomplete form with the shared validator\'s words (422), at the top, keeping what was typed', async () => {
    const { w, iid, qid } = await worldWithWork();
    const page = (await getPage(w, w.a.pageToken)).body;
    const cardId = cardIdOf(page);
    const rid = w.room.id;

    // Ask the REST door the same thing in a parallel, identically built world.
    const { w: w2, iid: iid2, qid: qid2 } = await worldWithWork();
    expect([iid2, qid2]).toEqual([iid, qid]);
    const card2 = (await checkIn(w2, w2.a.apiKey)).body;
    expect(card2.card_id).toBe(cardId);
    const viaRest = await report(w2, w2.a.apiKey, {
      card_id: cardId,
      rooms: [{ room_id: rid, working_on: '', notes_for_others: 'Typed <notes> & more' }],
      answers: [],
      instruction_updates: [{ instruction_id: iid, status: '', note: 'A typed note' }],
    });
    expect(viaRest.status).toBe(422);
    expect(viaRest.body.error.message).toContain(`an answer to ${qid} ('`);
    expect(viaRest.body.error.message).toMatch(/^Report not accepted\. Missing: /);

    const res = await postPage(w, w.a.pageToken, {
      card_id: cardId,
      [`room.${rid}.notes_for_others`]: 'Typed <notes> & more',
      [`ins.${iid}.note`]: 'A typed note',
      'question.1.to': 'Muse Sam',
      'question.1.text': 'A typed question?',
    });
    expect(res.statusCode).toBe(422);
    SECURITY_HEADERS(res.headers);
    const body = res.body;

    // The exact message, in a clearly marked box at the top, before the card.
    expect(body).toContain(escapeHtml(viaRest.body.error.message));
    expect(body).toMatch(/<section class="box alert" role="alert"/);
    expect(body.indexOf('role="alert"')).toBeLessThan(body.indexOf('<h1>Tempo briefing card card_1</h1>'));
    expect(decode(body)).toContain('Report not accepted. Missing: ');
    for (const p of viaRest.body.error.problems) expect(body).toContain(escapeHtml(p.message));
    // The page told the agent what to fix as a list too.
    expect(body).toContain('What is missing or needs fixing:');

    // Same card, same form, nothing lost.
    expect(body.match(/<form\b/g)).toHaveLength(1);
    expect(cardIdOf(body)).toBe(cardId);
    expect(textareaValue(body, `room.${rid}.notes_for_others`)).toBe('Typed <notes> & more');
    expect(textareaValue(body, `ins.${iid}.note`)).toBe('A typed note');
    expect(textareaValue(body, `room.${rid}.working_on`)).toBe('');
    expect(textareaValue(body, 'question.1.text')).toBe('A typed question?');
    expect(selectedOption(body, 'question.1.to')).toBe('Muse Sam');

    // Nothing was saved, and the card was not opened a second time.
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM reports')).toBe(0);
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM cards')).toBe(1);
    expect(count(w.ctx, "SELECT COUNT(*) n FROM connection_log WHERE door = 'page' AND action = 'check_in'")).toBe(1);
    const logged = w.ctx.db.prepare("SELECT http_status, result, card_id FROM connection_log WHERE door = 'page' AND action = 'report'").get() as any;
    expect(logged).toEqual({ http_status: 422, result: 'rejected', card_id: cardId });
  });

  it('re-checks the radio button that was chosen and flags a done without proof', async () => {
    const { w, iid, qid } = await worldWithWork();
    const rid = w.room.id;
    const cardId = cardIdOf((await getPage(w, w.a.pageToken)).body);
    const res = await postPage(w, w.a.pageToken, {
      card_id: cardId,
      [`room.${rid}.working_on`]: 'Drafting.',
      [`answer.${qid}`]: 'Pro tier.',
      [`ins.${iid}.status`]: 'done',
    });
    expect(res.statusCode).toBe(422);
    expect(decode(res.body)).toContain(`proof for ${iid}, which is marked done`);
    for (const v of ['acknowledged', 'in_progress', 'blocked', 'declined']) expect(isChecked(res.body, `ins.${iid}.status`, v)).toBe(false);
    expect(isChecked(res.body, `ins.${iid}.status`, 'done')).toBe(true);
    expect(textareaValue(res.body, `room.${rid}.working_on`)).toBe('Drafting.');
    expect(textareaValue(res.body, `answer.${qid}`)).toBe('Pro tier.');
  });

  it('accepts a complete form, shows when the next check-in is due, and stores the same records as the other doors', async () => {
    const { w, iid, qid } = await worldWithWork();
    const rid = w.room.id;
    const cardId = cardIdOf((await getPage(w, w.a.pageToken)).body);
    const res = await postPage(w, w.a.pageToken, {
      card_id: cardId,
      [`room.${rid}.working_on`]: 'Drafting the hero copy.',
      [`room.${rid}.finished.1.what`]: 'Outline',
      [`room.${rid}.finished.1.proof`]: 'https://docs.example.com/outline',
      [`room.${rid}.notes_for_others`]: 'Copy lands by noon.',
      [`answer.${qid}`]: 'Pro tier.',
      [`ins.${iid}.status`]: 'done',
      [`ins.${iid}.proof`]: 'https://docs.example.com/email',
      'question.1.to': 'Muse Sam',
      'question.1.text': 'Is the pricing table final?',
      'lesson.1.title': 'Link the doc',
      'lesson.1.text': 'Always link the shared doc in proof.',
    });
    expect(res.statusCode).toBe(200);
    SECURITY_HEADERS(res.headers);
    const body = res.body;
    expect(body).toContain('Report accepted for card_1. Thank you.');
    expect(body).toContain('Next check-in due:</strong> Monday 10:00 am Mountain Time (in 1 hour)');
    expect(body).toContain('You are done until your next check-in.');
    // No way back into the card (opening the page would start a new check-in), and no form.
    expect(body).not.toContain('<form');
    expect(body).not.toContain('href=');
    expect(body).not.toMatch(/<script/i);

    // The stored records.
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM reports')).toBe(1);
    const rep = w.ctx.db.prepare('SELECT door, card_id, agent_id, revision FROM reports').get() as any;
    expect(rep).toEqual({ door: 'page', card_id: cardId, agent_id: w.a.agent.id, revision: 1 });
    const rr = w.ctx.db.prepare('SELECT * FROM report_rooms').get() as any;
    expect(rr.working_on).toBe('Drafting the hero copy.');
    expect(rr.notes_for_others).toBe('Copy lands by noon.');
    expect(JSON.parse(rr.finished)).toEqual([{ what: 'Outline', proof: 'https://docs.example.com/outline' }]);
    expect(w.ctx.db.prepare('SELECT status, answer, answerer_id FROM questions WHERE id = ?').get(qid)).toEqual({
      status: 'answered',
      answer: 'Pro tier.',
      answerer_id: w.a.agent.id,
    });
    expect(w.ctx.db.prepare('SELECT status, proof FROM instructions WHERE id = ?').get(iid)).toEqual({
      status: 'done',
      proof: 'https://docs.example.com/email',
    });
    expect(count(w.ctx, "SELECT COUNT(*) n FROM questions WHERE text = 'Is the pricing table final?' AND target_kind = 'agent'")).toBe(1);
    expect(count(w.ctx, "SELECT COUNT(*) n FROM playbook_entries WHERE title = 'Link the doc'")).toBe(1);
    expect((w.ctx.db.prepare('SELECT status FROM cards WHERE id = ?').get(cardId) as any).status).toBe('completed');

    // Both calls of the check-in are in the connection log as the page door, with no secret in them.
    const rows = w.ctx.db.prepare("SELECT action, result, http_status, card_id FROM connection_log WHERE door = 'page' ORDER BY id").all();
    expect(rows).toEqual([
      { action: 'check_in', result: 'ok', http_status: 200, card_id: cardId },
      { action: 'report', result: 'ok', http_status: 200, card_id: cardId },
    ]);
    expect(JSON.stringify(w.ctx.db.prepare('SELECT * FROM connection_log').all())).not.toContain(w.a.pageToken);

    // Sending it again (a browser refresh) updates the same report; nothing is duplicated.
    const again = await postPage(w, w.a.pageToken, {
      card_id: cardId,
      [`room.${rid}.working_on`]: 'Drafting the hero copy.',
      [`answer.${qid}`]: 'Pro tier.',
      [`ins.${iid}.status`]: 'done',
      [`ins.${iid}.proof`]: 'https://docs.example.com/email',
    });
    expect(again.statusCode).toBe(200);
    expect(again.body).toContain('updated (revision 2). Nothing was duplicated.');
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM reports')).toBe(1);
  });

  it('shows items that arrived after the card was issued', async () => {
    const { w, iid, qid } = await worldWithWork();
    const cardId = cardIdOf((await getPage(w, w.a.pageToken)).body);
    w.clock.advanceMinutes(5);
    personPost(w.ctx, w.henry, w.room.id, { kind: 'question', to: 'Muse Henry', text: 'One more thing: what is the deadline?' });
    const res = await postPage(w, w.a.pageToken, {
      card_id: cardId,
      [`room.${w.room.id}.working_on`]: 'Drafting.',
      [`answer.${qid}`]: 'Pro tier.',
      [`ins.${iid}.status`]: 'acknowledged',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Arrived for you after your card was issued');
    expect(res.body).toContain('One more thing: what is the deadline?');
  });

  it('explains a card it cannot use and offers the page link again, with no form', async () => {
    const { w, iid, qid } = await worldWithWork();
    const full = (cardId: string) => ({
      card_id: cardId,
      [`room.${w.room.id}.working_on`]: 'x',
      [`answer.${qid}`]: 'y',
      [`ins.${iid}.status`]: 'acknowledged',
    });
    const oldCard = cardIdOf((await getPage(w, w.a.pageToken)).body);

    const unknown = await postPage(w, w.a.pageToken, full('card_999'));
    expect(unknown.statusCode).toBe(422);
    expect(decode(unknown.body)).toContain('card_id "card_999" is not a card Tempo gave you');
    expect(unknown.body).not.toContain('<form');
    expect(unknown.body).toContain(`<a href="/a/${w.a.pageToken}">`);
    SECURITY_HEADERS(unknown.headers);

    const nothing = await postPage(w, w.a.pageToken, '');
    expect(nothing.statusCode).toBe(422);
    expect(decode(nothing.body)).toContain('Report not accepted. Missing: card_id.');

    // Someone else's card is just as unknown.
    const cb = (await checkIn(w, w.b.apiKey)).body;
    const theirs = await postPage(w, w.a.pageToken, full(cb.card_id));
    expect(theirs.statusCode).toBe(422);
    expect(decode(theirs.body)).toContain('is not a card Tempo gave you');

    // The old card was replaced after it ran out of time and the agent opened the page again.
    w.clock.advanceMinutes(30);
    const newCard = cardIdOf((await getPage(w, w.a.pageToken)).body);
    expect(newCard).not.toBe(oldCard);
    const replaced = await postPage(w, w.a.pageToken, full(oldCard));
    expect(replaced.statusCode).toBe(409);
    expect(decode(replaced.body)).toContain(`replaced by a newer card, "${newCard}"`);
    expect(replaced.body).not.toContain('<form');
    expect(replaced.body).toContain('open your Tempo page again');
  });
});

describe('agent page: escaping', () => {
  it("shows another agent's script tag as text, never as markup", async () => {
    const w = await makeWorld();
    const cb = (await checkIn(w, w.b.apiKey)).body;
    const evil = '<script>alert(1)</script>';
    const sent = await report(
      w,
      w.b.apiKey,
      fullReport(cb, {
        rooms: [{ room_id: w.room.id, working_on: evil, notes_for_others: '<img src=x onerror=alert(2)>' }],
        questions: [{ to: 'Muse Henry', text: '<b onmouseover="alert(3)">Why?</b>' }],
      }),
    );
    expect(sent.status).toBe(200);
    w.clock.advanceMinutes(5);

    const res = await getPage(w, w.a.pageToken);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.body).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(res.body).toContain('&lt;b onmouseover=&quot;alert(3)&quot;&gt;Why?&lt;/b&gt;');
    expect(res.body).not.toMatch(/<script/i);
    expect(res.body).not.toContain('<img');
    expect(res.body).not.toContain('<b onmouseover');
    expect(res.body).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
  });

  it('keeps typed values escaped when the form comes back, even if they try to close the text box', async () => {
    const { w } = await worldWithWork();
    const cardId = cardIdOf((await getPage(w, w.a.pageToken)).body);
    const nasty = '</textarea><script>alert(1)</script>"><input type="hidden" name="card_id" value="card_9">';
    const res = await postPage(w, w.a.pageToken, {
      card_id: cardId,
      [`room.${w.room.id}.notes_for_others`]: nasty,
      'lesson.1.title': nasty,
      'question.1.to': '"><script>alert(2)</script>',
      'question.1.text': 'Hi',
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).not.toMatch(/<script/i);
    expect(res.body.match(/type="hidden"/g)).toHaveLength(1);
    expect(cardIdOf(res.body)).toBe(cardId);
    expect(textareaValue(res.body, `room.${w.room.id}.notes_for_others`)).toBe(nasty);
    expect(inputValue(res.body, 'lesson.1.title')).toBe(nasty);
    // A value that is not on the "to" menu is kept (as an escaped option), not silently dropped.
    expect(selectedOption(res.body, 'question.1.to')).toBe('"><script>alert(2)</script>');
  });

  it('makes web addresses in agent text clickable, and nothing else', async () => {
    const w = await makeWorld();
    personPost(w.ctx, w.henry, w.room.id, {
      kind: 'instruction',
      to: 'Muse Henry',
      text: 'Read https://docs.example.com/brief?a=1&b=2. Do not open javascript:alert(1) or <a href="https://evil.test">this</a>.',
      done_when: 'Notes are in http://example.org/notes (see the file).',
    });
    const body = (await getPage(w, w.a.pageToken)).body;
    expect(body).toContain('<a href="https://docs.example.com/brief?a=1&amp;b=2" rel="noopener noreferrer nofollow">https://docs.example.com/brief?a=1&amp;b=2</a>.');
    expect(body).toContain('<a href="http://example.org/notes" rel="noopener noreferrer nofollow">http://example.org/notes</a> (see the file).');
    expect(body).toContain('javascript:alert(1)');
    expect(body).not.toContain('href="javascript');
    expect(body).toContain('&lt;a href=&quot;');
    const anchors = [...body.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    expect(anchors.length).toBeGreaterThanOrEqual(3);
    for (const a of anchors) expect(a).toMatch(/^<a href="https?:\/\/[^"]+" rel="noopener noreferrer nofollow">$/);
  });
});

describe('agent page: links, tokens and limits', () => {
  it('answers a bad link with a plain 404 page', async () => {
    const w = await makeWorld();
    const res = await getPage(w, 'pg_thisisnotarealtoken');
    expect(res.statusCode).toBe(404);
    SECURITY_HEADERS(res.headers);
    expect(res.body).toContain('This Tempo page link is not valid.');
    expect(res.body).toContain('Ask your owner for your current Tempo page link.');
    expect(res.body).not.toContain('<form');
    expect(res.body).not.toMatch(/<script/i);
    expect(res.body).toMatch(/role="alert"/);
    const post = await postPage(w, 'pg_thisisnotarealtoken', { card_id: 'card_1' });
    expect(post.statusCode).toBe(404);
    SECURITY_HEADERS(post.headers);
    // The attempts are in the connection log, without the token.
    const rows = w.ctx.db.prepare("SELECT door, action, result, http_status FROM connection_log ORDER BY id").all();
    expect(rows).toEqual([
      { door: 'page', action: 'check_in', result: 'rejected', http_status: 404 },
      { door: 'page', action: 'report', result: 'rejected', http_status: 404 },
    ]);
    expect(JSON.stringify(w.ctx.db.prepare('SELECT * FROM connection_log').all())).not.toContain('thisisnotarealtoken');
  });

  it('keeps the page token and the API key separate secrets', async () => {
    const w = await makeWorld();
    expect((await getPage(w, w.a.apiKey)).statusCode).toBe(404);
    const viaRest = await rest(w.app, w.a.pageToken, 'GET', '/api/v1/agent/whoami');
    expect(viaRest.status).toBe(401);
  });

  it('stops an old link at once when the page token is rotated, and the new one works', async () => {
    const w = await makeWorld();
    expect((await getPage(w, w.a.pageToken)).statusCode).toBe(200);
    const fresh = rotateKey(w.ctx, { kind: 'person', id: w.henry.id, name: 'Henry' }, w.a.agent.id, 'page');
    expect(fresh).not.toBe(w.a.pageToken);
    const old = await getPage(w, w.a.pageToken);
    expect(old.statusCode).toBe(404);
    expect(old.body).toContain('may have been replaced with a new link');
    const oldPost = await postPage(w, w.a.pageToken, { card_id: 'card_1' });
    expect(oldPost.statusCode).toBe(404);
    const ok = await getPage(w, fresh);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain(`action="/a/${fresh}"`);
    // The API key was not touched.
    expect((await rest(w.app, w.a.apiKey, 'GET', '/api/v1/agent/whoami')).status).toBe(200);
  });

  it('rate-limits with a plain page and a Retry-After header', async () => {
    const w = await makeWorld({ config: { agentRateLimitPerMinute: 2 } });
    expect((await getPage(w, w.a.pageToken)).statusCode).toBe(200);
    expect((await getPage(w, w.a.pageToken)).statusCode).toBe(200);
    const res = await getPage(w, w.a.pageToken);
    expect(res.statusCode).toBe(429);
    SECURITY_HEADERS(res.headers);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body).toContain('Too many requests: this key is limited to 2 requests per minute.');
    expect(res.body).not.toContain('<form');
    const post = await postPage(w, w.a.pageToken, { card_id: 'card_1' });
    expect(post.statusCode).toBe(429);
    expect(Number(post.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('answers an oversized form with a friendly 413 page, and anything but a form post with 415', async () => {
    const { w } = await worldWithWork();
    const big = await postPage(w, w.a.pageToken, 'card_id=card_1&room.room_1.working_on=' + 'x'.repeat(70_000));
    expect(big.statusCode).toBe(413);
    SECURITY_HEADERS(big.headers);
    expect(big.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(big.body).toContain('larger than 64 KB');
    expect(big.body).toContain('Nothing was saved.');
    expect(big.body).not.toMatch(/<script/i);
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM reports')).toBe(0);

    const json = await w.app.inject({
      method: 'POST',
      url: `/a/${w.a.pageToken}`,
      headers: { 'content-type': 'application/json', 'user-agent': BROWSER },
      payload: JSON.stringify({ card_id: 'card_1' }),
    });
    expect(json.statusCode).toBe(415);
    SECURITY_HEADERS(json.headers);
    expect(json.body).toContain('only accepts the form');
  });

  it('gives other methods and odd paths under /a/ a plain page too', async () => {
    const w = await makeWorld();
    const put = await w.app.inject({ method: 'PUT', url: `/a/${w.a.pageToken}`, headers: { 'user-agent': BROWSER } });
    expect(put.statusCode).toBe(405);
    expect(put.headers['allow']).toBe('GET, HEAD, POST');
    SECURITY_HEADERS(put.headers);
    for (const url of ['/a/', `/a/${w.a.pageToken}/extra`, `/a/${w.a.pageToken}/`]) {
      const res = await w.app.inject({ method: 'GET', url, headers: { 'user-agent': BROWSER } });
      expect(res.statusCode, url).toBe(404);
      SECURITY_HEADERS(res.headers);
      expect(res.body).toContain('This Tempo page link is not valid.');
    }
    // None of that opened a card.
    expect(count(w.ctx, 'SELECT COUNT(*) n FROM cards')).toBe(0);
    // A form post with no Content-Type and no body gets the standard "missing card_id" answer.
    const bare = await w.app.inject({ method: 'POST', url: `/a/${w.a.pageToken}`, headers: { 'user-agent': BROWSER } });
    expect(bare.statusCode).toBe(422);
    expect(decode(bare.body)).toContain('Report not accepted. Missing: card_id.');
  });

  it('puts the privacy headers on every kind of response from the door', async () => {
    const { w } = await worldWithWork();
    const cardId = cardIdOf((await getPage(w, w.a.pageToken)).body);
    const responses = [
      await getPage(w, w.a.pageToken),
      await getPage(w, w.a.pageToken, 'WhatsApp/2.23.20.0'),
      await getPage(w, 'bad'),
      await postPage(w, w.a.pageToken, { card_id: cardId }),
      await postPage(w, w.a.pageToken, { card_id: 'card_404' }),
      await postPage(w, 'bad', { card_id: cardId }),
    ];
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 404, 422, 422, 404]);
    for (const r of responses) {
      SECURITY_HEADERS(r.headers);
      expect(r.body).toContain('<meta name="robots" content="noindex,nofollow">');
      expect(r.body).toContain('<meta name="referrer" content="no-referrer">');
    }
  });
});
