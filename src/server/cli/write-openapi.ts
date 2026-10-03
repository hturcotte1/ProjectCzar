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
    console.error('Usage: node dist/server/cli/write-openapi.js <output.json> [--base-url https://your-address]');
    process.exit(2);
  }
  // --base-url overrides BASE_URL (the lint script passes a public placeholder, since the linter
  // rightly warns about a localhost server address).
  const flag = process.argv.indexOf('--base-url');
  const config = loadConfig(flag > 0 ? { ...process.env, BASE_URL: process.argv[flag + 1] } : process.env);
  const target = writeOpenApi(out, config.baseUrl, docSettings(config));
  console.log(`Wrote the OpenAPI document for ${config.baseUrl} to ${target}`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) main();
