/**
 * Every manual spending entry (expense, money exchange, debt, debt payment and
 * owner withdrawal) carries a note of at least MIN_NOTE_WORDS words, so the
 * owner can later tell what the money was for. Migration 108 enforces the same
 * rule on insert; its count is never stricter than this one.
 */
export const MIN_NOTE_WORDS = 5;

/** Database hint of the 108 trigger that refuses a short note. */
export const NOTE_REQUIRED_HINT = 'note_required';

/** Trims the note and collapses runs of whitespace (including new lines) to one space. */
export function normalizeEntryNote(note: string): string {
  return note.replace(/\s+/gu, ' ').trim();
}

/**
 * Words are whitespace-separated pieces that contain a letter or a digit, in
 * any script: "suv", "naushnik", "o‘yinchoq", "наушники" and "2" count, a lone
 * "-" or "..." does not.
 */
export function countNoteWords(note: string): number {
  const text = normalizeEntryNote(note);
  if (!text) return 0;
  return text.split(' ').filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export interface EntryNoteValidation {
  valid: boolean;
  words: number;
  required: number;
}

export function validateEntryNote(note: unknown): EntryNoteValidation {
  const words = typeof note === 'string' ? countNoteWords(note) : 0;
  return { valid: words >= MIN_NOTE_WORDS, words, required: MIN_NOTE_WORDS };
}

/** The 108 trigger refused the insert because its note is missing or too short. */
export function isNoteRequiredError(error: { hint?: string | null; message?: string | null } | null | undefined): boolean {
  return Boolean(error && (error.hint === NOTE_REQUIRED_HINT || /note must have at least/i.test(error.message ?? '')));
}
