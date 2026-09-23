/** Browser-origin storage adapter for the local application appearance choice. */

export const APPEARANCE_PREFERENCE_V2_STORAGE_KEY = "tachiko-sheet:appearance-preference:v2";
export const APPEARANCE_PREFERENCE_LEGACY_V1_STORAGE_KEY = "tachiko-sheet:appearance-preference:v1";

export interface StringPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Keep browser storage access at the host boundary. Resolving `window` inside
 * each operation lets the application controller safely handle unavailable
 * storage and also permits tests or alternate hosts to inject a storage port.
 */
export function createBrowserAppearancePreferencePort(storage?: StringPreferenceStorage) {
  return Object.freeze({
    readV2(): string | null {
      const target = storage ?? window.localStorage;
      return target.getItem(APPEARANCE_PREFERENCE_V2_STORAGE_KEY);
    },
    readLegacyV1(): string | null {
      const target = storage ?? window.localStorage;
      return target.getItem(APPEARANCE_PREFERENCE_LEGACY_V1_STORAGE_KEY);
    },
    writeV2(value: string): void {
      const target = storage ?? window.localStorage;
      target.setItem(APPEARANCE_PREFERENCE_V2_STORAGE_KEY, value);
    },
  });
}
