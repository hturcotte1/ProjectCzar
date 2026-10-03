import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { buildOpenApi, docSettings, type DocSettings } from '../docs/openapi.js';

/**
 * Writes the OpenAPI document to a file, for the linter: `node dist/server/cli/write-openapi.js <file>`.
 * Uses the same base URL setting (BASE_URL) as the server and never opens the database.
 */
export function writeOpenApi(outPath: string, baseUrl: string, settings?: DocSettings): string {
  const target = path.resolve(outPath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(buildOpenApi(baseUrl, settings), null, 2) + '\n');
  return target;
}

function main(): void {
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: node dist/server/cli/write-openapi.js <output.json>');
    process.exit(2);
  }
  const config = loadConfig();
  const target = writeOpenApi(out, config.baseUrl, docSettings(config));
  console.log(`Wrote the OpenAPI document for ${config.baseUrl} to ${target}`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) main();
