import { describe, expect, it } from 'vitest';
import { buildClubDetailsUpdate, clubDetailsUnchanged, validateClubDetails } from './clubDetails';

describe('club details', () => {
  it('requires a name and limits lengths', () => {
    expect(validateClubDetails({ name: '  ', address: '', logo_url: '' })).toBe('name_required');
    expect(validateClubDetails({ name: 'x'.repeat(81), address: '', logo_url: '' })).toBe('name_too_long');
    expect(validateClubDetails({ name: 'Pixel', address: 'x'.repeat(161), logo_url: '' })).toBe('address_too_long');
    expect(validateClubDetails({ name: 'Pixel', address: '', logo_url: 'javascript:x' })).toBe('logo_invalid');
    expect(validateClubDetails({ name: 'Pixel', address: '', logo_url: 'https://cdn/logo.png' })).toBeNull();
  });

  it('trims and clears a blank address', () => {
    expect(buildClubDetailsUpdate({ name: ' Pixel Chilonzor ', address: '  ', logo_url: '' })).toEqual({ name: 'Pixel Chilonzor', address: null, logo_url: null });
  });

  it('knows when nothing changed', () => {
    const club = { name: 'Pixel', address: null };
    expect(clubDetailsUnchanged({ name: ' Pixel ', address: '', logo_url: '' }, club)).toBe(true);
    expect(clubDetailsUnchanged({ name: 'Pixel', address: '', logo_url: 'https://cdn/logo.png' }, club)).toBe(false);
    expect(clubDetailsUnchanged({ name: 'Pixel', address: 'Matbuotchilar 17', logo_url: '' }, club)).toBe(false);
    expect(clubDetailsUnchanged({ name: 'Pixel', address: '', logo_url: '' }, null)).toBe(true);
  });
});
