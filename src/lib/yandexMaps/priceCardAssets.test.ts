import { describe, expect, it, vi } from 'vitest';
import { isPriceCardImageUrl, loadPriceCardImage } from './priceCardAssets';

const SUPABASE = 'https://project.supabase.co';
const STORED = `${SUPABASE}/storage/v1/object/public/showcase/club/dota.jpg`;

const respond = (body: string, headers: Record<string, string> = { 'content-type': 'image/jpeg' }, status = 200) =>
  vi.fn(async () => new Response(body, { status, headers }));

describe('isPriceCardImageUrl', () => {
  it('allows only showcase uploads and the built-in console pictures', () => {
    expect(isPriceCardImageUrl(STORED, SUPABASE)).toBe(true);
    expect(isPriceCardImageUrl('/playstation/ps5.svg', SUPABASE)).toBe(true);
    expect(isPriceCardImageUrl('/playstation/../../.env.local', SUPABASE)).toBe(false);
    expect(isPriceCardImageUrl('https://evil.example.com/storage/v1/object/public/showcase/x.jpg', SUPABASE)).toBe(false);
    expect(isPriceCardImageUrl(`${SUPABASE}/storage/v1/object/public/other/x.jpg`, SUPABASE)).toBe(false);
    expect(isPriceCardImageUrl(STORED, undefined)).toBe(false);
  });
});

describe('loadPriceCardImage', () => {
  it('fetches an allowed image', async () => {
    const fetchImpl = respond('jpeg bytes');
    await expect(loadPriceCardImage(STORED, { supabaseUrl: SUPABASE, fetchImpl })).resolves.toEqual(Buffer.from('jpeg bytes'));
    expect(fetchImpl).toHaveBeenCalledWith(STORED, expect.objectContaining({ redirect: 'error' }));
  });

  it('never fetches a disallowed address', async () => {
    const fetchImpl = respond('x');
    await expect(loadPriceCardImage('https://evil.example.com/a.jpg', { supabaseUrl: SUPABASE, fetchImpl })).resolves.toBeNull();
    await expect(loadPriceCardImage(null, { supabaseUrl: SUPABASE, fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('gives up on errors, non-images, oversized files and failures', async () => {
    await expect(loadPriceCardImage(STORED, { supabaseUrl: SUPABASE, fetchImpl: respond('x', { 'content-type': 'text/html' }) })).resolves.toBeNull();
    await expect(loadPriceCardImage(STORED, { supabaseUrl: SUPABASE, fetchImpl: respond('x', { 'content-type': 'image/png' }, 404) })).resolves.toBeNull();
    await expect(loadPriceCardImage(STORED, { supabaseUrl: SUPABASE, fetchImpl: respond('x', { 'content-type': 'image/png', 'content-length': String(20 * 1024 * 1024) }) })).resolves.toBeNull();
    await expect(loadPriceCardImage(STORED, { supabaseUrl: SUPABASE, fetchImpl: vi.fn(async () => { throw new Error('timeout'); }) })).resolves.toBeNull();
  });

  it('reads a built-in console picture from the site files', async () => {
    const bytes = await loadPriceCardImage('/playstation/ps5.svg', { supabaseUrl: SUPABASE });
    expect(bytes?.toString()).toContain('<svg');
  });
});
