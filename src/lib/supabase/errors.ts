export function isMissingDatabaseFunction(
  error: { code?: string; message?: string } | null | undefined,
  functionName: string,
): boolean {
  if (!error) return false;
  if (error.code) return error.code === 'PGRST202' || error.code === '42883';
  const message = error.message ?? '';
  return message.includes(functionName)
    && /function/i.test(message)
    && /could not find|does not exist/i.test(message);
}

export function isMissingDatabaseColumn(
  error: { code?: string; message?: string } | null | undefined,
  columnName: string,
): boolean {
  if (!error) return false;
  return error.code === '42703'
    && (error.message?.includes(columnName) ?? false);
}

export function isMissingDatabaseTable(
  error: { code?: string; message?: string } | null | undefined,
  tableName: string,
): boolean {
  if (!error) return false;
  if (error.code) return error.code === 'PGRST205' || error.code === '42P01';
  const message = error.message ?? '';
  return message.includes(tableName) && /could not find|does not exist/i.test(message);
}
