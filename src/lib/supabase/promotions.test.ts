import { describe, expect, it } from 'vitest';
import { isMissingPromotionsTable } from './promotions';

describe('isMissingPromotionsTable', () => {
  it('treats a missing promotions table as no promotions', () => {
    expect(isMissingPromotionsTable({ code: 'PGRST205', message: "Could not find the table 'public.promotions' in the schema cache" })).toBe(true);
    expect(isMissingPromotionsTable({ code: '42P01', message: 'relation "public.promotions" does not exist' })).toBe(true);
  });

  it('keeps other failures that mention promotions as errors', () => {
    expect(isMissingPromotionsTable({ code: '42501', message: 'permission denied for table promotions' })).toBe(false);
    expect(isMissingPromotionsTable({ message: 'TypeError: Failed to fetch promotions' })).toBe(false);
    expect(isMissingPromotionsTable(null)).toBe(false);
  });
});
