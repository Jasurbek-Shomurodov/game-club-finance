import { describe, expect, it } from 'vitest';
import { createClubQuerySequence } from './clubQuerySequence';

describe('createClubQuerySequence', () => {
  it('lets only the latest request land', () => {
    const sequence = createClubQuerySequence('clubA');
    const first = sequence.begin('clubA');
    const second = sequence.begin('clubA');
    expect(first?.()).toBe(false);
    expect(second?.()).toBe(true);
  });

  it('refuses a stale reload after a club switch so it cannot supersede the new load', () => {
    const sequence = createClubQuerySequence('clubA');
    sequence.setCurrentLoader('clubB');
    const clubBLoad = sequence.begin('clubB');
    // A save that started under club A finishes and calls its captured reload.
    expect(sequence.begin('clubA')).toBeNull();
    expect(clubBLoad?.()).toBe(true);
  });

  it('cancel supersedes the request in flight', () => {
    const sequence = createClubQuerySequence('clubA');
    const request = sequence.begin('clubA');
    sequence.cancel();
    expect(request?.()).toBe(false);
  });
});
