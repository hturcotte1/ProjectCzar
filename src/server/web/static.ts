import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

/**
 * Serves the built control room (dist/web) and falls back to index.html for its client-side
 * routes. Everything is served from this origin; nothing loads from third parties.
 */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

const SPA_ROUTES = /^\/($|login|invite\/|rooms|agents|settings|alerts|people|setup|rehearsal)/;

export async function registerStatic(app: FastifyInstance, webDir: string): Promise<void> {
  const index = path.join(webDir, 'index.html');
  if (!fs.existsSync(index)) {
    app.get('/', async (_req, reply) =>
      reply
        .type('text/plain; charset=utf-8')
        .send('Tempo is running, but the control room has not been built yet. Run "npm run build" and restart.'),
    );
    return;
  }
  const html = fs.readFileSync(index, 'utf8');
  await app.register(fastifyStatic, {
    root: webDir,
    prefix: '/',
    index: false,
    wildcard: false,
    setHeaders: (res, file) => {
      res.header('Content-Security-Policy', CSP);
      if (file.includes(`${path.sep}assets${path.sep}`)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && SPA_ROUTES.test(url)) {
      return reply.header('Content-Security-Policy', CSP).header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(html);
    }
    return reply.code(404).type('application/json; charset=utf-8').send({ ok: false, error: { code: 'not_found', message: `There is nothing at ${req.method} ${url.replace(/\/a\/[^/]+/, '/a/[link]')}.` } });
  });
}
