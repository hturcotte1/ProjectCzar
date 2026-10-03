import { EventEmitter } from 'node:events';

/**
 * In-process publish/subscribe for live updates (server-sent events).
 * Events are published only after the database transaction that caused them commits.
 * Payloads carry ids, not content; listeners re-check access before sending anything.
 */
export type BusEvent =
  | { type: 'feed'; roomId: string; seq: number; updated?: boolean }
  | { type: 'room'; roomId: string; what: string }
  | { type: 'agent'; agentId: string; roomIds: string[] }
  | { type: 'decision'; roomId: string; decisionId: string }
  | { type: 'conductor'; roomId: string; runId?: string }
  | { type: 'alert'; personId: string; alertId: string }
  | { type: 'membership'; personId: string };

export class Bus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  publish(event: BusEvent): void {
    this.emitter.emit('event', event);
  }
  subscribe(fn: (e: BusEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
}
