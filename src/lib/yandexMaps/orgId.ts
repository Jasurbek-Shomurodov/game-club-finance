// The Yandex Business organisation id of a club's Yandex Maps place. The
// place link (`yandex.uz/maps/org/<slug>/<id>/`, migration 140) carries the
// same id the Yandex Business dashboard uses in `yandex.uz/sprav/<id>/…`.

import { normalizeYandexMapsUrl } from '@/lib/showcase';

/** `"226249440799"` from a `…/maps/org/<slug>/<id>/` link; null for any other link. */
export function yandexOrgId(url: string | null | undefined): string | null {
  return /\/maps\/org\/[^/]+\/(\d+)(?:\/|$)/.exec(new URL(normalizeYandexMapsUrl(url) ?? 'https://invalid.local/').pathname)?.[1] ?? null;
}
