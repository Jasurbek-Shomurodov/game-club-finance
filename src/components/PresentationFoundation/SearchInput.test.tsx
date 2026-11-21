import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { SearchInput } from './SearchInput';

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={{ common: { clearSearch: 'Clear search' } }}>{node}</NextIntlClientProvider>,
  );

describe('SearchInput', () => {
  it('is a named search box with a clear button once there is text', () => {
    const empty = render(<SearchInput value="" onChange={() => undefined} placeholder="Search members" />);
    expect(empty).toContain('type="search"');
    expect(empty).toContain('aria-label="Search members"');
    expect(empty).not.toContain('<button');
    expect(empty).not.toContain('role=');
    expect(render(<SearchInput value="ali" onChange={() => undefined} placeholder="Search members" />)).toContain('aria-label="Clear search"');
  });

  it('passes the combobox attributes and the ref to its input', () => {
    const ref = createRef<HTMLInputElement>();
    const html = render(
      <SearchInput
        ref={ref}
        value="mon"
        onChange={() => undefined}
        label="Search pages"
        role="combobox"
        aria-expanded="true"
        aria-controls="results"
        aria-activedescendant="results-0"
        aria-autocomplete="list"
        onKeyDown={() => undefined}
        autoComplete="off"
        enterKeyHint="go"
      />,
    );
    const input = html.match(/<input[^>]*>/)?.[0] ?? '';
    for (const attribute of ['role="combobox"', 'aria-expanded="true"', 'aria-controls="results"', 'aria-activedescendant="results-0"', 'aria-autocomplete="list"', 'aria-label="Search pages"', 'autoComplete="off"', 'enterKeyHint="go"']) {
      expect(input).toContain(attribute);
    }
  });

  it('heads a dialog without a frame, a clear button it was told to drop, and with its hint', () => {
    const html = render(<SearchInput variant="bare" clearable={false} value="mon" onChange={() => undefined} label="Search" trailing={<kbd>Esc</kbd>} />);
    expect(html).toMatch(/<input[^>]*class="h-14 [^"]*bg-transparent/);
    expect(html).not.toContain('border-gray-200');
    expect(html).not.toContain('<button');
    expect(html).toContain('<kbd>Esc</kbd>');
  });
});
