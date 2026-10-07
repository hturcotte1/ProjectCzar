import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/web/lib/api.js';
import { notSentText } from '../src/web/screens/room/composer-words.js';

/**
 * Review round 2: a failed send said "Could not reach Tempo. Check your connection; it will retry."
 * Nothing retries a send: the message stays in the box until the person presses Send again. The
 * words now say what happened and what to do. (The browser test checks the line is visible.)
 */
describe('what the message box says when a send fails', () => {
  it('when Tempo cannot be reached', () => {
    const text = notSentText(new ApiError(0, 'network', 'Could not reach Tempo, so this was not saved. Check your connection and try again.'));
    expect(text).toBe('Your message was not sent: Tempo could not be reached. It is still in the box. Check your connection, then press Send again.');
    expect(text).not.toMatch(/retry/i);
  });

  it('when the server fails', () => {
    expect(notSentText(new ApiError(500, 'internal_error', 'Something went wrong. Please try again.'))).toBe(
      'Your message was not sent: something went wrong in Tempo. It is still in the box, so you can press Send to try again.',
    );
    expect(notSentText(new ApiError(502, 'error', 'Something went wrong (HTTP 502).'))).toContain('was not sent: something went wrong in Tempo');
  });

  it("passes on the server's own reason when there is something to change", () => {
    expect(notSentText(new ApiError(400, 'bad_request', 'Pick an agent for this instruction'))).toBe(
      'Your message was not sent. Pick an agent for this instruction. It is still in the box.',
    );
    expect(notSentText(new Error(''))).toBe('Your message was not sent. Something went wrong. It is still in the box.');
    expect(notSentText('odd')).toBe('Your message was not sent. Something went wrong. It is still in the box.');
  });
});
