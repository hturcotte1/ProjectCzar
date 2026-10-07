import { ApiError } from '../../lib/api';

/**
 * What the message box says when a send fails. Nothing sends the message again by itself: it stays
 * in the box (and in the unsent draft), and the person presses Send when ready. So the words say
 * what happened and what to do, and never promise a retry.
 *
 * "Was not sent" is said only when it is known: Tempo itself answered with one of its error replies
 * (it refused the message, or the save was undone). With no answer, or an error page from the
 * hosting service in front of Tempo, Tempo may already have saved the message; sending it again
 * would give the agents the same instruction twice. Then the words say it may not have been sent,
 * and to look in the feed first.
 */
export function notSentText(e: unknown): string {
  if (e instanceof ApiError && e.fromTempo) {
    if (e.status >= 500) {
      return 'Your message was not sent: something went wrong in Tempo. It is still in the box, so you can press Send to try again.';
    }
    // Tempo's own plain-language reason (for example a missing agent), which says what to change.
    let why = e.message.trim() || 'Something went wrong.';
    if (!/[.!?]$/.test(why)) why += '.';
    return `Your message was not sent. ${why} It is still in the box.`;
  }
  if (e instanceof ApiError) {
    return 'Your message may not have been sent: Tempo could not be reached. It is still in the box. If it does not show up in the feed, check your connection and press Send again.';
  }
  return 'Your message may not have been sent: something went wrong. It is still in the box. If it does not show up in the feed, press Send again.';
}
