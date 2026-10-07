/**
 * Where the browser tests' seeded server starts its clock: Wednesday Oct 7 2026, 10:00 am in Boise
 * (MDT, UTC-6), inside the demo room's working hours (8 am to 6 pm, Monday to Friday). From there the
 * clock moves forward in real time, so live updates and the scheduler still work. Without this, the
 * tests saw "Outside working hours." on every agent tile whenever they ran in the evening or at a
 * weekend. playwright.config.ts passes it to scripts/dev-server.ts as `--clock`.
 */
export const E2E_SERVER_START = '2026-10-07T16:00:00Z';
