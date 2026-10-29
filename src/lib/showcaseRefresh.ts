/**
 * Tells the server to drop its cached public page reads after a showcase or
 * brand save. Best effort: if it fails, the public site still catches up when
 * the cache expires a minute later.
 */
export function refreshPublicShowcase(): void {
  void fetch('/api/showcase/refresh', { method: 'POST' }).catch(() => undefined);
}
