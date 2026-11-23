import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { canAccessPath } from '@/lib/permissions';
import { AssistantMarkdown } from './AssistantMarkdown';

const ownerCanOpen = (path: string) => canAccessPath('owner', null, path);
const render = (source: string, canOpen = ownerCanOpen) => renderToStaticMarkup(<AssistantMarkdown source={source} canOpen={canOpen} />);

describe('AssistantMarkdown links', () => {
  it('renders a link to an app page in paragraphs, lists, bold text and tables', () => {
    const html = render([
      'Rent: [9 487 000 so\'m](/reports?from=2026-11-01&to=2026-11-24&category=expense%3Arent).',
      '',
      '- **[3 checks](/financial-analysis?month=2026-11)**',
      '',
      '| Day | Income |',
      '| --- | --- |',
      '| 03.11 | [1 000](/daily-report?date=2026-11-03) |',
    ].join('\n'));
    expect(html).toContain('href="/reports?from=2026-11-01&amp;to=2026-11-24&amp;category=expense%3Arent"');
    expect(html).toContain('href="/financial-analysis?month=2026-11"');
    expect(html).toContain('href="/daily-report?date=2026-11-03"');
    expect(html).not.toContain('](');
  });

  it('never renders an unsafe, external, API or sign-in href', () => {
    const html = render('[a](//evil.example) [b](/\\evil.example) [c](javascript:alert%281%29) [d](/%2F%2Fevil.example) [f](/api/google-business/connect?clubId=1) [g](/auth/callback) [h](/reportsX) [e](https://example.com)');
    expect(html).not.toContain('<a');
    expect(html).toContain('a b c d f g h [e](https://example.com)');
  });

  it('renders a link to a page the member may not open as its label', () => {
    const dashboardOnly = (path: string) => canAccessPath('admin', ['assistant', 'dashboard'], path);
    const html = render('[a](/reports?from=2026-11-01) and [b](/financial-analysis?month=2026-11)', dashboardOnly);
    expect(html).not.toContain('href="/reports');
    expect(html).toContain('href="/financial-analysis?month=2026-11"');
  });
});
