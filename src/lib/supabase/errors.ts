// PostgREST's schema-cache codes (PGRST202/PGRST205) are raised only when the
// requested RPC or table itself is unknown. The Postgres codes (42883/42P01)
// can also come from *inside* an existing function, e.g. a missing operator or
// a helper it calls. Those must not be mistaken for "migration not applied", so
// they count only when the message names the requested object. A code-only
// error carries no message to check and keeps the historical behaviour.
function mentionsObject(message: string | undefined, name: string): boolean {
  return message === undefined || message === '' || message.includes(name);
}

export function isMissingDatabaseFunction(
  error: { code?: string; message?: string } | null | undefined,
  functionName: string,
): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202') return true;
  if (error.code === '42883') return mentionsObject(error.message, functionName);
  if (error.code) return false;
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
  if (error.code === 'PGRST205') return true;
  if (error.code === '42P01') return mentionsObject(error.message, tableName);
  if (error.code) return false;
  const message = error.message ?? '';
  return message.includes(tableName) && /could not find|does not exist/i.test(message);
}
