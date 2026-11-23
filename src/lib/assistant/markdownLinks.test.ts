import { describe, expect, it } from 'vitest';
import { canAccessPath } from '@/lib/permissions';
import { internalHref, linkTarget, splitMarkdownLinks } from './markdownLinks';

describe('internalHref', () => {
  it('accepts paths of this app', () => {
    expect(internalHref('/reports?from=2026-11-01&to=2026-11-24&category=expense%3Arent')).toBe('/reports?from=2026-11-01&to=2026-11-24&category=expense%3Arent');
    expect(internalHref('/daily-report?date=2026-11-03')).toBe('/daily-report?date=2026-11-03');
    expect(internalHref('/money-taken')).toBe('/money-taken');
  });

  it.each([
    ['protocol-relative host', '//evil.example'],
    ['backslash host', '/\\evil.example'],
    ['backslash later in the path', '/reports\\..\\x'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['leading whitespace', ' /reports'],
    ['leading tab', '\t/reports'],
    ['embedded newline', '/re\nports'],
    ['encoded slashes', '/%2F%2Fevil.example'],
    ['encoded slash after one slash', '/%2Fevil.example'],
    ['lowercase encoded slashes', '/%2f%2fevil.example'],
    ['encoded backslash', '/%5Cevil.example'],
    ['encoded tab', '/%09/evil.example'],
    ['broken encoding', '/%E0%A4%A'],
    ['bare slash', '/'],
    ['relative path', 'reports'],
    ['https', 'https://example.com'],
    ['an API route', '/api/google-business/connect?clubId=1'],
    ['a sign-in handler', '/auth/callback'],
    ['a path that only starts with an allowed one', '/reportsX'],
    ['a dot segment out of an allowed page', '/reports/../api/x'],
    ['a sub-path of an allowed page', '/reports/x'],
    ['a page the assistant never links to', '/team'],
    ['empty', ''],
  ])('rejects %s', (_name, href) => {
    expect(internalHref(href)).toBeNull();
  });

  it('accepts an allowed page with a query string and a fragment', () => {
    expect(internalHref('/financial-analysis?month=2026-11#plans')).toBe('/financial-analysis?month=2026-11#plans');
  });

  it('allows an encoded slash in the query, which is not part of the path', () => {
    expect(internalHref('/reports?category=a%2Fb')).toBe('/reports?category=a%2Fb');
  });
});

describe('linkTarget', () => {
  it('keeps https links apart from unsafe ones', () => {
    expect(linkTarget('https://example.com')).toEqual({ kind: 'external' });
    expect(linkTarget('http://example.com')).toEqual({ kind: 'text' });
    expect(linkTarget('//example.com')).toEqual({ kind: 'text' });
    expect(linkTarget('/debts')).toEqual({ kind: 'internal', href: '/debts' });
  });
});

describe('splitMarkdownLinks', () => {
  it('makes internal links into link segments', () => {
    expect(splitMarkdownLinks('Rent was [9 487 000 so\'m](/reports?category=expense%3Arent) this month.')).toEqual([
      { type: 'text', text: 'Rent was ' },
      { type: 'link', label: '9 487 000 so\'m', href: '/reports?category=expense%3Arent' },
      { type: 'text', text: ' this month.' },
    ]);
  });

  it('keeps https links as the Markdown the model wrote', () => {
    expect(splitMarkdownLinks('See [docs](https://example.com).')).toEqual([{ type: 'text', text: 'See [docs](https://example.com).' }]);
  });

  it('turns any other link into its label', () => {
    expect(splitMarkdownLinks('[click](javascript:alert%281%29) and [x](//evil.example) and [y](/\\evil)')).toEqual([
      { type: 'text', text: 'click and x and y' },
    ]);
    expect(splitMarkdownLinks('[z](data:text/html,hi) [w](/%2F%2Fevil.example)')).toEqual([{ type: 'text', text: 'z w' }]);
  });

  it('keeps only the label of a link to a page the member may not open', () => {
    const viewerWithoutReports = (path: string) => canAccessPath('admin', ['assistant', 'dashboard'], path);
    expect(splitMarkdownLinks('[a](/reports?from=2026-11-01) [b](/financial-analysis?month=2026-11)', viewerWithoutReports)).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'link', label: 'b', href: '/financial-analysis?month=2026-11' },
    ]);
  });

  it('turns API and sign-in links into their label', () => {
    expect(splitMarkdownLinks('[x](/api/google-business/connect?clubId=1) [y](/auth/callback)')).toEqual([{ type: 'text', text: 'x y' }]);
  });

  it('leaves text without links alone', () => {
    expect(splitMarkdownLinks('No links [here] (/x).')).toEqual([{ type: 'text', text: 'No links [here] (/x).' }]);
    expect(splitMarkdownLinks('')).toEqual([]);
  });
});
