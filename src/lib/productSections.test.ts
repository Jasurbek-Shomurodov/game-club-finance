import { describe, expect, it } from 'vitest';
import { groupByCategory } from './productSections';

describe('groupByCategory', () => {
  it('sorts sections alphabetically, keeps item order, and puts uncategorized last', () => {
    const items = [
      { name: 'Cola', category: 'bar' },
      { name: 'Hot dog', category: null },
      { name: 'Chips', category: 'CHIPS' },
      { name: 'Pepsi', category: ' bar ' },
      { name: 'Ticket', category: '' },
    ];

    expect(groupByCategory(items, (item) => item.category)).toEqual([
      { category: 'bar', items: [items[0], items[3]] },
      { category: 'CHIPS', items: [items[2]] },
      { category: '', items: [items[1], items[4]] },
    ]);
  });

  it('returns no sections for no items', () => {
    expect(groupByCategory([], () => 'bar')).toEqual([]);
  });
});
