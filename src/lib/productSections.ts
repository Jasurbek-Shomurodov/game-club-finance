export interface CategorySection<T> {
  /** Trimmed category name; an empty string holds uncategorized items. */
  category: string;
  items: T[];
}

/**
 * Groups items into category sections, alphabetically like the category
 * chips, with uncategorized items last. Items keep their incoming order
 * (the club's product sort order) inside each section.
 */
export function groupByCategory<T>(
  items: readonly T[],
  getCategory: (item: T) => string | null | undefined,
): CategorySection<T>[] {
  const byCategory = new Map<string, T[]>();
  for (const item of items) {
    const category = String(getCategory(item) ?? '').trim();
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(item);
    else byCategory.set(category, [item]);
  }
  return Array.from(byCategory, ([category, sectionItems]) => ({ category, items: sectionItems }))
    .sort((a, b) => {
      if (!a.category !== !b.category) return a.category ? -1 : 1;
      return a.category.localeCompare(b.category);
    });
}

