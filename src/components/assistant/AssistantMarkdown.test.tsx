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

describe('AssistantMarkdown charts', () => {
  const spec = JSON.stringify({ type: 'line', unit: 'money', labels: ['01.11', '02.11'], series: [{ name: 'Game club', values: [1, 2] }] });

  it('draws a valid chart block in place of its JSON', () => {
    const html = render(`Income by day:\n\n\`\`\`chart\n${spec}\n\`\`\`\n\nIt rose.`);
    // The chart loads in the browser; until then its placeholder holds the space.
    expect(html).toContain('class="skeleton ');
    expect(html).not.toContain('Game club');
    expect(html).not.toContain('<pre');
    expect(html).toContain('It rose.');
  });

  it('draws nothing for an invalid spec, bad JSON or a block still streaming', () => {
    const invalid = JSON.stringify({ type: 'pie', unit: 'money', labels: ['a', 'b'], series: [{ name: 'A', values: [1, 2] }] });
    for (const source of [
      `Before\n\n\`\`\`chart\n${invalid}\n\`\`\`\n\nAfter`,
      'Before\n\n```chart\n{"type": "line", oops}\n```\n\nAfter',
      `Before\n\n\`\`\`chart\n${spec.slice(0, 30)}`,
      `Before\n\n\`\`\`chart\n${spec}`,
    ]) {
      const html = render(source);
      expect(html).toContain('Before');
      expect(html).not.toContain('<pre');
      expect(html).not.toContain('class="skeleton ');
      expect(html).not.toContain('{');
    }
  });

  it('still shows other code blocks as code', () => {
    expect(render('```json\n{"a": 1}\n```')).toContain('<pre');
  });
});
