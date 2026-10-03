import type { AppContext } from './context.js';
import type { Scheduler } from './scheduler/index.js';
import type { AppApiHooks } from './web/app-api.js';
import { AnthropicConductorModel } from './conductor/anthropic.js';
import { ScriptedConductorModel } from './conductor/scripted.js';
import { conductorJob, runConductor, sweepJob } from './conductor/runner.js';
import { briefJob } from './services/brief.js';

/**
 * Wires the long-running parts (Conductor, daily brief, rehearsal) into the scheduler and the app
 * API. Kept separate from main.ts so the rehearsal and demo commands can reuse it.
 */
export function wireRuntime(ctx: AppContext, scheduler: Scheduler): AppApiHooks {
  if (ctx.config.anthropicApiKey && !ctx.integrations.conductorModel) {
    ctx.integrations.conductorModel = new AnthropicConductorModel(ctx.config.anthropicApiKey, ctx.config.conductorModel, ctx.config.conductorEffort);
  }
  ctx.integrations.scriptedConductor ??= new ScriptedConductorModel();
  scheduler.addJob(conductorJob(scheduler));
  scheduler.addJob(sweepJob);
  scheduler.addJob(briefJob(scheduler));
  return {
    runConductorNow: (roomId: string) => {
      void scheduler.track(runConductor(ctx, roomId));
    },
  };
}
