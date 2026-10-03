import { defineConfig, devices } from '@playwright/test';

// Browser tests for the control room. Starts a seeded throwaway Tempo (scripts/dev-server.ts)
// on port 4300 using the built web app in dist/web (run `npm run build` first).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4300',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } } }],
  webServer: {
    command: 'npx tsx scripts/dev-server.ts --port 4300 --web dist/web --keys-out .tmp/e2e-seed.json',
    url: 'http://localhost:4300/healthz',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
