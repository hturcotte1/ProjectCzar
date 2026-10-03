import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { buildAgentsGuide } from '../docs/agents-guide.js';
import { buildOpenApi, docSettings } from '../docs/openapi.js';

/**
 * Public docs, readable without signing in: /openapi.json (OpenAPI 3.1 for the REST door),
 * /agents.md and /llms.txt (the guide for AI agents, as Markdown and as plain text).
 *
 * All three are built once from the configured base URL, so they are identical on every request.
 */
export async function registerPublicDocs(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const settings = docSettings(ctx.config);
  const openapi = JSON.stringify(buildOpenApi(ctx.config.baseUrl, settings));
  const guide = buildAgentsGuide(ctx.config.baseUrl, settings);

  const publish = (url: string, contentType: string, body: string): void => {
    const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;
    app.get(url, async (req, reply) => {
      reply
        .header('Cache-Control', 'public, max-age=300')
        .header('ETag', etag)
        .header('Access-Control-Allow-Origin', '*')
        .type(contentType);
      if (req.headers['if-none-match'] === etag) return reply.code(304).send();
      return reply.send(body);
    });
  };

  publish('/openapi.json', 'application/json; charset=utf-8', openapi);
  publish('/agents.md', 'text/markdown; charset=utf-8', guide);
  publish('/llms.txt', 'text/plain; charset=utf-8', guide);
}
