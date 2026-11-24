/**
 * Asks the server to send the club's pending activity notices (migration 183)
 * after a page saved something investors hear about. The page says nothing
 * about the change: the database captured it, and the notice reports what
 * the database holds.
 *
 * Fire and forget, and never in the way of the save: calls for one club
 * within a moment of each other (several page-access toggles, a form that
 * writes twice) become one request, so their rows reach the sender together
 * and are told as one message. A call that never arrives (the tab closed)
 * is sent by the nightly report instead.
 */

const COALESCE_MS = 1_000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function send(clubId: string) {
  timers.delete(clubId);
  try {
    void fetch('/api/activity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clubId }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Telegram is best effort; the nightly report sends what is left.
  }
}

export function announceActivity(clubId: string | null | undefined): void {
  if (!clubId || typeof fetch !== 'function') return;
  const waiting = timers.get(clubId);
  if (waiting) clearTimeout(waiting);
  timers.set(clubId, setTimeout(() => send(clubId), COALESCE_MS));
}
