import { describe, expect, it } from 'vitest';
import { isShowcaseLogoUrl } from './logoIcon';

describe('isShowcaseLogoUrl', () => {
  it('only redraws logos from the public showcase bucket', () => {
    const supabase = 'https://abc.supabase.co';
    expect(isShowcaseLogoUrl('https://abc.supabase.co/storage/v1/object/public/showcase/club/logo.jpg', supabase)).toBe(true);
    expect(isShowcaseLogoUrl('https://abc.supabase.co/storage/v1/object/public/other/logo.jpg', supabase)).toBe(false);
    expect(isShowcaseLogoUrl('https://evil.example/storage/v1/object/public/showcase/logo.jpg', supabase)).toBe(false);
    expect(isShowcaseLogoUrl('http://abc.supabase.co/storage/v1/object/public/showcase/logo.jpg', supabase)).toBe(false);
    expect(isShowcaseLogoUrl('not a url', supabase)).toBe(false);
    expect(isShowcaseLogoUrl('https://abc.supabase.co/storage/v1/object/public/showcase/logo.jpg', undefined)).toBe(false);
  });
});
