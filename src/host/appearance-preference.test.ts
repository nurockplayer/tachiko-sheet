import { describe, expect, it } from "vitest";
import {
  APPEARANCE_PREFERENCE_LEGACY_V1_STORAGE_KEY,
  APPEARANCE_PREFERENCE_V2_STORAGE_KEY,
  createBrowserAppearancePreferencePort,
} from "./appearance-preference.js";

describe("browser appearance preference host adapter", () => {
  it("uses the dedicated application key for reads and writes", () => {
    const calls: unknown[][] = [];
    const port = createBrowserAppearancePreferencePort({
      getItem: (key) => {
        calls.push(["read", key]);
        return key === APPEARANCE_PREFERENCE_V2_STORAGE_KEY ? null : "legacy-choice";
      },
      setItem: (key, value) => calls.push(["write", key, value]),
    });

    expect(port.readV2()).toBeNull();
    expect(port.readLegacyV1()).toBe("legacy-choice");
    port.writeV2('{"schemaVersion":2,"kind":"built-in","profileId":"tachiko","density":"compact"}');

    expect(APPEARANCE_PREFERENCE_V2_STORAGE_KEY).toBe("tachiko-sheet:appearance-preference:v2");
    expect(APPEARANCE_PREFERENCE_LEGACY_V1_STORAGE_KEY).toBe("tachiko-sheet:appearance-preference:v1");
    expect(calls).toEqual([
      ["read", APPEARANCE_PREFERENCE_V2_STORAGE_KEY],
      ["read", APPEARANCE_PREFERENCE_LEGACY_V1_STORAGE_KEY],
      ["write", APPEARANCE_PREFERENCE_V2_STORAGE_KEY, '{"schemaVersion":2,"kind":"built-in","profileId":"tachiko","density":"compact"}'],
    ]);
  });

  it("propagates storage exceptions to the application controller boundary", () => {
    const port = createBrowserAppearancePreferencePort({
      getItem: () => { throw new Error("blocked origin"); },
      setItem: () => { throw new Error("quota exceeded"); },
    });

    expect(() => port.readV2()).toThrow("blocked origin");
    expect(() => port.readLegacyV1()).toThrow("blocked origin");
    expect(() => port.writeV2("record")).toThrow("quota exceeded");
  });

  it("resolves the browser storage lazily so unavailable browser globals fail inside read", () => {
    const port = createBrowserAppearancePreferencePort();

    // The application controller catches this at startup; importing/creating
    // the host adapter itself has no browser-global side effect.
    expect(() => port.readV2()).toThrow();
  });
});
