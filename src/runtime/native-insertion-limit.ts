// Sheet's early insertion bound for Work's working-size profile.
export const NATIVE_INSERTION_ROW_LIMIT = 10_000;

export function nativeInsertionLimitReached(storedRows: number): boolean {
  return storedRows >= NATIVE_INSERTION_ROW_LIMIT;
}

export function nativeInsertionFits(storedRows: number, addedRows: number): boolean {
  return !nativeInsertionLimitReached(storedRows) && storedRows + addedRows <= NATIVE_INSERTION_ROW_LIMIT;
}
