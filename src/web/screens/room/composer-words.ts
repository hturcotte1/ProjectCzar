import { ApiError } from '../../lib/api';

/**
 * What the message box says when a send fails. Nothing sends the message again by itself: it stays
 * in the box (and in the unsent draft), and the person presses Send when ready. So the words say
 * that it was not sent, why, and what to do, and never promise a retry.
 */
export function notSentText(e: unknown): string {
  if (e instanceof ApiError && e.status === 0) {
    return 'Your message was not sent: Tempo could not be reached. It is still in the box. Check your connection, then press Send again.';
  }
  if (e instanceof ApiError && e.status >= 500) {
    return 'Your message was not sent: something went wrong in Tempo. It is still in the box, so you can press Send to try again.';
  }
  // Anything else is the server's own plain-language reason (for example a missing agent), which says what to change.
  let why = e instanceof Error && e.message.trim() ? e.message.trim() : 'Something went wrong.';
  if (!/[.!?]$/.test(why)) why += '.';
  return `Your message was not sent. ${why} It is still in the box.`;
}
