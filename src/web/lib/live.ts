import { useEffect, useRef, useState } from 'react';
import type { StreamEvent } from '../../shared/app-types';

/**
 * Live updates from GET /api/app/stream (server-sent events). The browser reconnects by itself.
 * If the stream keeps failing, we fall back to polling: subscribers get a { type: 'poll' } event
 * every 3 seconds and refetch what they show. We keep trying the stream every minute.
 */
export type LiveEvent = StreamEvent | { type: 'poll' } | { type: 'reconnected' };
export type LiveStatus = 'connecting' | 'live' | 'polling';

type Handler = (e: LiveEvent) => void;

const TYPES = ['feed', 'room', 'agent', 'decision', 'conductor', 'alert', 'rooms', 'hello'] as const;

class LiveConnection {
  private es: EventSource | null = null;
  private handlers = new Set<Handler>();
  private statusListeners = new Set<(s: LiveStatus) => void>();
  private failures = 0;
  private pollTimer: number | null = null;
  private retryTimer: number | null = null;
  private everOpened = false;
  status: LiveStatus = 'connecting';

  start(): void {
    if (this.es) return;
    if (typeof EventSource === 'undefined') {
      this.startPolling();
      return;
    }
    const es = new EventSource('/api/app/stream', { withCredentials: true });
    this.es = es;
    es.onopen = () => {
      const wasPolling = this.status === 'polling';
      this.failures = 0;
      this.stopPolling();
      this.setStatus('live');
      if (this.everOpened || wasPolling) this.emit({ type: 'reconnected' });
      this.everOpened = true;
    };
    es.onerror = () => {
      this.failures++;
      if (es.readyState === EventSource.CLOSED || this.failures >= 3) {
        es.close();
        this.es = null;
        this.startPolling();
        if (this.retryTimer) window.clearTimeout(this.retryTimer);
        this.retryTimer = window.setTimeout(() => this.start(), 60_000);
      } else {
        this.setStatus('connecting');
      }
    };
    for (const t of TYPES) {
      es.addEventListener(t, (msg) => {
        try {
          this.emit(JSON.parse((msg as MessageEvent).data) as StreamEvent);
        } catch {
          /* ignore malformed */
        }
      });
    }
  }

  stop(): void {
    this.es?.close();
    this.es = null;
    this.stopPolling();
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
  }

  private startPolling(): void {
    this.setStatus('polling');
    if (this.pollTimer) return;
    this.pollTimer = window.setInterval(() => this.emit({ type: 'poll' }), 3000);
  }

  private stopPolling(): void {
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private setStatus(s: LiveStatus): void {
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }

  private emit(e: LiveEvent): void {
    this.handlers.forEach((h) => {
      try {
        h(e);
      } catch (err) {
        console.error(err);
      }
    });
  }

  subscribe(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  onStatus(fn: (s: LiveStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }
}

export const live = new LiveConnection();

/** Subscribe to live events for the lifetime of a component. The handler may change freely. */
export function useLive(handler: Handler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => live.subscribe((e) => ref.current(e)), []);
}

export function useLiveStatus(): LiveStatus {
  const [s, setS] = useState<LiveStatus>(live.status);
  useEffect(() => live.onStatus(setS), []);
  return s;
}
