import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Trash2 } from 'lucide-react';
import { ActionMenu, ActionMenuList, menuKeyAction, menuPosition } from './ActionMenu';
import { Badge } from './Badge';
import { ButtonLink } from './Button';
import { Card } from './Card';
import { DataTable, type DataTableProps } from './DataTable';
import { DetailHero, DetailList } from './DetailList';
import { EmptyState } from './EmptyState';
import { NativeSelectOverlay } from './Field';
import { IconButton } from './IconButton';
import { NavTab } from './NavTab';
import { InlineAlert } from './InlineAlert';
import { SegmentedControl } from './SegmentedControl';
import { TappableSurface } from './Tappable';

describe('ActionMenu', () => {
  it('is a closed menu button until it is opened', () => {
    const html = renderToStaticMarkup(<ActionMenu label="More actions" items={[{ label: 'Edit', onSelect: () => undefined }]} />);
    expect(html).toMatch(/^<button [^>]*aria-label="More actions"/);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="menu"');
  });

  it('lists its items as menu items at least 40px tall', () => {
    const html = renderToStaticMarkup(
      <ActionMenuList
        label="More actions"
        onSelect={() => undefined}
        items={[
          { label: 'Edit', onSelect: () => undefined },
          { label: 'Archive', onSelect: () => undefined, disabled: true },
          { label: 'Delete', onSelect: () => undefined, tone: 'danger', icon: <Trash2 size={16} /> },
        ]}
      />,
    );
    expect(html).toMatch(/^<div role="menu" aria-label="More actions"/);
    expect(html.match(/role="menuitem"/g)).toHaveLength(3);
    expect(html.match(/min-h-10/g)).toHaveLength(3);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Archive/);
    expect(html).toMatch(/text-danger-600[^>]*>.*Delete/);
  });

  it('moves with the arrow keys, wrapping and skipping disabled items', () => {
    const enabled = [0, 2, 3];
    expect(menuKeyAction('ArrowDown', 0, enabled)).toEqual({ type: 'focus', index: 2 });
    expect(menuKeyAction('ArrowDown', 3, enabled)).toEqual({ type: 'focus', index: 0 });
    expect(menuKeyAction('ArrowUp', 0, enabled)).toEqual({ type: 'focus', index: 3 });
    expect(menuKeyAction('ArrowUp', 3, enabled)).toEqual({ type: 'focus', index: 2 });
    // Nothing focused yet: down starts at the top, up at the bottom.
    expect(menuKeyAction('ArrowDown', -1, enabled)).toEqual({ type: 'focus', index: 0 });
    expect(menuKeyAction('ArrowUp', -1, enabled)).toEqual({ type: 'focus', index: 3 });
    expect(menuKeyAction('Home', 3, enabled)).toEqual({ type: 'focus', index: 0 });
    expect(menuKeyAction('End', 0, enabled)).toEqual({ type: 'focus', index: 3 });
  });

  it('closes on Escape and Tab and leaves other keys alone', () => {
    expect(menuKeyAction('Escape', 0, [0])).toEqual({ type: 'close' });
    expect(menuKeyAction('Tab', 0, [0])).toEqual({ type: 'close' });
    expect(menuKeyAction('Escape', -1, [])).toEqual({ type: 'close' });
    expect(menuKeyAction('ArrowDown', -1, [])).toBeNull();
    expect(menuKeyAction('a', 0, [0])).toBeNull();
  });

  it('opens under the button and stays inside a 320px viewport', () => {
    const viewport = { width: 320, height: 568 };
    const menu = { width: 176, height: 128 };
    // A button at the right edge: the menu lines up with it.
    expect(menuPosition({ top: 100, bottom: 140, left: 272, right: 312 }, menu, viewport)).toEqual({ top: 144, left: 136, above: false });
    // A button at the left edge: the end-aligned menu is pulled back in.
    expect(menuPosition({ top: 100, bottom: 140, left: 4, right: 44 }, menu, viewport).left).toBe(8);
    // A start-aligned menu wider than the room to its right is pulled back too.
    expect(menuPosition({ top: 100, bottom: 140, left: 272, right: 312 }, menu, viewport, 'start').left).toBe(136);
    // No room below: it opens above.
    expect(menuPosition({ top: 500, bottom: 540, left: 272, right: 312 }, menu, viewport)).toEqual({ top: 368, left: 136, above: true });
  });
});

describe('DataTable', () => {
  const columns = [
    { key: 'name', header: 'Name', sticky: true },
    { key: 'total', header: 'Total', align: 'right' as const },
  ];
  const data = [{ name: 'Cola', total: '10' }];
  const table = (props: Partial<Parameters<typeof DataTable<(typeof data)[number]>>[0]> = {}) =>
    renderToStaticMarkup(<DataTable columns={columns} data={data} keyExtractor={(row) => row.name} {...props} />);

  it('is not busy, and layers nothing, by default', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={[{ key: 'name', header: 'Name' }]} data={data} keyExtractor={(row) => row.name} stickyHeader />,
    );
    expect(html).not.toContain('aria-busy');
    expect(html).not.toContain('opacity-60');
    expect(html).not.toContain('left-0');
    expect(html).not.toContain('isolate');
    expect(html).toContain('sticky top-0 border-b border-gray-200 bg-surface z-20');
  });

  it('dims and reports a refetch', () => {
    const html = table({ busy: true });
    expect(html).toMatch(/^<div aria-busy="true" class="[^"]*transition-opacity motion-reduce:transition-none opacity-60/);
  });

  it('pins the first column behind a divider, under the header', () => {
    const html = table({ stickyHeader: true, footer: { name: 'All' } });
    expect(html).toMatch(/^<div class="[^"]*isolate/);
    const [corner, header] = html.match(/<th scope="col" class="[^"]*"/g) ?? [];
    expect(corner).toContain('sticky');
    expect(corner).toContain('left-0');
    expect(corner).toContain('top-0');
    expect(corner).toContain('z-40');
    expect(header).toContain('z-30');
    expect(header).not.toContain('left-0');
    const [first, second, footerFirst] = html.match(/<td class="[^"]*"/g) ?? [];
    expect(first).toContain('sticky left-0');
    expect(first).toContain('z-10');
    expect(first).toContain('rgb(var(--c-gray-200))');
    expect(first).toContain('bg-surface');
    expect(second).not.toContain('sticky');
    expect(footerFirst).toContain('sticky left-0');
    expect(footerFirst).toContain('bg-gray-50');
  });

  it('pins the column from sm up only when phones show cards', () => {
    const html = table({ mobileCards: true });
    const [first] = html.match(/<td class="[^"]*"/g) ?? [];
    expect(first).toContain('sm:sticky sm:left-0');
    expect(first).not.toMatch(/(^|[" ])sticky /);
  });
});

describe('DetailList', () => {
  it('renders label and value rows and skips the missing ones', () => {
    const html = renderToStaticMarkup(
      <DetailList items={[{ label: 'Date', value: '21 Nov 2026' }, null, false, { label: 'Note', value: 'Broken bottle' }]} />,
    );
    expect(html).toMatch(/^<dl class="[^"]*divide-y divide-gray-100/);
    expect(html.match(/<dt/g)).toHaveLength(2);
    expect(html).toMatch(/<dt class="[^"]*text-gray-500">Date<\/dt><dd class="[^"]*text-right[^"]*">21 Nov 2026<\/dd>/);
    expect(html).not.toContain('max-sm:flex-col');
  });

  it('stacks the value under its label on phones when asked', () => {
    const html = renderToStaticMarkup(<DetailList stack items={[{ label: 'Note', value: 'Long text' }]} />);
    expect(html).toContain('max-sm:flex-col');
    expect(html).toContain('max-sm:text-left');
  });

  it('renders nothing without rows', () => {
    expect(renderToStaticMarkup(<DetailList items={[null]} />)).toBe('');
  });
});

describe('DetailHero', () => {
  it('shows the name over the amount in its tone', () => {
    const html = renderToStaticMarkup(<DetailHero title="Coca-Cola" subtitle="21 Nov 2026" amount="12 000 UZS" amountLabel="Total cost" tone="danger" />);
    expect(html).toContain('>Coca-Cola</p>');
    expect(html).toContain('>21 Nov 2026</p>');
    expect(html).toMatch(/text-2xl[^"]*text-danger-600">12 000 UZS</);
    expect(html).toContain('>Total cost</p>');
  });

  it('is just the title when nothing else is given', () => {
    expect(renderToStaticMarkup(<DetailHero title="Coca-Cola" />).match(/<p/g)).toHaveLength(1);
  });
});

describe('ButtonLink', () => {
  it('stays an app link by default', () => {
    const html = renderToStaticMarkup(<ButtonLink href="/reports">Reports</ButtonLink>);
    expect(html).toMatch(/^<a [^>]*href="\/reports"/);
    expect(html).not.toContain('target=');
    expect(html).not.toContain('download');
  });

  it('downloads through a plain link', () => {
    const html = renderToStaticMarkup(<ButtonLink href="/api/export.csv" download="report.csv">Export</ButtonLink>);
    expect(html).toContain('href="/api/export.csv"');
    expect(html).toContain('download="report.csv"');
    expect(html).toContain('rounded-xl');
  });

  it('opens a new tab with a safe rel, which the caller can replace', () => {
    const html = renderToStaticMarkup(<ButtonLink href="https://maps.google.com" target="_blank">Map</ButtonLink>);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(renderToStaticMarkup(<ButtonLink href="https://maps.google.com" target="_blank" rel="noopener">Map</ButtonLink>)).toContain('rel="noopener"');
  });
});

describe('TappableSurface additions', () => {
  it('reports what its button shows or hides', () => {
    const html = renderToStaticMarkup(<TappableSurface onClick={() => undefined} expanded={false} controls="panel" chevron={false}>More</TappableSurface>);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="panel"');
    expect(renderToStaticMarkup(<TappableSurface onClick={() => undefined} expanded chevron={false}>More</TappableSurface>)).toContain('aria-expanded="true"');
  });

  it('leaves the attributes off unless asked, and stays full width', () => {
    const html = renderToStaticMarkup(<TappableSurface onClick={() => undefined} chevron={false}>More</TappableSurface>);
    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('aria-controls');
    expect(html).toContain('w-full');
  });

  it('can be as wide as its content', () => {
    const html = renderToStaticMarkup(<TappableSurface href="/reserve" fit chevron={false}>Reserve</TappableSurface>);
    expect(html).toContain('w-fit');
    expect(html).not.toContain('w-full');
  });
});

describe('variants', () => {
  it('adds the danger card tone', () => {
    expect(renderToStaticMarkup(<Card tone="danger">x</Card>)).toContain('border-danger-100 bg-danger-50/50');
  });

  it('adds filled icon buttons and the 44px size', () => {
    const html = renderToStaticMarkup(<IconButton label="Add" icon={<span />} variant="primary" size="lg" />);
    expect(html).toContain('bg-primary-600');
    expect(html).toContain('h-11 w-11');
    expect(renderToStaticMarkup(<IconButton label="Done" icon={<span />} variant="success" />)).toContain('bg-success-600');
  });

  it('adds the large badge, segmented control and compact alert', () => {
    expect(renderToStaticMarkup(<Badge size="lg">Paid</Badge>)).toContain('px-3 py-2 text-sm');
    expect(renderToStaticMarkup(<Badge>Paid</Badge>)).toContain('px-2.5 py-1 text-xs');
    const options = [{ value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }];
    expect(renderToStaticMarkup(<SegmentedControl label="Pay" options={options} value="cash" onChange={() => undefined} size="lg" />).match(/min-h-14/g)).toHaveLength(2);
    expect(renderToStaticMarkup(<InlineAlert size="sm">Saved</InlineAlert>)).toContain('px-3 py-2');
    expect(renderToStaticMarkup(<InlineAlert>Saved</InlineAlert>)).toContain('px-4 py-3');
  });

  it('lets an empty state pick its heading level and warn', () => {
    const html = renderToStaticMarkup(<EmptyState icon={Trash2} title="Nothing counted" as="h2" tone="warning" />);
    expect(html).toContain('<h2 ');
    expect(html).toContain('bg-warning-50');
    expect(renderToStaticMarkup(<EmptyState icon={Trash2} title="Nothing" />)).toMatch(/bg-gray-100 text-gray-500.*<h3 /);
  });
});

describe('DataTable expanded rows', () => {
  const columns = [{ key: 'name', header: 'Name' }, { key: 'total', header: 'Total' }];
  const data = [{ name: 'Cola', total: '10' }, { name: 'Water', total: '4' }];
  const table = (props: Partial<DataTableProps<(typeof data)[number]>> = {}) =>
    renderToStaticMarkup(<DataTable columns={columns} data={data} keyExtractor={(row) => row.name} {...props} />);

  it('renders nothing extra without both props or while no row is expanded', () => {
    const plain = table();
    expect(plain).not.toContain('data-expanded-row');
    expect(table({ renderExpanded: (row) => <p>{row.name} details</p> })).toBe(plain);
    expect(table({ renderExpanded: (row) => <p>{row.name} details</p>, isExpanded: () => false })).toBe(plain);
    expect(table({ isExpanded: () => true })).toBe(plain);
  });

  it('puts the content in a full-width row directly under the expanded row', () => {
    const html = table({ renderExpanded: (row) => <p>{row.name} details</p>, isExpanded: (row) => row.name === 'Cola' });
    expect(html.match(/data-expanded-row/g)).toHaveLength(1);
    expect(html).toMatch(/Cola.*?<\/tr><tr data-expanded-row=""[^>]*><td colSpan="2" class="p-0[^"]*"><p>Cola details<\/p><\/td><\/tr><tr[^>]*>.*Water/);
    expect(html).not.toContain('Water details');
  });

  it('keeps the panel under its card on phones', () => {
    const html = table({ mobileCards: true, renderExpanded: () => <p>Details</p>, isExpanded: (row) => row.name === 'Water' });
    expect(html).toMatch(/<tr data-expanded-row="" class="max-sm:block"><td colSpan="2" class="[^"]*max-sm:block"><p>Details<\/p>/);
  });

  it('expands rows inside sections too', () => {
    const html = table({
      groups: [{ key: 'drinks', header: 'Drinks', rows: data }],
      renderExpanded: (row) => <p>{row.name} details</p>,
      isExpanded: () => true,
    });
    expect(html.match(/data-expanded-row/g)).toHaveLength(2);
  });
});

describe('IconButton shape', () => {
  it('is a square with the variant shadow by default, and a floating circle when round', () => {
    const square = renderToStaticMarkup(<IconButton label="Add" icon={<span />} variant="primary" size="lg" />);
    expect(square).toContain('rounded-xl');
    expect(square).toContain('shadow-sm');
    const round = renderToStaticMarkup(<IconButton label="Add" icon={<span />} variant="primary" size="lg" shape="round" />);
    expect(round).toContain('rounded-full');
    expect(round).toContain('shadow-pop');
    expect(round).not.toContain('shadow-sm');
    expect(round).not.toContain('rounded-xl');
    expect(round).toContain('motion-reduce:active:scale-100');
    expect(round).toContain('h-11 w-11');
  });
});

describe('NativeSelectOverlay', () => {
  it('shows its display under an invisible, named native select', () => {
    const html = renderToStaticMarkup(
      <NativeSelectOverlay aria-label="Club" value="a" onChange={() => undefined} display={<span>Arcade</span>} className="flex-1">
        <option value="a">Arcade</option>
        <option value="b">Bunker</option>
      </NativeSelectOverlay>,
    );
    expect(html).toMatch(/^<label class="[^"]*focus-within:ring-2 focus-within:ring-primary-500[^"]*flex-1"><span>Arcade<\/span><select class="absolute inset-0 [^"]*opacity-0[^"]*" aria-label="Club">/);
    expect(html.match(/<option/g)).toHaveLength(2);
    expect(html).toContain('<option value="a" selected="">Arcade</option>');
  });
});

describe('NavTab', () => {
  it('is a link that marks the current screen', () => {
    const active = renderToStaticMarkup(<NavTab href="/reports" icon={Trash2} label="Reports" active />);
    expect(active).toMatch(/^<a [^>]*aria-current="page"[^>]*href="\/reports"|^<a [^>]*href="\/reports"[^>]*aria-current="page"/);
    expect(active).toContain('text-primary-700');
    expect(active).toContain('text-xs');
    expect(active).toContain('min-h-14');
    const idle = renderToStaticMarkup(<NavTab href="/reports" icon={Trash2} label="Reports" />);
    expect(idle).not.toContain('aria-current');
    expect(idle).toContain('text-gray-500');
  });

  it('is a button with a count when it opens something', () => {
    const html = renderToStaticMarkup(<NavTab icon={Trash2} label="More" badge={3} aria-expanded={false} aria-controls="mobile-nav" />);
    expect(html).toMatch(/^<button [^>]*type="button"/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="mobile-nav"');
    expect(html).toMatch(/bg-warning-50[^>]*>3<\/span>/);
    expect(renderToStaticMarkup(<NavTab icon={Trash2} label="More" />)).not.toContain('bg-warning-50');
  });
});
