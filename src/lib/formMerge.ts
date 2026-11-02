/**
 * Brings a form up to date with reloaded data without losing typing: a field
 * still equal to `baseline` (what the form was last filled with) takes its
 * `fresh` value, and a field the user changed keeps their edit.
 */
export function mergeUntouchedFields<T extends object>(current: T, baseline: T, fresh: T): T {
  const merged = { ...current };
  for (const key of Object.keys(fresh) as Array<keyof T>) {
    if (current[key] === baseline[key]) merged[key] = fresh[key];
  }
  return merged;
}
