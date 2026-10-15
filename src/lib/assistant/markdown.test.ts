import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
  it('splits headings, paragraphs, lists and tables', () => {
    const blocks = parseMarkdown([
      '## October',
      'Profit was **1 250 000 so\'m**.',
      '',
      '- Rent',
      '- Salary',
      '1. First',
      '2. Second',
      '',
      '| Month | Profit |',
      '|---|---:|',
      '| 09.2026 | 900 000 |',
      '| 10.2026 | 1 250 000 |',
      'Done.',
    ].join('\n'));

    expect(blocks).toEqual([
      { type: 'heading', text: 'October' },
      { type: 'paragraph', text: 'Profit was **1 250 000 so\'m**.' },
      { type: 'list', ordered: false, items: ['Rent', 'Salary'] },
      { type: 'list', ordered: true, items: ['First', 'Second'] },
      { type: 'table', header: ['Month', 'Profit'], rows: [['09.2026', '900 000'], ['10.2026', '1 250 000']] },
      { type: 'paragraph', text: 'Done.' },
    ]);
  });

  it('treats a lone pipe as ordinary text', () => {
    expect(parseMarkdown('cash | card')).toEqual([{ type: 'paragraph', text: 'cash | card' }]);
  });
});

describe('parseInline', () => {
  it('marks bold and code spans', () => {
    expect(parseInline('a **b** `c` d')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', code: true },
      { text: ' d' },
    ]);
  });
});
