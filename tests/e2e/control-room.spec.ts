import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Browser checks for the control room (definition of done #10 and #14):
 *  - new events reach an open control room within about two seconds, without a refresh;
 *  - the layout is usable at 380 px wide;
 *  - the feed gets most of the screen, and what is folded away is one tap away;
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

/**
 * The seeded server runs on its own clock, started inside the demo room's working hours
 * (playwright.config.ts passes --clock). The browser works out "Next due in 34 min" and "Was due
 * 2 h ago" from its own clock, so it gets the server's time too: the screen then agrees with the
 * lights whatever the real time of day. The browser's clock moves forward in real time from there.
 */
async function useServerTime(page: Page) {
  const res = await page.request.get('/healthz');
  expect(res.ok()).toBe(true);
  const { time } = (await res.json()) as { time: string };
  await page.clock.install({ time: new Date(time) });
}

test.beforeEach(async ({ page }) => {
  await useServerTime(page);
});

/** What the message box says when nobody can tell whether Tempo got the message. */
const MAYBE_NOT_SENT =
  'Your message may not have been sent: Tempo could not be reached. It is still in the box. If it does not show up in the feed, check your connection and press Send again.';

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

/** The share of the window the feed's list of items takes (the part people read). */
async function feedShare(page: Page): Promise<number> {
  await expect(page.locator('.feed')).toBeVisible();
  return page.evaluate(() => {
    const b = document.querySelector('.feed')!.getBoundingClientRect();
    const visible = Math.max(0, Math.min(b.bottom, window.innerHeight) - Math.max(b.top, 0));
    return visible / window.innerHeight;
  });
}

for (const size of [
  { width: 1280, height: 860, least: 0.55 },
  { width: 380, height: 800, least: 0.45 },
]) {
  test(`the feed gets at least ${Math.round(size.least * 100)}% of a ${size.width}x${size.height} screen`, async ({ page }) => {
    const s = seed();
    await page.setViewportSize({ width: size.width, height: size.height });
    await signIn(page);
    await page.goto(`/rooms/${s.room_id}`);
    // The first time, the relay banner is shown in full.
    const banner = page.locator('.room-banner');
    await expect(banner).toContainText('Relay mode: the Conductor is off');
    await expect(banner.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
    const first = await feedShare(page);
    // After it has been seen, it is one line.
    await page.reload();
    await expect(banner.getByRole('button', { name: 'More', exact: true })).toBeVisible();
    const share = await feedShare(page);
    console.log(`feed share at ${size.width}x${size.height}: ${(first * 100).toFixed(1)}% on the first visit, ${(share * 100).toFixed(1)}% after`);
    expect(share).toBeGreaterThanOrEqual(size.least);
    expect(first).toBeGreaterThanOrEqual(size.least - 0.05);
    // No sideways scrolling of the page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

    // Everything folded away is still there.
    // The banner's whole text, one tap away.
    await banner.getByRole('button', { name: 'More', exact: true }).click();
    await expect(banner.getByRole('button', { name: 'Less', exact: true })).toBeVisible();
    await expect(banner).not.toHaveClass(/room-banner-short/);

    // The composer: one line until tapped; then To and Type; it folds back with Escape when empty.
    const composer = page.locator('form.composer');
    await expect(composer).toHaveClass(/composer-folded/);
    await expect(page.getByLabel('To', { exact: true })).toHaveCount(0);
    await composer.locator('textarea').click();
    await expect(page.getByLabel('To', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Type', { exact: true })).toBeVisible();
    await page.getByLabel('Type', { exact: true }).selectOption('instruction');
    await expect(page.getByLabel('Done when')).toBeVisible();
    // Something chosen: it stays open when focus leaves.
    await page.locator('.feed').click({ position: { x: 5, y: 5 } });
    await expect(composer).not.toHaveClass(/composer-folded/);
    await page.getByLabel('Type', { exact: true }).selectOption('note');
    await composer.locator('textarea').focus();
    await page.keyboard.press('Escape');
    await expect(composer).toHaveClass(/composer-folded/);

    const muse = s.agents.find((a) => a.name === 'Muse Henry')!;
    if (size.width < 600) {
      // Phones: one row per agent; a tap shows the rest, including the way to the agent's page.
      const chip = page.getByRole('button', { name: /Muse Henry/ });
      expect((await chip.boundingBox())!.height).toBeLessThanOrEqual(44);
      await chip.click();
      const detail = page.getByRole('region', { name: 'About Muse Henry' });
      await expect(detail).toContainText('Owner: Henry (you)');
      await expect(detail).toContainText(/Next due|Was due/);
      // Muse Henry has just checked in, so its next check-in is ahead (the browser agrees with the server's clock).
      await expect(detail).toContainText('Next due in');
      await expect(detail.getByRole('link', { name: "Open Muse Henry's page" })).toHaveAttribute('href', `/agents/${muse.id}`);
      await detail.getByRole('button', { name: 'Close' }).click();
      await expect(detail).toHaveCount(0);
    } else {
      // Wide screens: a short tile per agent, with whose it is, why its light is that colour, and times.
      const tile = page.locator('.strip-tile', { hasText: 'Muse Henry' }).first();
      await expect(tile).toContainText('Your Muse');
      await expect(tile).toContainText('On time.');
      // The times line comes from the browser's clock: it must agree with the light.
      await expect(tile).toContainText('Next due in');
      await expect(tile).toHaveAttribute('href', `/agents/${muse.id}`);
      await expect(page.locator('.strip-tile', { hasText: 'Muse Sam' }).first()).toContainText("Sam's Muse");
    }
  });
}

test('the cost boxes say plainly that spending has stopped when the budget is used up', async ({ page }) => {
  const s = seed();
  await page.setViewportSize({ width: 1280, height: 860 });
  await signIn(page);
  // The seeded room has spent almost nothing, so show the screen a month where the budget ran out:
  // $16.52 spent of $15, at a pace that would have made about $96 (the outside review's numbers).
  await page.route(`**/api/app/rooms/${s.room_id}`, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.conductor = {
      ...body.conductor,
      month_spent_usd: 16.52,
      month_budget_usd: 15,
      month_paid_runs: 40,
      month_avg_run_usd: 0.413,
      month_projected_usd: 96.13,
      budget_runs_out_on: null,
      budget_used_up: true,
    };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(`/rooms/${s.room_id}/conductor`);
  const usage = page.locator('section.card', { has: page.getByRole('heading', { name: 'Cost and activity' }) });
  await expect(usage).toContainText('$17 of $15 this month');
  await expect(usage).toContainText('The budget is used up, so spending has stopped until next month.');
  await expect(usage).toContainText('Daily briefs still arrive, written without the Conductor, at no cost.');
  await expect(usage.getByTestId('spend-outlook-detail')).toContainText('At this pace the month would have cost about $96.');
  await expect(usage).not.toContainText('against a budget of');
  // The side panel's small print says the same.
  const panel = page.getByTestId('spend-outlook');
  await expect(panel).toContainText('Spending has stopped until next month · At this pace the month would have cost about $96');
  await expect(panel).not.toContainText('by month end at this pace');
});

test('the message box unfolds as soon as there is text in it, even after Escape folded it', async ({ page }) => {
  const s = seed();
  await page.setViewportSize({ width: 1280, height: 860 });
  await signIn(page);
  await page.goto(`/rooms/${s.room_id}`);
  const composer = page.locator('form.composer');
  const box = composer.locator('textarea');
  await box.click();
  await expect(page.getByLabel('To', { exact: true })).toBeVisible();
  // Escape in the empty box folds it, and the cursor stays in the box.
  await page.keyboard.press('Escape');
  await expect(composer).toHaveClass(/composer-folded/);
  await expect(page.getByLabel('To', { exact: true })).toHaveCount(0);
  await expect(box).toBeFocused();
  // Typing unfolds it straight away: To and Type are there to check where it goes.
  await page.keyboard.type('H');
  await expect(composer).not.toHaveClass(/composer-folded/);
  await expect(page.getByLabel('To', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Type', { exact: true })).toBeVisible();
  await page.keyboard.type('ello, room.');
  await expect(box).toHaveValue('Hello, room.');
  await expect(box).toBeFocused();
  // Emptying the box again keeps it open while you are in it; leaving it empty folds it.
  await box.fill('');
  await expect(composer).not.toHaveClass(/composer-folded/);
  await page.keyboard.press('Escape');
  await expect(composer).toHaveClass(/composer-folded/);
});

test('a failed send shows why, even when the message box was folded, and keeps the message', async ({ page }) => {
  const s = seed();
  await page.setViewportSize({ width: 1280, height: 860 });
  await signIn(page);
  await page.goto(`/rooms/${s.room_id}`);
  const composer = page.locator('form.composer');
  const box = composer.locator('textarea');
  // Click in, then Escape: the box folds back to one line, and the cursor stays in it.
  await box.click();
  await page.keyboard.press('Escape');
  await expect(composer).toHaveClass(/composer-folded/);
  await expect(box).toBeFocused();
  // The server fails the send.
  let posts = 0;
  const messages = `**/api/app/rooms/${s.room_id}/messages`;
  await page.route(messages, (route) => {
    posts++;
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } }) });
  });
  await page.keyboard.type('Please check the pricing table.');
  await page.keyboard.press('Control+Enter');
  // The problem line is there, and must be visible (it used to be hidden while the box was folded).
  const problem = composer.locator('.cmp-error');
  await expect(problem).toBeAttached();
  await expect(problem).toHaveAttribute('role', 'alert');
  await expect(problem).toBeVisible();
  await expect(problem).toHaveText('Your message was not sent: something went wrong in Tempo. It is still in the box, so you can press Send to try again.');
  await expect(box).toHaveValue('Please check the pricing table.');
  // Nothing sends it again by itself.
  await page.waitForTimeout(2500);
  expect(posts).toBe(1);

  // Tempo cannot be reached at all. Whether it got the message cannot be known, so the words do not say "not sent".
  await page.unroute(messages);
  await page.route(messages, (route) => {
    posts++;
    return route.abort('internetdisconnected');
  });
  await composer.getByRole('button', { name: 'Send' }).click();
  await expect(problem).toHaveText(MAYBE_NOT_SENT);
  await expect(problem).toBeVisible();
  expect(posts).toBe(2);

  // Back online: Send works, and the problem line goes away.
  await page.unroute(messages);
  await composer.getByRole('button', { name: 'Send' }).click();
  await expect(problem).toHaveCount(0);
  await expect(box).toHaveValue('');
  await expect(page.locator('.feed').getByText('Please check the pricing table.').first()).toBeVisible();
});

test('a send that may have gone through says so, and the feed shows that it did', async ({ page }) => {
  const s = seed();
  await page.setViewportSize({ width: 1280, height: 860 });
  await signIn(page);
  await page.goto(`/rooms/${s.room_id}`);
  const composer = page.locator('form.composer');
  const box = composer.locator('textarea');
  const text = `Check the footer links, please (${Date.now()}).`;
  // Tempo saves the message, but the hosting service in front of it answers with an error page.
  const messages = `**/api/app/rooms/${s.room_id}/messages`;
  await page.route(messages, async (route) => {
    const saved = await route.fetch();
    expect(saved.status()).toBe(200);
    return route.fulfill({ status: 502, contentType: 'text/html', body: '<html><body><h1>502 Bad Gateway</h1></body></html>' });
  });
  await box.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Control+Enter');
  const problem = composer.locator('.cmp-error');
  await expect(problem).toHaveText(MAYBE_NOT_SENT);
  await expect(problem).toBeVisible();
  await expect(box).toHaveValue(text);
  // The feed shows it arrived, so there is no need to press Send again.
  await expect(page.locator('.feed').getByText(text)).toHaveCount(1);
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
  await useServerTime(page);
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

test('signing in with no connection says plainly that Tempo could not be reached', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('henry@example.com');
  await page.getByLabel('Password', { exact: true }).fill('tempo demo password');
  // The connection drops: the sign-in request never reaches Tempo.
  await page.route('**/api/app/login', (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: /Sign in/ }).click();
  const banner = page.getByRole('alert');
  await expect(banner).toHaveText('Could not reach Tempo. Check your connection and try again.');
  // Nothing was being saved, so the words must not say so.
  await expect(banner).not.toContainText('saved');
  // Back online, the same button signs in.
  await page.unroute('**/api/app/login');
  await page.getByRole('button', { name: /Sign in/ }).click();
  await expect(page.getByRole('heading', { name: /Launch/ })).toBeVisible();
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
