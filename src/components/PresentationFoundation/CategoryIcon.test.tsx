import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CategoryIcon } from './CategoryIcon';

describe('CategoryIcon', () => {
  it('draws the category icon in red, or in the bar orange when the bar paid', () => {
    expect(renderToStaticMarkup(<CategoryIcon category="repair" />)).toContain('lucide-wrench');
    expect(renderToStaticMarkup(<CategoryIcon category="cleaning" tone="bar" />)).toContain('bg-orange-50');
    expect(renderToStaticMarkup(<CategoryIcon category="repair" />)).toContain('bg-danger-50');
  });

  it('falls back to the "other" icon and shows income and moves by kind', () => {
    expect(renderToStaticMarkup(<CategoryIcon category="retired_thing" />)).toContain('lucide-circle-dashed');
    expect(renderToStaticMarkup(<CategoryIcon kind="income" />)).toContain('bg-success-50');
    expect(renderToStaticMarkup(<CategoryIcon kind="exchange" />)).toContain('lucide-arrow-right-left');
    expect(renderToStaticMarkup(<CategoryIcon kind="debtPayment" size="sm" />)).toContain('h-7 w-7');
  });
});
