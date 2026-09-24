import { describe, expect, it } from "vitest";
import {
  APPEARANCE_PREFERENCE_MAX_BYTES,
  decodeAppearancePreferenceV2,
  decodeLegacyAppearancePreferenceV1,
  encodeAppearancePreferenceV2,
} from "./appearance-preference-codec.js";
import {
  BUILT_IN_INTERFACE_PROFILE_IDS,
  resolveBuiltInInterfaceProfile,
  type InterfaceProfileV1,
} from "../ui/interface-profile/profile.js";

const builtInProfile = (profileId: (typeof BUILT_IN_INTERFACE_PROFILE_IDS)[number], density: "compact" | "comfortable") => {
  const resolved = resolveBuiltInInterfaceProfile(profileId, density);
  if (!resolved.ok) throw new Error(`Invalid built-in fixture: ${profileId}/${density}`);
  return resolved.value.profile;
};

const formerlyAdmittedPressedUnsafe = (): InterfaceProfileV1 => {
  const safe = builtInProfile("tachiko", "compact");
  return {
    ...safe,
    chrome: "structured",
    colors: {
      ...safe.colors,
      "surface.chrome": "#FFFFFF",
      "surface.chrome.tint": "#FFFFFF",
      "surface.content": "#FFFFFF",
      "surface.inset": "#FAFAFA",
      "grid.canvas": "#FFFFFF",
      "grid.header.background": "#FFFFFF",
      "selection.row.background": "#FFFFFF",
      "selection.active.background": "#FFFFFF",
      "selection.header.background": "#FFFFFF",
      "accent.background": "#FFFFFF",
      "text.primary": "#707070",
    },
  };
};

const record = (value: unknown) => JSON.stringify(value);

describe("appearance preference v2 codec", () => {
  it("round-trips each built-in identity and density", () => {
    for (const profileId of BUILT_IN_INTERFACE_PROFILE_IDS) {
      for (const density of ["compact", "comfortable"] as const) {
        const input = { schemaVersion: 2, kind: "built-in", profileId, density };
        const encoded = encodeAppearancePreferenceV2(input);
        expect(encoded.ok).toBe(true);
        if (!encoded.ok) throw new Error(encoded.errors.map((error) => error.message).join("; "));
        expect(JSON.parse(encoded.value.raw)).toEqual(input);
        const decoded = decodeAppearancePreferenceV2(encoded.value.raw);
        expect(decoded).toMatchObject({ ok: true, value: input });
      }
    }
  });

  it("round-trips an imported profile through fresh structural and contrast admission", () => {
    const imported: InterfaceProfileV1 = {
      ...builtInProfile("familiar-spreadsheet", "comfortable"),
      name: "My Spreadsheet",
    };
    const encoded = encodeAppearancePreferenceV2({ schemaVersion: 2, kind: "imported", profile: imported });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) throw new Error(encoded.errors.map((error) => error.message).join("; "));
    const decoded = decodeAppearancePreferenceV2(encoded.value.raw);
    expect(decoded).toMatchObject({ ok: true, value: { schemaVersion: 2, kind: "imported" } });
    if (!decoded.ok || decoded.value.kind !== "imported") throw new Error("Expected imported preference");
    expect(decoded.value.profile.name).toBe("My Spreadsheet");
    expect(Object.isFrozen(decoded.value)).toBe(true);
    expect(Object.isFrozen(decoded.value.profile)).toBe(true);
    expect(Object.isFrozen(decoded.value.profile.colors)).toBe(true);
  });

  it("keeps imported identity separate when its display name matches a built-in", () => {
    const imported: InterfaceProfileV1 = {
      ...builtInProfile("tachiko", "compact"),
      name: "Tachiko",
    };
    const encoded = encodeAppearancePreferenceV2({ schemaVersion: 2, kind: "imported", profile: imported });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) throw new Error(encoded.errors.map((error) => error.message).join("; "));
    const decoded = decodeAppearancePreferenceV2(encoded.value.raw);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.errors.map((error) => error.message).join("; "));
    expect(decoded.value.kind).toBe("imported");
    if (decoded.value.kind === "imported") expect(decoded.value.profile.name).toBe("Tachiko");
  });

  it.each([
    ["malformed JSON", "{"],
    ["wrong version", record({ schemaVersion: 3, kind: "built-in", profileId: "tachiko", density: "compact" })],
    ["unknown kind", record({ schemaVersion: 2, kind: "registry", profileId: "tachiko", density: "compact" })],
    ["unknown field", record({ schemaVersion: 2, kind: "built-in", profileId: "tachiko", density: "compact", extra: true })],
    ["missing field", record({ schemaVersion: 2, kind: "built-in", profileId: "tachiko" })],
    ["unsupported profile", record({ schemaVersion: 2, kind: "built-in", profileId: "custom", density: "compact" })],
    ["unsupported density", record({ schemaVersion: 2, kind: "built-in", profileId: "minimal-focus", density: "spacious" })],
    ["public v1 sent to v2 decoder", record({ schemaVersion: 1, profileId: "tachiko", density: "compact" })],
  ])("returns a typed error for %s", (_label, raw) => {
    const decoded = decodeAppearancePreferenceV2(raw);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.errors[0]?.code).toBeTruthy();
  });

  it("rejects duplicate decoded keys instead of applying JSON last-key-wins", () => {
    const duplicate = '{"schemaVersion":2,"kind":"built-in","profileId":"tachiko","profileId":"minimal-focus","density":"compact"}';
    expect(decodeAppearancePreferenceV2(duplicate)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid-json" }],
    });
    const escapedDuplicate = '{"schemaVersion":2,"kind":"built-in","profileId":"tachiko","profile\\u0049d":"minimal-focus","density":"compact"}';
    expect(decodeAppearancePreferenceV2(escapedDuplicate)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid-json" }],
    });
  });

  it("rejects structurally invalid or contrast-unsafe imported profiles on encode and decode", () => {
    const good = builtInProfile("tachiko", "compact");
    const structurallyInvalid = { ...good, injected: "must not be stored" };
    const invalidEncode = encodeAppearancePreferenceV2({ schemaVersion: 2, kind: "imported", profile: structurallyInvalid });
    expect(invalidEncode.ok).toBe(false);
    if (!invalidEncode.ok) expect(invalidEncode.errors.some((error) => error.code === "invalid-profile")).toBe(true);

    const unsafe: InterfaceProfileV1 = {
      ...good,
      colors: { ...good.colors, "text.primary": "#FFFFFF" },
    };
    const invalidEncodeContrast = encodeAppearancePreferenceV2({ schemaVersion: 2, kind: "imported", profile: unsafe });
    expect(invalidEncodeContrast.ok).toBe(false);
    if (!invalidEncodeContrast.ok) {
      expect(invalidEncodeContrast.errors.some((error) => error.code === "unsafe-profile" && error.context?.includes("grid cell text"))).toBe(true);
    }

    const rawUnsafe = record({ schemaVersion: 2, kind: "imported", profile: unsafe });
    const invalidDecode = decodeAppearancePreferenceV2(rawUnsafe);
    expect(invalidDecode.ok).toBe(false);
    if (!invalidDecode.ok) expect(invalidDecode.errors.some((error) => error.code === "unsafe-profile")).toBe(true);
  });

  it("rejects formerly admitted v2 custom JSON when its text misses the fixed pressed surface", () => {
    const rawPersistedV2 = record({
      schemaVersion: 2,
      kind: "imported",
      profile: formerlyAdmittedPressedUnsafe(),
    });
    const decoded = decodeAppearancePreferenceV2(rawPersistedV2);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "unsafe-profile",
          context: "text.primary text on shared control pressed surface",
          message: expect.stringContaining("4.27:1 contrast; requires at least 4.5:1"),
        }),
      ]));
      expect(decoded.errors.every((error) => error.code === "unsafe-profile" &&
        error.context === "text.primary text on shared control pressed surface")).toBe(true);
    }
  });

  it("decodes only the exact legacy v1 built-in record shape", () => {
    const legacy = decodeLegacyAppearancePreferenceV1('{"schemaVersion":1,"profileId":"familiar-spreadsheet","density":"comfortable"}');
    expect(legacy).toEqual({ ok: true, value: { profileId: "familiar-spreadsheet", density: "comfortable" } });
    expect(decodeLegacyAppearancePreferenceV1(record({ schemaVersion: 1, profileId: "tachiko", density: "compact", extra: 1 })))
      .toMatchObject({ ok: false, errors: [{ code: "unknown-field" }] });
    expect(decodeLegacyAppearancePreferenceV1(record({ schemaVersion: 2, kind: "built-in", profileId: "tachiko", density: "compact" })))
      .toMatchObject({ ok: false, errors: [{ code: "unknown-field" }] });
  });

  it("bounds stored input by UTF-8 byte length and has no automatic v1 fallback", () => {
    const validV2 = '{"schemaVersion":2,"kind":"built-in","profileId":"tachiko","density":"compact"}';
    const exactLimit = `${validV2}${" ".repeat(APPEARANCE_PREFERENCE_MAX_BYTES - validV2.length)}`;
    expect(decodeAppearancePreferenceV2(exactLimit).ok).toBe(true);
    expect(decodeAppearancePreferenceV2(`${exactLimit} `)).toMatchObject({ ok: false, errors: [{ code: "too-large" }] });
    expect(decodeAppearancePreferenceV2("界".repeat(Math.ceil(APPEARANCE_PREFERENCE_MAX_BYTES / 3))))
      .toMatchObject({ ok: false, errors: [{ code: "too-large" }] });
    expect(decodeAppearancePreferenceV2("{corrupt-v2")).toMatchObject({ ok: false, errors: [{ code: "invalid-json" }] });
    // Legacy decoding is an explicit separate call; v2 failure does not choose it.
    expect(decodeLegacyAppearancePreferenceV1("{corrupt-v2")).toMatchObject({ ok: false, errors: [{ code: "invalid-json" }] });
  });
});
