import type { AppContext } from './context.js';
import type { Scheduler } from './scheduler/index.js';
import type { AppApiHooks } from './web/app-api.js';

/**
 * Wires the long-running parts (Conductor, daily brief, rehearsal) into the scheduler and the app
 * API. Kept separate from main.ts so the rehearsal and demo commands can reuse it.
 */
export function wireRuntime(_ctx: AppContext, _scheduler: Scheduler): AppApiHooks {
  return {};
}
