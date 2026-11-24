import { describe, expect, it } from 'vitest';
import { formatCompactAmount, type CompactUnits } from './analysisFormat';

const units: Record<'en' | 'ru' | 'uz', CompactUnits> = {
  en: { thousand: (value) => `${value}K`, million: (value) => `${value}M` },
  ru: { thousand: (value) => `${value} тыс`, million: (value) => `${value} млн` },
  uz: { thousand: (value) => `${value} ming`, million: (value) => `${value} mln` },
};

describe('formatCompactAmount', () => {
  it('shows millions with up to one decimal in the language', () => {
    expect(formatCompactAmount(24_000_000, 'en', units.en)).toBe('24M');
    expect(formatCompactAmount(2_450_000, 'en', units.en)).toBe('2.5M');
    expect(formatCompactAmount(2_450_000, 'ru', units.ru)).toBe('2,5 млн');
    expect(formatCompactAmount(24_000_000, 'uz', units.uz)).toBe('24 mln');
    expect(formatCompactAmount(1_000_000, 'uz', units.uz)).toBe('1 mln');
  });

  it('shows thousands whole', () => {
    expect(formatCompactAmount(610_000, 'en', units.en)).toBe('610K');
    expect(formatCompactAmount(610_400, 'ru', units.ru)).toBe('610 тыс');
    expect(formatCompactAmount(1_500, 'uz', units.uz)).toBe('2 ming');
  });

  it('moves up to millions when the thousands round to a thousand', () => {
    expect(formatCompactAmount(999_400, 'en', units.en)).toBe('999K');
    expect(formatCompactAmount(999_600, 'en', units.en)).toBe('1M');
  });

  it('keeps amounts under a thousand as they are', () => {
    expect(formatCompactAmount(500, 'en', units.en)).toBe('500');
    expect(formatCompactAmount(0, 'en', units.en)).toBe('0');
  });

  it('marks a negative amount with a minus sign', () => {
    expect(formatCompactAmount(-2_000_000, 'en', units.en)).toBe('−2M');
    expect(formatCompactAmount(Number.NaN, 'en', units.en)).toBe('0');
  });
});
