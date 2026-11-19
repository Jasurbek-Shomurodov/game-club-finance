import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PackageMinus } from 'lucide-react';
import { Card } from './Card';
import { IconChip } from './IconChip';
import { Skeleton } from './Skeleton';
import { TappableSurface } from './Tappable';
import { toneClasses, type Tone } from './tone';

describe('Card', () => {
  it('is a plain panel without a target', () => {
    const html = renderToStaticMarkup(<Card as="section">Body</Card>);
    expect(html).toMatch(/^<section class="[^"]*rounded-2xl/);
    expect(html).not.toContain('tappable');
  });

  it('becomes one link with the shared press feedback when given href', () => {
    const html = renderToStaticMarkup(<Card href="/reserve?view=history" label="Open reserve history">Held</Card>);
    expect(html).toMatch(/^<a [^>]*aria-label="Open reserve history"/);
    expect(html).toContain('href="/reserve?view=history"');
    expect(html).toContain('tappable');
    // The corner chevron says "this opens".
    expect(html).toContain('<svg');
  });

  it('becomes a button when given onClick, and can drop the chevron', () => {
    const html = renderToStaticMarkup(<Card onClick={() => undefined} chevron={false}>Details</Card>);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).not.toContain('<svg');
  });
});

describe('TappableSurface', () => {
  it('renders a plain box when nothing is behind it', () => {
    const html = renderToStaticMarkup(<TappableSurface className="p-2">Ratio</TappableSurface>);
    expect(html).toBe('<div class="p-2">Ratio</div>');
  });
});

describe('IconChip', () => {
  it('tints its tile by tone and is hidden from screen readers', () => {
    const html = renderToStaticMarkup(<IconChip icon={PackageMinus} tone="danger" size="sm" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('bg-danger-50');
    expect(html).toContain('h-7 w-7');
  });

  it('is neutral unless a tone is given', () => {
    expect(renderToStaticMarkup(<IconChip icon={PackageMinus} />)).toContain('bg-gray-100');
  });
});

describe('tones', () => {
  it('gives every tone the same set of roles', () => {
    const tones = Object.keys(toneClasses) as Tone[];
    expect(tones).toEqual(['neutral', 'primary', 'success', 'danger', 'warning', 'bar', 'reserve']);
    for (const tone of tones) {
      expect(Object.keys(toneClasses[tone]).sort()).toEqual(['chip', 'hover', 'solid', 'surface', 'text']);
    }
  });
});

describe('Skeleton', () => {
  it('shimmers instead of pulsing', () => {
    const html = renderToStaticMarkup(<Skeleton className="h-4 w-10" />);
    expect(html).toContain('class="skeleton ');
    expect(html).not.toContain('animate-pulse');
  });
});
