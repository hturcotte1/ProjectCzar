/**
 * Signs in to a running dev server and saves screenshots of one page at phone and laptop widths.
 * Usage: npx tsx scripts/screenshot.ts --port 4100 --path /rooms/room_1 --out .tmp/shots/room [--dark] [--email sam@example.com]
 * Writes <out>-380.png and <out>-1280.png. Also prints any browser console errors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

async function main() {
  const port = arg('port', '4100');
  const pagePath = arg('path', '/')!;
  const out = arg('out', '.tmp/shots/page')!;
  const email = arg('email', 'henry@example.com')!;
  const dark = process.argv.includes('--dark');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const browser = await chromium.launch();
  for (const width of [380, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: width === 380 ? 800 : 860 }, colorScheme: dark ? 'dark' : 'light' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    const base = `http://localhost:${port}`;
    const login = await page.request.post(`${base}/api/app/login`, {
      headers: { 'content-type': 'application/json', 'x-requested-with': 'tempo' },
      data: { email, password: 'tempo demo password' },
    });
    if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
    await page.goto(`${base}${pagePath}`);
    await page.waitForTimeout(1200);
    const file = `${out}-${width}.png`;
    await page.screenshot({ path: file, fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(`${file}${overflow ? '  (WARNING: page is wider than the screen)' : ''}`);
    for (const e of errors) console.log(`  console error: ${e}`);
    await context.close();
  }
  await browser.close();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
