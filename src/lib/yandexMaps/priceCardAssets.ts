// Where a price card's pictures may come from, and loading them. Only the
// club's own uploads in the public showcase storage bucket and the site's
// built-in console pictures are used, so the public card route can never be
// made to fetch an arbitrary address. Server code and the sync script only.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isShowcaseLogoUrl } from '@/lib/logoIcon';
import { isPlaystationPresetImage } from '@/lib/showcase';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

/** Whether a card may draw `url`: a showcase upload or a built-in console picture. */
export function isPriceCardImageUrl(url: string, supabaseUrl: string | undefined): boolean {
  return isPlaystationPresetImage(url) || isShowcaseLogoUrl(url, supabaseUrl);
}

/**
 * The image's bytes, or null when it is not allowed, does not load in time,
 * is not an image, or is too large: the card then draws without it.
 */
export async function loadPriceCardImage(
  url: string | null,
  options: { supabaseUrl: string | undefined; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<Buffer | null> {
  if (!url || !isPriceCardImageUrl(url, options.supabaseUrl)) return null;
  try {
    if (isPlaystationPresetImage(url)) return await readFile(join(process.cwd(), 'public', url.trim()));
    const response = await (options.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS), redirect: 'error' });
    const type = response.headers.get('content-type') ?? '';
    const length = Number(response.headers.get('content-length') ?? 0);
    if (!response.ok || !type.startsWith('image/') || length > MAX_IMAGE_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > MAX_IMAGE_BYTES ? null : bytes;
  } catch {
    return null;
  }
}
