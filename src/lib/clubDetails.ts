export const CLUB_NAME_MAX_LENGTH = 80;
export const CLUB_ADDRESS_MAX_LENGTH = 160;

export interface ClubDetailsForm {
  name: string;
  address: string;
}

export type ClubDetailsError = 'name_required' | 'name_too_long' | 'address_too_long';

export function validateClubDetails(form: ClubDetailsForm): ClubDetailsError | null {
  const name = form.name.trim();
  if (!name) return 'name_required';
  if (name.length > CLUB_NAME_MAX_LENGTH) return 'name_too_long';
  if (form.address.trim().length > CLUB_ADDRESS_MAX_LENGTH) return 'address_too_long';
  return null;
}

/** Validated form → the `clubs` columns an owner may change; a blank address clears it. */
export function buildClubDetailsUpdate(form: ClubDetailsForm) {
  return { name: form.name.trim(), address: form.address.trim() || null };
}

/** True when saving would change nothing, so the Save button can stay disabled. */
export function clubDetailsUnchanged(form: ClubDetailsForm, club: { name: string; address: string | null } | null): boolean {
  if (!club) return true;
  const next = buildClubDetailsUpdate(form);
  return next.name === club.name && next.address === (club.address?.trim() || null);
}
