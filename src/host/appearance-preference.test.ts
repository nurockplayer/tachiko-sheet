import { describe, expect, it } from "vitest";
import {
  APPEARANCE_PREFERENCE_STORAGE_KEY,
  createBrowserAppearancePreferencePort,
} from "./appearance-preference.js";

describe("browser appearance preference host adapter", () => {
  it("uses the dedicated application key for reads and writes", () => {
    const calls: unknown[][] = [];
    const port = createBrowserAppearancePreferencePort({
      getItem: (key) => {
        calls.push(["read", key]);
        return "saved-choice";
      },
      setItem: (key, value) => calls.push(["write", key, value]),
    });

    expect(port.read()).toBe("saved-choice");
    port.write('{"schemaVersion":1,"profileId":"tachiko","density":"compact"}');

    expect(APPEARANCE_PREFERENCE_STORAGE_KEY).toBe("tachiko-sheet:appearance-preference:v1");
    expect(calls).toEqual([
      ["read", APPEARANCE_PREFERENCE_STORAGE_KEY],
      ["write", APPEARANCE_PREFERENCE_STORAGE_KEY, '{"schemaVersion":1,"profileId":"tachiko","density":"compact"}'],
    ]);
  });

  it("propagates storage exceptions to the application controller boundary", () => {
    const port = createBrowserAppearancePreferencePort({
      getItem: () => { throw new Error("blocked origin"); },
      setItem: () => { throw new Error("quota exceeded"); },
    });

    expect(() => port.read()).toThrow("blocked origin");
    expect(() => port.write("record")).toThrow("quota exceeded");
  });

  it("resolves the browser storage lazily so unavailable browser globals fail inside read", () => {
    const port = createBrowserAppearancePreferencePort();

    // The application controller catches this at startup; importing/creating
    // the host adapter itself has no browser-global side effect.
    expect(() => port.read()).toThrow();
  });
});
