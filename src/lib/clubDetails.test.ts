import { describe, expect, it } from 'vitest';
import { buildClubDetailsUpdate, clubDetailsUnchanged, validateClubDetails } from './clubDetails';

describe('club details', () => {
  it('requires a name and limits lengths', () => {
    expect(validateClubDetails({ name: '  ', address: '' })).toBe('name_required');
    expect(validateClubDetails({ name: 'x'.repeat(81), address: '' })).toBe('name_too_long');
    expect(validateClubDetails({ name: 'Pixel', address: 'x'.repeat(161) })).toBe('address_too_long');
    expect(validateClubDetails({ name: 'Pixel', address: '' })).toBeNull();
  });

  it('trims and clears a blank address', () => {
    expect(buildClubDetailsUpdate({ name: ' Pixel Chilonzor ', address: '  ' })).toEqual({ name: 'Pixel Chilonzor', address: null });
  });

  it('knows when nothing changed', () => {
    const club = { name: 'Pixel', address: null };
    expect(clubDetailsUnchanged({ name: ' Pixel ', address: '' }, club)).toBe(true);
    expect(clubDetailsUnchanged({ name: 'Pixel', address: 'Matbuotchilar 17' }, club)).toBe(false);
    expect(clubDetailsUnchanged({ name: 'Pixel', address: '' }, null)).toBe(true);
  });
});
