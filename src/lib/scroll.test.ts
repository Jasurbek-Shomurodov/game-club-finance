import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollBehavior } from './scroll';

describe('scrollBehavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('jumps without a window (server render)', () => {
    vi.stubGlobal('window', undefined);
    expect(scrollBehavior()).toBe('auto');
  });

  it('scrolls smoothly when motion is allowed', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(scrollBehavior()).toBe('smooth');
  });

  it('jumps when the person asked for reduced motion', () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal('window', { matchMedia });
    expect(scrollBehavior()).toBe('auto');
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });
});
