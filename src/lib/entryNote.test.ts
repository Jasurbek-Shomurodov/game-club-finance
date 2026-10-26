import { describe, expect, it } from 'vitest';
import { countNoteWords, isNoteRequiredError, MIN_NOTE_WORDS, normalizeEntryNote, validateEntryNote } from './entryNote';

describe('entry note', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeEntryNote('  bar  uchun\n\tsuv  ')).toBe('bar uchun suv');
  });

  it('counts Latin, Cyrillic and Uzbek words', () => {
    expect(countNoteWords('')).toBe(0);
    expect(countNoteWords('   ')).toBe(0);
    expect(countNoteWords('suv')).toBe(1);
    expect(countNoteWords('Купили наушники для второго зала')).toBe(5);
    expect(countNoteWords("Bar uchun o‘yinchoq va g'isht oldik")).toBe(6);
    expect(countNoteWords('Paid internet for October 2026')).toBe(5);
  });

  it('ignores pieces without a letter or digit', () => {
    expect(countNoteWords('non - ... !!! —')).toBe(1);
    expect(countNoteWords('non,suv,choy')).toBe(1);
  });

  it('requires at least five words', () => {
    expect(MIN_NOTE_WORDS).toBe(5);
    expect(validateEntryNote('naushnik')).toEqual({ valid: false, words: 1, required: 5 });
    expect(validateEntryNote('bought two bottles of water')).toEqual({ valid: true, words: 5, required: 5 });
    expect(validateEntryNote(null)).toEqual({ valid: false, words: 0, required: 5 });
    expect(validateEntryNote(42)).toEqual({ valid: false, words: 0, required: 5 });
  });

  it('recognises the database refusal', () => {
    expect(isNoteRequiredError({ hint: 'note_required', message: 'x' })).toBe(true);
    expect(isNoteRequiredError({ message: 'The note must have at least 5 words.' })).toBe(true);
    expect(isNoteRequiredError({ hint: 'day_collected', message: 'closed' })).toBe(false);
    expect(isNoteRequiredError(null)).toBe(false);
  });
});
