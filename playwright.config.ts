import { defineConfig, devices } from '@playwright/test';
import { E2E_SERVER_START } from './tests/e2e/server-clock';

// Browser tests for the control room. Starts a seeded throwaway Tempo (scripts/dev-server.ts)
// on port 4300 using the built web app in dist/web (run `npm run build` first).
// The server's clock starts on a Wednesday at 10:00 am in Boise and moves forward in real time, so
// the demo room is inside working hours whenever the tests run; each test sets the browser's clock
// to the server's (tests/e2e/control-room.spec.ts), and the browser uses the room's time zone.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4300',
    trace: 'retain-on-failure',
    timezoneId: 'America/Boise',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } } }],
  webServer: {
    command: `npx tsx scripts/dev-server.ts --port 4300 --web dist/web --keys-out .tmp/e2e-seed.json --clock ${E2E_SERVER_START}`,
    url: 'http://localhost:4300/healthz',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
