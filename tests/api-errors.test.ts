import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/web/lib/api.js';

/**
 * What the control room says when it cannot reach Tempo at all (src/web/lib/api.ts). Review round 3:
 * every change said "Could not reach Tempo, so this was not saved", including signing in, Run now and
 * signing out, where nothing is being saved; and after a dropped connection Tempo may in fact have
 * made the change. The shared words now only say what is known. Screens that need more (the message
 * box) add their own words.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function offline() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
  );
}

async function failure(call: () => Promise<unknown>): Promise<ApiError> {
  try {
    await call();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected the request to fail');
}

describe('when Tempo cannot be reached', () => {
  it('signing in says so plainly, without talking about saving', async () => {
    offline();
    const e = await failure(() => api.post('/login', { email: 'henry@example.com', password: 'x' }));
    expect(e.status).toBe(0);
    expect(e.message).toBe('Could not reach Tempo. Check your connection and try again.');
    expect(e.message).not.toMatch(/sav/i);
  });

  it('every other change gets the same words', async () => {
    offline();
    const calls = [
      () => api.post('/rooms/room_1/conductor/run'),
      () => api.post('/logout'),
      () => api.patch('/rooms/room_1', { goal: 'x' }),
      () => api.del('/agents/agent_1'),
    ];
    for (const call of calls) {
      expect((await failure(call)).message).toBe('Could not reach Tempo. Check your connection and try again.');
    }
  });

  it('reading a screen says to check the connection', async () => {
    offline();
    expect((await failure(() => api.get('/me'))).message).toBe('Could not reach Tempo. Check your connection.');
  });
});
