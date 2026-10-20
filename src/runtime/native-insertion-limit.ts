// Work's published native insertion gate for pin 375da29f (ADR-0045).
// Replace this pin-bound adapter with a Work capability when one exists.
export const NATIVE_INSERTION_ROW_LIMIT = 128;

export function nativeInsertionLimitReached(storedRows: number): boolean {
  return storedRows >= NATIVE_INSERTION_ROW_LIMIT;
}

export function nativeInsertionFits(storedRows: number, addedRows: number): boolean {
  return !nativeInsertionLimitReached(storedRows) && storedRows + addedRows <= NATIVE_INSERTION_ROW_LIMIT;
}
