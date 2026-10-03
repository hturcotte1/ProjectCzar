import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { buildAgentsGuide } from '../src/server/docs/agents-guide.js';
import { buildOpenApi, docSettings } from '../src/server/docs/openapi.js';
import { writeOpenApi } from '../src/server/cli/write-openapi.js';
import {
  Card,
  ErrorResult,
  LookupInput,
  LookupResult,
  PostInput,
  PostResult,
  ReportInput,
  ReportResult,
  WhoamiResult,
} from '../src/server/schemas/agent.js';
import { personPost } from '../src/server/services/people-actions.js';
import { makeWorld, rest, type World } from './helpers.js';

/**
 * The public docs: /openapi.json (OpenAPI 3.1) and the guide at /agents.md and /llms.txt.
 *
 * Every example in the guide is run, in order, against a seeded Tempo, and the answer Tempo gives
 * has to match the answer the guide documents. The guide tells one story (see seedStory), so the
 * ids in it (card_1, q_1, ins_1, rep_1, room_1) are the ones a fresh database really produces.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const DOC_BASE = 'http://tempo.test';

// ---------------------------------------------------------------------------------------------
// The "documented subset" matcher
// ---------------------------------------------------------------------------------------------

function wildcard(pattern: string): RegExp {
  const parts = pattern.split('...').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('[\\s\\S]*')}$`);
}

/**
 * Lists where `actual` fails to contain everything `expected` documents:
 *  - every key in an expected object must be present and match (extra keys in the answer are fine);
 *  - an expected array matches the first items of the real array (extra items are fine), except
 *    that an empty expected array means the real one is empty;
 *  - a string containing "..." matches any text in place of the dots; other values match exactly.
 */
function subsetMismatches(expected: unknown, actual: unknown, at = '$'): string[] {
  if (typeof expected === 'string') {
    if (typeof actual !== 'string') return [`${at}: expected text ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`];
    const same = expected.includes('...') ? wildcard(expected).test(actual) : expected === actual;
    return same ? [] : [`${at}: expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${at}: expected a list but got ${JSON.stringify(actual)}`];
    if (expected.length === 0) return actual.length === 0 ? [] : [`${at}: expected an empty list but got ${actual.length} item(s): ${JSON.stringify(actual)}`];
    if (actual.length < expected.length) return [`${at}: expected at least ${expected.length} item(s) but got ${actual.length}: ${JSON.stringify(actual)}`];
    return expected.flatMap((item, i) => subsetMismatches(item, actual[i], `${at}[${i}]`));
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return [`${at}: expected an object but got ${JSON.stringify(actual)}`];
    return Object.entries(expected).flatMap(([key, value]) =>
      key in actual ? subsetMismatches(value, (actual as Record<string, unknown>)[key], `${at}.${key}`) : [`${at}.${key}: missing from the real answer`],
    );
  }
  return Object.is(expected, actual) ? [] : [`${at}: expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`];
}

describe('the documented-subset matcher', () => {
  it('allows extra keys and items, wildcards and nothing else', () => {
    expect(subsetMismatches({ a: 1, b: { c: 'x' } }, { a: 1, b: { c: 'x', d: 2 }, e: 3 })).toEqual([]);
    expect(subsetMismatches({ a: 'card_...' }, { a: 'card_12' })).toEqual([]);
    expect(subsetMismatches({ a: 'Report ... saved. Next ...' }, { a: 'Report card_1 saved. Next due\nMonday' })).toEqual([]);
    expect(subsetMismatches([{ id: 'q_1' }], [{ id: 'q_1', x: 1 }, { id: 'q_2' }])).toEqual([]);
    expect(subsetMismatches({ a: 1 }, { a: 2 })).toHaveLength(1);
    expect(subsetMismatches({ a: 'x' }, {})).toHaveLength(1);
    expect(subsetMismatches({ a: 'abc' }, { a: 'abcd' })).toHaveLength(1);
    expect(subsetMismatches({ a: [] }, { a: [1] })).toHaveLength(1);
    expect(subsetMismatches({ a: [1, 2] }, { a: [1] })).toHaveLength(1);
    expect(subsetMismatches({ a: null }, { a: 'x' })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Reading the guide
// ---------------------------------------------------------------------------------------------

interface Block {
  lang: string;
  body: string;
  /** The last line of text before the block. */
  before: string;
}

function codeBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let before = '';
  let open: { lang: string; lines: string[]; before: string } | null = null;
  for (const line of markdown.split('\n')) {
    if (open) {
      if (line.startsWith('```')) {
        blocks.push({ lang: open.lang, body: open.lines.join('\n'), before: open.before });
        open = null;
      } else open.lines.push(line);
      continue;
    }
    const m = /^```(\w*)\s*$/.exec(line);
    if (m) {
      open = { lang: m[1], lines: [], before };
      continue;
    }
    if (line.trim()) before = line.trim();
  }
  if (open) throw new Error('The guide has a code block that is never closed.');
  return blocks;
}

type Example =
  | { kind: 'curl'; label: string; command: string; status: number; expected: unknown }
  | { kind: 'mcp'; label: string; id: number; name: string; args: Record<string, unknown>; expected: unknown }
  | { kind: 'report-body'; label: string; body: unknown };

/** Every code block in the guide must be one of the kinds the test knows how to check. */
function extractExamples(markdown: string): Example[] {
  const blocks = codeBlocks(markdown);
  const out: Example[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const where = `code block ${i + 1} (after "${b.before.slice(0, 60)}")`;
    if (b.lang === 'bash') {
      const next = blocks[i + 1];
      const status = next && next.lang === 'json' ? /^Response \(HTTP (\d{3})\):$/.exec(next.before) : null;
      if (!status) throw new Error(`${where}: a curl example must be followed by "Response (HTTP nnn):" and a json block.`);
      out.push({ kind: 'curl', label: b.body.split('\n')[0], command: b.body, status: Number(status[1]), expected: JSON.parse(next.body) });
      i++;
    } else if (b.lang === 'json' && b.before.startsWith('MCP request')) {
      const request = JSON.parse(b.body) as { jsonrpc: string; id: number; method: string; params: { name: string; arguments: Record<string, unknown> } };
      const next = blocks[i + 1];
      if (!next || next.lang !== 'json' || !next.before.startsWith('MCP response')) throw new Error(`${where}: an MCP request must be followed by an "MCP response" json block.`);
      expect(request.method).toBe('tools/call');
      out.push({ kind: 'mcp', label: `${request.params.name} (id ${request.id})`, id: request.id, name: request.params.name, args: request.params.arguments, expected: JSON.parse(next.body) });
      i++;
    } else if (b.lang === 'json' && b.before.startsWith('Example report body')) {
      out.push({ kind: 'report-body', label: where, body: JSON.parse(b.body) });
    } else {
      throw new Error(`${where}: this ${b.lang || 'plain'} block is not something the docs test knows how to check.`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Running a curl example
// ---------------------------------------------------------------------------------------------

/** Splits a command the way a shell would, expanding only $TEMPO_KEY. */
function shellSplit(command: string, vars: Record<string, string>): string[] {
  const src = command.replace(/\\\n/g, ' ');
  const tokens: string[] = [];
  let cur = '';
  let started = false;
  const expand = (at: number): number => {
    const m = /^\$\{?([A-Za-z_]+)\}?/.exec(src.slice(at));
    if (!m || !(m[1] in vars)) throw new Error(`Unknown variable in the guide's command: ${src.slice(at, at + 20)}`);
    cur += vars[m[1]];
    return at + m[0].length;
  };
  for (let i = 0; i < src.length; ) {
    const ch = src[i];
    if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw new Error('Unclosed single quote in the guide.');
      cur += src.slice(i + 1, end);
      started = true;
      i = end + 1;
    } else if (ch === '"') {
      started = true;
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && '"\\$`'.includes(src[i + 1])) {
          cur += src[i + 1];
          i += 2;
        } else if (src[i] === '$') i = expand(i);
        else cur += src[i++];
      }
      if (src[i] !== '"') throw new Error('Unclosed double quote in the guide.');
      i++;
    } else if (/\s/.test(ch)) {
      if (started) tokens.push(cur);
      cur = '';
      started = false;
      i++;
    } else if (ch === '$') {
      started = true;
      i = expand(i);
    } else {
      cur += ch;
      started = true;
      i++;
    }
  }
  if (started) tokens.push(cur);
  return tokens;
}

interface CurlRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function parseCurl(command: string, vars: Record<string, string>): CurlRequest {
  const t = shellSplit(command, vars);
  if (t.shift() !== 'curl') throw new Error(`Not a curl command: ${command}`);
  let method: string | undefined;
  let url: string | undefined;
  let body: string | undefined;
  const headers: Record<string, string> = {};
  while (t.length) {
    const arg = t.shift()!;
    if (arg === '-s' || arg === '--silent') continue;
    else if (arg === '-X' || arg === '--request') method = t.shift();
    else if (arg === '-H' || arg === '--header') {
      const h = t.shift()!;
      const at = h.indexOf(':');
      headers[h.slice(0, at).trim()] = h.slice(at + 1).trim();
    } else if (arg === '-d' || arg === '--data' || arg === '--data-raw') body = t.shift();
    else if (/^https?:\/\//.test(arg)) url = arg;
    else throw new Error(`The guide uses a curl option the docs test does not support: ${arg}`);
  }
  if (!url) throw new Error(`No URL in: ${command}`);
  return { method: method ?? (body !== undefined ? 'POST' : 'GET'), url, headers, body };
}

// ---------------------------------------------------------------------------------------------
// The seeded world the guide's story assumes
// ---------------------------------------------------------------------------------------------

/**
 * Muse Sam posts a note and asks Muse Henry a question (q_1); Henry gives Muse Henry an
 * instruction (ins_1). Muse Henry has not checked in yet, so its first card is card_1.
 */
async function seedStory(w: World): Promise<void> {
  const note = await rest(w.app, w.b.apiKey, 'POST', '/api/v1/agent/post', { kind: 'note', text: 'Pricing table draft is in the shared doc.' });
  expect(note.status).toBe(200);
  const question = await rest(w.app, w.b.apiKey, 'POST', '/api/v1/agent/post', { kind: 'question', to: 'Muse Henry', text: 'Which pricing tier are we launching with?' });
  expect(question.body.id).toBe('q_1');
  const ins = personPost(w.ctx, w.henry, w.room.id, { kind: 'instruction', to: 'Muse Henry', text: 'Draft the launch email.', done_when: 'The draft is in the shared doc.' });
  expect(ins.ids).toEqual(['ins_1']);
  expect(w.room.id).toBe('room_1');
}

const RESPONSE_SCHEMAS: { path: RegExp; schema: z.ZodType }[] = [
  { path: /\/check-in$/, schema: Card },
  { path: /\/report$/, schema: ReportResult },
  { path: /\/whoami$/, schema: WhoamiResult },
  { path: /\/post$/, schema: PostResult },
  { path: /\/lookup$/, schema: LookupResult },
];

const TOOL_SCHEMAS: Record<string, z.ZodType> = {
  tempo_check_in: Card,
  tempo_report: ReportResult,
  tempo_whoami: WhoamiResult,
  tempo_post: PostResult,
  tempo_lookup: LookupResult,
};

async function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; text: string }> {
  const r = await fetch(url, { headers });
  return { status: r.status, headers: r.headers, text: await r.text() };
}

// ---------------------------------------------------------------------------------------------
// The guide: /agents.md and /llms.txt
// ---------------------------------------------------------------------------------------------

describe('the guide for AI agents', () => {
  it('is public, served as Markdown and as plain text, with the real base URL', async () => {
    const w = await makeWorld();
    try {
      const md = await w.app.inject({ method: 'GET', url: '/agents.md' });
      expect(md.statusCode).toBe(200);
      expect(md.headers['content-type']).toBe('text/markdown; charset=utf-8');
      expect(md.headers['cache-control']).toBe('public, max-age=300');
      const txt = await w.app.inject({ method: 'GET', url: '/llms.txt' });
      expect(txt.statusCode).toBe(200);
      expect(txt.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(txt.headers['cache-control']).toBe('public, max-age=300');
      expect(txt.body).toBe(md.body);

      const body = md.body;
      for (const heading of [
        '# Tempo: a guide for AI agents',
        '## What Tempo is',
        '## Connecting',
        '## The check-in loop',
        '## Field reference for the report',
        '## The other tools',
        '## Worked examples',
        '## Errors and what to do about each',
        '## Limits and safety',
      ]) {
        expect(body.split('\n'), heading).toContain(heading);
      }
      expect(body).toContain(`${DOC_BASE}/mcp`);
      expect(body).toContain(`${DOC_BASE}/openapi.json`);
      expect(body).toContain(`${DOC_BASE}/api/v1/agent/check-in`);
      for (const tool of Object.keys(TOOL_SCHEMAS)) expect(body).toContain(tool);
      for (const phrase of ['20 minutes', 'same card_id', 'Authorization: Bearer', 'X-API-Key', '2,000 characters', 'There are no file uploads']) {
        expect(body, phrase).toContain(phrase);
      }
      // No unfilled placeholders, and nothing secret.
      expect(body).not.toMatch(/\$\{|undefined|\[object Object\]|~/);
      expect(body).not.toContain(w.a.apiKey);
      expect(body).not.toContain(w.a.pageToken);
      // 304 for a repeat visitor.
      const again = await w.app.inject({ method: 'GET', url: '/agents.md', headers: { 'if-none-match': String(md.headers['etag']) } });
      expect(again.statusCode).toBe(304);
    } finally {
      await w.app.close();
    }
  });

  it('uses whatever base URL and limits the server is configured with', () => {
    const guide = buildAgentsGuide('https://tempo.example.org', { cardTimeoutMinutes: 30, rateLimitPerMinute: 10, bodyLimitKb: 32 });
    expect(guide).not.toContain('tempo.test');
    expect(guide).toContain('https://tempo.example.org/mcp');
    expect(guide).toContain('curl -s "https://tempo.example.org/api/v1/agent/whoami"');
    expect(guide).toContain('within 30 minutes');
    expect(guide).toContain('10 requests per minute');
    expect(guide).toContain('over 32 KB');
  });

  it.each([['/agents.md'], ['/llms.txt']])('every example in %s is run and matches what Tempo really answers', async (docPath) => {
    const w = await makeWorld();
    await seedStory(w);
    const baseUrl = await w.app.listen({ port: 0, host: '127.0.0.1' });
    let client: Client | null = null;
    try {
      // Public: no key, no cookie.
      const doc = await get(`${baseUrl}${docPath}`);
      expect(doc.status).toBe(200);
      const examples = extractExamples(doc.text);

      const curls = examples.filter((e): e is Extract<Example, { kind: 'curl' }> => e.kind === 'curl');
      const mcps = examples.filter((e) => e.kind === 'mcp');
      expect(curls.length + mcps.length).toBeGreaterThanOrEqual(7);
      expect(curls.length).toBeGreaterThanOrEqual(7);
      expect(mcps.length).toBeGreaterThanOrEqual(2);
      expect(examples.some((e) => e.kind === 'report-body')).toBe(true);
      // The story the guide promises: connection, card, an incomplete report, the corrected one, a post, a lookup, a key error.
      expect(curls.map((c) => `${c.command.match(/"[^"]*\/agent\/([a-z-]+)/)?.[1]}:${c.status}`)).toEqual([
        'whoami:200',
        'check-in:200',
        'report:422',
        'report:200',
        'post:200',
        'lookup:200',
        'whoami:401',
      ]);

      for (const ex of examples) {
        if (ex.kind === 'report-body') {
          // A reference block: it has to be a valid report.
          expect(ReportInput.safeParse(ex.body).success, ex.label).toBe(true);
          continue;
        }

        if (ex.kind === 'curl') {
          const req = parseCurl(ex.command, { TEMPO_KEY: w.a.apiKey });
          expect(req.url.startsWith(DOC_BASE), `${ex.label} should use the real base URL`).toBe(true);
          const res = await fetch(req.url.replace(DOC_BASE, baseUrl), { method: req.method, headers: req.headers, body: req.body });
          const text = await res.text();
          const actual: unknown = JSON.parse(text);
          const context = `${ex.command}\n--> HTTP ${res.status}\n${text}`;
          expect(res.status, context).toBe(ex.status);
          expect(subsetMismatches(ex.expected, actual), context).toEqual([]);
          // The real answer is what the contract says it is.
          const pathname = new URL(req.url).pathname;
          const schema = res.status === 200 ? RESPONSE_SCHEMAS.find((s) => s.path.test(pathname))?.schema : ErrorResult;
          expect(schema, `no schema for ${pathname}`).toBeDefined();
          const parsed = schema!.safeParse(actual);
          expect(parsed.success, `${context}\n${parsed.success ? '' : parsed.error.message}`).toBe(true);
          // The key never appears in anything the guide shows, and 401s tell the agent how to fix it.
          expect(JSON.stringify(ex.expected)).not.toContain(w.a.apiKey);
          if (res.status === 401) expect(res.headers.get('www-authenticate')).toMatch(/Bearer/);
          continue;
        }

        // MCP: the official client sends the tools/call message for us.
        if (!client) {
          client = new Client({ name: 'docs-test', version: '1.0.0' });
          await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${w.a.apiKey}` } } }));
        }
        const result = await client.callTool({ name: ex.name, arguments: ex.args });
        const envelope = { jsonrpc: '2.0', id: ex.id, result };
        const context = `MCP ${ex.label}\n--> ${JSON.stringify(result)}`;
        expect(subsetMismatches(ex.expected, envelope), context).toEqual([]);
        if (!result.isError) {
          const parsed = TOOL_SCHEMAS[ex.name].safeParse(result.structuredContent);
          expect(parsed.success, `${context}\n${parsed.success ? '' : parsed.error.message}`).toBe(true);
        }
      }

      // The story left the records the guide describes.
      const reports = w.ctx.db.prepare('SELECT id, card_id FROM reports ORDER BY id').all() as { id: string; card_id: string }[];
      expect(reports).toEqual([
        { id: 'rep_1', card_id: 'card_1' },
        { id: 'rep_2', card_id: 'card_2' },
      ]);
      const ins = w.ctx.db.prepare('SELECT status, proof FROM instructions WHERE id = ?').get('ins_1') as { status: string; proof: string };
      expect(ins).toEqual({ status: 'done', proof: 'https://docs.example.com/launch-email-draft' });
    } finally {
      if (client) await (client as Client).close();
      await w.app.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// OpenAPI
// ---------------------------------------------------------------------------------------------

type Json = Record<string, any>;

/** The REST routes, read from the door's own table so a new route cannot be forgotten here. */
function restRoutes(): { method: string; path: string }[] {
  const source = readFileSync(path.join(ROOT, 'src/server/doors/rest.ts'), 'utf8');
  return [...source.matchAll(/\{ method: '(GET|POST)', path: '([^']+)'/g)].map((m) => ({ method: m[1].toLowerCase(), path: m[2] }));
}

const OPERATION_SCHEMAS: Record<string, string> = {
  checkIn: 'Card',
  report: 'ReportResult',
  whoami: 'WhoamiResult',
  whoamiPost: 'WhoamiResult',
  post: 'PostResult',
  lookup: 'LookupResult',
  lookupPost: 'LookupResult',
};

const OUTPUT_ZOD: Record<string, z.ZodType> = { Card, ReportResult, WhoamiResult, PostResult, LookupResult };

function resolve(doc: Json, node: Json): Json {
  if (typeof node.$ref !== 'string') return node;
  const target = node.$ref.replace(/^#\//, '').split('/').reduce<Json>((acc, key) => acc[key], doc);
  if (!target) throw new Error(`Dangling $ref ${node.$ref}`);
  return target;
}

function operations(doc: Json): { method: string; path: string; op: Json }[] {
  return Object.entries<Json>(doc.paths).flatMap(([p, item]) =>
    Object.entries<Json>(item)
      .filter(([m]) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
      .map(([method, op]) => ({ method, path: p, op })),
  );
}

describe('the OpenAPI document', () => {
  it('is public JSON, valid OpenAPI 3.1, and the same on every request', async () => {
    const w = await makeWorld();
    try {
      const res = await w.app.inject({ method: 'GET', url: '/openapi.json' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      const doc = JSON.parse(res.body) as Json;
      expect(doc.openapi).toMatch(/^3\.1\./);
      expect(doc.servers).toEqual([{ url: DOC_BASE, description: expect.any(String) }]);
      expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
      expect(doc.components.securitySchemes.apiKeyHeader).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-API-Key' });
      expect(doc.security).toEqual([{ bearerAuth: [] }, { apiKeyHeader: [] }]);
      expect(doc.info.license?.name).toBeTruthy();
      // Deterministic: the same for a given base URL and settings.
      const again = buildOpenApi(DOC_BASE, docSettings(w.ctx.config));
      expect(res.body).toBe(JSON.stringify(again));
      expect(JSON.stringify(buildOpenApi(DOC_BASE))).toBe(JSON.stringify(buildOpenApi(DOC_BASE)));
      expect(JSON.stringify(buildOpenApi('https://tempo.example.org'))).not.toContain('tempo.test');
      // Nothing secret.
      expect(res.body).not.toContain(w.a.apiKey);
      expect(res.body).not.toContain(w.a.pageToken);
      // And a repeat visitor gets a 304.
      const cached = await w.app.inject({ method: 'GET', url: '/openapi.json', headers: { 'if-none-match': String(res.headers['etag']) } });
      expect(cached.statusCode).toBe(304);
    } finally {
      await w.app.close();
    }
  });

  it('passes the Redocly linter with no errors and no warnings', async () => {
    const w = await makeWorld();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tempo-openapi-'));
    try {
      const res = await w.app.inject({ method: 'GET', url: '/openapi.json' });
      const file = path.join(dir, 'openapi.json');
      writeFileSync(file, res.body);
      const redocly = path.join(ROOT, 'node_modules', '.bin', 'redocly');
      // Redocly writes its report to stderr when all is well, so read both streams.
      const run = spawnSync(process.execPath, [redocly, 'lint', file, '--format=stylish'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, REDOCLY_TELEMETRY: 'off', NO_UPDATE_NOTIFIER: '1' },
      });
      const output = `${run.stdout}\n${run.stderr}`;
      expect(run.status, output).toBe(0);
      expect(output).toMatch(/valid/);
      expect(output).not.toMatch(/warning|error/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await w.app.close();
    }
  }, 120_000);

  it('describes every REST route, and only real ones', async () => {
    const doc = buildOpenApi(DOC_BASE) as Json;
    const routes = restRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(7);
    for (const r of routes) {
      expect(doc.paths[r.path]?.[r.method], `${r.method.toUpperCase()} ${r.path}`).toBeDefined();
    }
    const documented = operations(doc).map((o) => `${o.method} ${o.path}`).sort();
    expect(documented).toEqual(routes.map((r) => `${r.method} ${r.path}`).sort());
    // The check-in opens a card, so it is a POST and never described as safe or read-only.
    expect(doc.paths['/api/v1/agent/check-in'].get).toBeUndefined();
    expect(doc.paths['/api/v1/agent/check-in'].post.description).toMatch(/is a POST because it opens a card/);
    expect(doc.paths['/api/v1/agent/check-in'].post.description).toMatch(/not a read-only call/);
  });

  it('gives every operation an id, a summary, a description, a request, a 200 schema and documented errors', () => {
    const doc = buildOpenApi(DOC_BASE) as Json;
    const ids = new Set<string>();
    for (const { method, path: p, op } of operations(doc)) {
      const name = `${method.toUpperCase()} ${p}`;
      expect(op.operationId, name).toMatch(/^[a-z][A-Za-z]+$/);
      expect(ids.has(op.operationId), `${name}: duplicate operationId`).toBe(false);
      ids.add(op.operationId);
      expect(op.summary, name).toBeTruthy();
      expect(op.description?.length, name).toBeGreaterThan(80);
      // A request: a body for POST, parameters for GET lookup, nothing for GET whoami.
      if (method === 'post') expect(op.requestBody?.content?.['application/json']?.schema, `${name}: request body`).toBeDefined();
      if (op.operationId === 'lookup') expect(op.parameters.map((x: Json) => x.name)).toEqual(['room_id', 'query', 'id', 'kind', 'limit']);
      // The 200 response is the contract's own schema.
      const schemaName = OPERATION_SCHEMAS[op.operationId];
      expect(schemaName, `${name}: unknown operation`).toBeDefined();
      expect(op.responses['200'].content['application/json'].schema).toEqual({ $ref: `#/components/schemas/${schemaName}` });
      expect(doc.components.schemas[schemaName]).toBeDefined();
      // Error responses reference the error schema and carry examples.
      const errors = Object.keys(op.responses).filter((s) => /^[45]/.test(s));
      expect(errors, name).toEqual(expect.arrayContaining(['401', '429', '500']));
      for (const status of errors) {
        const response = resolve(doc, op.responses[status]);
        const media = response.content['application/json'];
        expect(media.schema, `${name} ${status}`).toEqual({ $ref: '#/components/schemas/ErrorResult' });
        expect(Object.keys(media.examples).length, `${name} ${status}: examples`).toBeGreaterThan(0);
      }
    }
    // Report and post can also fail in the ways the guide lists.
    const byId = Object.fromEntries(operations(doc).map((o) => [o.op.operationId, o.op])) as Json;
    expect(Object.keys(byId.report.responses)).toEqual(expect.arrayContaining(['409', '410', '413', '422']));
    expect(Object.keys(byId.post.responses)).toEqual(expect.arrayContaining(['403', '409', '422']));
    expect(Object.keys(byId.lookup.responses)).toEqual(expect.arrayContaining(['403', '404', '422']));
  });

  it('has examples that are valid against the contract', () => {
    const doc = buildOpenApi(DOC_BASE) as Json;
    const requestSchemas: Record<string, z.ZodType> = { report: ReportInput, post: PostInput, lookupPost: LookupInput };
    let checked = 0;
    for (const { op } of operations(doc)) {
      for (const [status, raw] of Object.entries<Json>(op.responses)) {
        const media = resolve(doc, raw).content['application/json'];
        const schema = status === '200' ? OUTPUT_ZOD[OPERATION_SCHEMAS[op.operationId]] : ErrorResult;
        for (const [name, ex] of Object.entries<Json>(media.examples)) {
          const parsed = schema.safeParse(ex.value);
          expect(parsed.success, `${op.operationId} ${status} ${name}: ${parsed.success ? '' : parsed.error.message}`).toBe(true);
          checked++;
        }
      }
      const request = requestSchemas[op.operationId];
      if (request) {
        for (const [name, ex] of Object.entries<Json>(op.requestBody.content['application/json'].examples)) {
          const parsed = request.safeParse(ex.value);
          expect(parsed.success, `${op.operationId} request ${name}: ${parsed.success ? '' : parsed.error.message}`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(25);
    // Shared error responses are used by the operations and also carry examples.
    for (const [name, response] of Object.entries<Json>(doc.components.responses)) {
      for (const ex of Object.values<Json>(response.content['application/json'].examples)) {
        expect(ErrorResult.safeParse(ex.value).success, name).toBe(true);
      }
    }
  });

  it('is generated from the zod schemas, so the required fields match', () => {
    const doc = buildOpenApi(DOC_BASE) as Json;
    expect(doc.components.schemas.ReportInput.required).toEqual(['card_id']);
    expect(doc.components.schemas.ReportRoom.required).toContain('working_on');
    expect(doc.components.schemas.Card.required).toEqual(expect.arrayContaining(['card_id', 'rooms', 'you_must_send_back']));
    expect(doc.components.schemas.ErrorResult.properties.error.required).toEqual(['code', 'message']);
    expect(doc.components.schemas.InstructionStatus.enum).toEqual(['acknowledged', 'in_progress', 'done', 'blocked', 'declined']);
    expect(doc.components.schemas.PostInput.properties.kind.$ref).toBe('#/components/schemas/PostKind');
    // Responses may grow fields, so they do not forbid unknown ones.
    expect(JSON.stringify(doc.components.schemas)).not.toContain('"additionalProperties":false');
  });

  it('is what the write-openapi command writes for the linter script', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tempo-write-openapi-'));
    try {
      const out = writeOpenApi(path.join(dir, 'nested', 'openapi.json'), DOC_BASE);
      expect(readFileSync(out, 'utf8')).toBe(JSON.stringify(buildOpenApi(DOC_BASE), null, 2) + '\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
