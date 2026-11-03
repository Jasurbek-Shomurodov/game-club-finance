import { describe, expect, it } from 'vitest';
import { mergePresence, type PresenceEntry } from './listPresence';

const keyOf = (item: string) => item;
const rest = (...keys: string[]): PresenceEntry<string>[] => keys.map((key) => ({ key, item: key }));
const view = (entries: PresenceEntry<string>[]) => entries.map((entry) => (entry.presence ? `${entry.key}:${entry.presence}` : entry.key));

describe('mergePresence', () => {
  it('shows a first load at rest', () => {
    expect(view(mergePresence([], ['a', 'b'], keyOf))).toEqual(['a', 'b']);
  });

  it('grows in a row added in place', () => {
    expect(view(mergePresence(rest('a', 'c'), ['a', 'b', 'c'], keyOf))).toEqual(['a', 'b:enter', 'c']);
  });

  it('keeps a removed row where it was while it folds away', () => {
    expect(view(mergePresence(rest('a', 'b', 'c'), ['a', 'c'], keyOf))).toEqual(['a', 'b:exit', 'c']);
    expect(view(mergePresence(rest('a', 'b', 'c'), ['b', 'c'], keyOf))).toEqual(['a:exit', 'b', 'c']);
  });

  it('keeps folding a row that was already leaving, and keeps a new row entering', () => {
    const first = mergePresence(rest('a', 'b', 'c'), ['a', 'c', 'd'], keyOf);
    expect(view(mergePresence(first, ['a', 'c', 'd'], keyOf))).toEqual(['a', 'b:exit', 'c', 'd:enter']);
  });

  it('shows a wholesale change (another month, a filter) without animation', () => {
    expect(view(mergePresence(rest('a', 'b'), ['x', 'y'], keyOf))).toEqual(['x', 'y']);
    expect(view(mergePresence(rest('a', 'b', 'c'), ['a', 'w', 'x', 'y', 'z'], keyOf))).toEqual(['a', 'w', 'x', 'y', 'z']);
  });

  it('drops leftover exiting rows when the list is replaced', () => {
    const leaving = mergePresence(rest('a', 'b', 'c'), ['a', 'c'], keyOf);
    expect(view(mergePresence(leaving, ['x'], keyOf))).toEqual(['x']);
  });

  it('carries the latest item for a kept key', () => {
    const merged = mergePresence([{ key: 'a', item: { id: 'a', v: 1 } }], [{ id: 'a', v: 2 }], (item) => item.id);
    expect(merged).toEqual([{ key: 'a', item: { id: 'a', v: 2 }, presence: undefined }]);
  });
});
