import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Browser checks for the control room (definition of done #10 and #14):
 *  - new events reach an open control room within about two seconds, without a refresh;
 *  - the layout is usable at 380 px wide;
 *  - agent-written script shows as harmless text;
 *  - light and dark themes both render.
 * The server is the seeded throwaway Tempo started by playwright.config.ts.
 */

interface Seed {
  room_id: string;
  agents: { name: string; id: string; api_key: string; page_link: string }[];
}

function seed(): Seed {
  return JSON.parse(fs.readFileSync('.tmp/e2e-seed.json', 'utf8')) as Seed;
}

async function signIn(page: Page, email = 'henry@example.com') {
  const res = await page.request.post('/api/app/login', {
    headers: { 'content-type': 'application/json', 'x-requested-with': 'tempo' },
    data: { email, password: 'tempo demo password' },
  });
  expect(res.ok()).toBe(true);
}

async function agentReport(baseURL: string, key: string, workingOn: string) {
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const card = await (await fetch(`${baseURL}/api/v1/agent/check-in`, { method: 'POST', headers, body: '{}' })).json();
  const body = {
    card_id: card.card_id,
    rooms: card.rooms.filter((r: any) => !r.paused).map((r: any) => ({ room_id: r.room_id, working_on: workingOn })),
    answers: card.rooms.flatMap((r: any) => r.questions_for_you.map((q: any) => ({ question_id: q.id, answer: 'Answered in the browser test.' }))),
    instruction_updates: card.rooms.flatMap((r: any) => r.instructions_for_you.map((i: any) => ({ instruction_id: i.id, status: 'in_progress', note: 'On it.' }))),
  };
  const res = await fetch(`${baseURL}/api/v1/agent/report`, { method: 'POST', headers, body: JSON.stringify(body) });
  expect(res.status).toBe(200);
}

test('a new report reaches an open room within about two seconds, without a refresh', async ({ page, baseURL }) => {
  const s = seed();
  await signIn(page);
  await page.goto(`/rooms/${s.room_id}`);
  await expect(page.getByText('Put proof links on every finished item').first()).toBeVisible();
  // Let the live connection settle.
  await page.waitForTimeout(800);
  const unique = `Live check ${Date.now()}: rewriting the FAQ intro.`;
  const muse = s.agents.find((a) => a.name === 'Muse Henry')!;
  const started = Date.now();
  await agentReport(baseURL!, muse.api_key, unique);
  await expect(page.getByText(unique).first()).toBeVisible({ timeout: 2500 });
  const elapsed = Date.now() - started;
  console.log(`report appeared after ${elapsed} ms`);
  expect(elapsed).toBeLessThan(2500);
});

test('is usable at 380 px wide', async ({ page }) => {
  const s = seed();
  await page.setViewportSize({ width: 380, height: 800 });
  await signIn(page);
  await page.goto(`/rooms/${s.room_id}`);
  await expect(page.getByRole('heading', { name: /Launch/ })).toBeVisible();
  // No sideways scrolling of the page.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // The composer is reachable and its message box is wide enough to use.
  const box = page.locator('.composer textarea');
  await expect(box).toBeVisible();
  expect((await box.boundingBox())!.width).toBeGreaterThan(250);
  // The room list opens from the menu button, and closes on a tap on the dimmed area beside it.
  // The tap must land where the menu does not cover the dimmed area: the menu sits on top of the
  // left part, so a tap in the middle of the screen would hit the menu, not the dimmed area.
  const menuButton = page.getByRole('button', { name: 'Open the room list' });
  await menuButton.click();
  await expect(page.locator('.sidebar.open')).toBeVisible();
  const menuRight = await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width);
  expect(menuRight).toBeLessThan(370);
  await page.locator('.scrim').click({ position: { x: Math.round((menuRight + 380) / 2), y: 400 } });
  await expect(page.locator('.sidebar.open')).toHaveCount(0);
  await expect(page.locator('.scrim')).toHaveCount(0);
  // Escape closes it too, and puts the keyboard focus back on the menu button.
  await menuButton.click();
  await expect(page.locator('.sidebar.open')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar.open')).toHaveCount(0);
  await expect(page.locator('.scrim')).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  // Tabs work: "Working now" shows one lane per agent.
  await page.getByRole('tab', { name: 'Working now' }).click();
  for (const a of s.agents) await expect(page.getByText(a.name).first()).toBeVisible();
  // "Waiting on you" is a tab on phones.
  await page.getByRole('tab', { name: /Waiting on you/ }).click();
  await expect(page.getByText(/disagree on the headline tone/).first()).toBeVisible();
  // Touch targets are big enough.
  const send = page.getByRole('button', { name: /^Pause all$/ });
  expect((await send.boundingBox())!.height).toBeGreaterThanOrEqual(28);
});

test('agent-written script is shown as harmless text', async ({ page }) => {
  const s = seed();
  let dialogs = 0;
  page.on('dialog', async (d) => {
    dialogs++;
    await d.dismiss();
  });
  await signIn(page);
  await page.goto(`/rooms/${s.room_id}`);
  await expect(page.getByText('<script>alert("not html")</script>', { exact: false }).first()).toBeVisible();
  const injected = await page.evaluate(() => [...document.querySelectorAll('script')].filter((el) => (el.textContent ?? '').includes('not html')).length);
  expect(injected).toBe(0);
  expect(dialogs).toBe(0);
});

test('renders in dark mode with dark colors', async ({ browser }) => {
  const s = seed();
  const ctx = await browser.newContext({ colorScheme: 'dark' });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto(`/rooms/${s.room_id}`);
  await expect(page.getByRole('heading', { name: /Launch/ })).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g)!.map(Number);
  expect(r + g + b).toBeLessThan(150);
  await ctx.close();
});

test('falls back to polling when live updates are blocked, and still shows new events', async ({ page, baseURL }) => {
  const s = seed();
  await page.route('**/api/app/stream', (route) => route.abort());
  await signIn(page);
  await page.goto(`/rooms/${s.room_id}`);
  await expect(page.getByText('Put proof links on every finished item').first()).toBeVisible();
  // After a few failed attempts the app switches to polling (amber dot with an explanation).
  await expect(page.locator('.connection-dot[title*="refreshing every few seconds"]')).toBeAttached({ timeout: 20_000 });
  const unique = `Polling check ${Date.now()}: drafting the footer.`;
  await agentReport(baseURL!, s.agents.find((a) => a.name === 'Muse Sam')!.api_key, unique);
  await expect(page.getByText(unique).first()).toBeVisible({ timeout: 6000 });
});

test('signs in through the form, and refuses a wrong password with a plain message', async ({ page }) => {
  const s = seed();
  await page.goto('/');
  await page.getByLabel('Email').fill('sam@example.com');
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: /Sign in/ }).click();
  await expect(page.getByText(/don't match an account/)).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('tempo demo password');
  await page.getByRole('button', { name: /Sign in/ }).click();
  await expect(page).toHaveURL(new RegExp(`/rooms/${s.room_id}`));
  await expect(page.getByRole('heading', { name: /Launch/ })).toBeVisible();
  // Signing out ends the session: the sign-in form comes back, and the API refuses the old cookie.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: /Sign in/ })).toBeVisible();
  expect((await page.request.get('/api/app/me')).status()).toBe(401);
});

test('the Run rehearsal button starts a rehearsal in a labeled sandbox room', async ({ page }) => {
  await signIn(page);
  await page.goto('/rehearsal');
  await page.getByRole('button', { name: 'Run rehearsal' }).click();
  await expect(page.getByText('running', { exact: true })).toBeVisible({ timeout: 10_000 });
  // The sandbox room shows up in the room list, clearly labeled.
  await expect(page.locator('.sidebar .nav-item', { hasText: 'Sandbox rehearsal' }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.sidebar .nav-item', { hasText: 'Sandbox rehearsal' }).first().getByText('sandbox', { exact: true })).toBeVisible();
  // The step-by-step log fills in as it runs.
  await expect(page.getByText(/Step-by-step log/)).toBeVisible({ timeout: 20_000 });
});
