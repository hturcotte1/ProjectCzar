import type { AppContext } from './context.js';
import type { Scheduler } from './scheduler/index.js';
import type { AppApiHooks } from './web/app-api.js';
import { AnthropicConductorModel } from './conductor/anthropic.js';
import { ScriptedConductorModel } from './conductor/scripted.js';
import { conductorJob, runConductor, sweepJob } from './conductor/runner.js';
import { briefJob } from './services/brief.js';
import { latestRehearsalFor, rehearsalRunning, runRehearsal } from './rehearsal/driver.js';
import { TempoError } from './lib/errors.js';
import { warmUpLimits } from './services/limits.js';

/**
 * Wires the long-running parts (Conductor, daily brief, rehearsal) into the scheduler and the app
 * API. Shared by the server, the rehearsal command and the demo.
 * `internalUrl` returns the address this process listens on (known only after listen).
 */
export function wireRuntime(ctx: AppContext, scheduler: Scheduler, internalUrl: () => string): AppApiHooks {
  // Get the limits check ready now (about half a second), not during the first agent's check-in.
  warmUpLimits();
  if (ctx.config.anthropicApiKey && !ctx.integrations.conductorModel) {
    ctx.integrations.conductorModel = new AnthropicConductorModel(ctx.config.anthropicApiKey, ctx.config.conductorModel, ctx.config.conductorEffort, ctx.config.conductorRefusalFallback);
  }
  ctx.integrations.scriptedConductor ??= new ScriptedConductorModel();
  scheduler.addJob(conductorJob(scheduler));
  scheduler.addJob(sweepJob);
  scheduler.addJob(briefJob(scheduler));
  return {
    runConductorNow: (roomId: string) => {
      void scheduler.track(runConductor(ctx, roomId));
    },
    startRehearsal: (person, maxRounds) => {
      if (rehearsalRunning()) throw new TempoError(409, 'rehearsal_running', 'A rehearsal is already running. Wait for it to finish (a few minutes).');
      return new Promise<string>((resolve, reject) => {
        const p = runRehearsal(ctx, {
          baseUrl: internalUrl(),
          startedBy: person,
          maxRounds,
          onStarted: (id) => resolve(id),
          onLog: (line) => ctx.log.info({ rehearsal: true }, line),
        });
        void scheduler.track(p).catch((e) => reject(e));
      });
    },
    latestRehearsal: (person) => latestRehearsalFor(ctx, person.id),
  };
}
