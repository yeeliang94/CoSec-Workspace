function codes(error: unknown) {
  const found: string[] = [];
  for (let e = error as { code?: string; cause?: unknown } | undefined; e; e = e.cause as never)
    if (e.code) found.push(e.code);
  return found;
}
/**
 * True when SQLite rejected a write for a duplicate unique or primary key. Drizzle wraps driver
 * errors, so the code may sit on the error or on its cause.
 */
export function isUniqueViolation(error: unknown) {
  return codes(error).some(
    (c) => c === 'SQLITE_CONSTRAINT_UNIQUE' || c === 'SQLITE_CONSTRAINT_PRIMARYKEY',
  );
}
/** True when another process held the write lock for longer than the busy timeout. */
export function isBusy(error: unknown) {
  return codes(error).some((c) => c.startsWith('SQLITE_BUSY'));
}
