import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useLive, type LiveEvent } from '../../lib/live';

/**
 * Loads one thing from the server and keeps it fresh: on first show, on every poll or reconnect,
 * and whenever `wants` says a live event is relevant. Shared by the Conductor log, playbook,
 * briefs and health tabs. Data is only replaced when it actually changed, so open details and
 * half-typed forms are not disturbed.
 */
export function useRoomData<T>(url: string, wants: (e: LiveEvent) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const lastJson = useRef('');
  const request = useRef(0);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const mine = ++request.current;
    try {
      const next = await api.get<T>(url);
      if (mine !== request.current) return; // a newer request (or another url) took over
      const json = JSON.stringify(next);
      if (json !== lastJson.current) {
        lastJson.current = json;
        setData(next);
      }
      setError(null);
    } catch (e) {
      if (mine === request.current) setError(e);
    }
  }, [url]);

  useEffect(() => {
    lastJson.current = '';
    setData(null);
    void load();
    return () => {
      request.current++;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [load]);

  useLive((e) => {
    if (e.type === 'poll' || e.type === 'reconnected') return void load();
    if (!wants(e)) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load(), 250);
  });

  return { data, error, reload: load };
}
