import { describe, expect, it } from "vitest";
import { stageInterfaceProfileImport } from "./interface-profile-import.js";
import { COLOR_ROLES, type InterfaceProfileV1 } from "./interface-profile-contract.js";
import { resolveBuiltInInterfaceProfile } from "../ui/interface-profile/profile.js";

const builtInManifest = (): InterfaceProfileV1 => {
  const resolved = resolveBuiltInInterfaceProfile("tachiko", "compact");
  if (!resolved.ok) throw new Error("Expected Tachiko compact built-in fixture");
  return {
    schemaVersion: 1,
    name: "Tachiko",
    colorScheme: "light",
    typography: "tachiko-local",
    density: "compact",
    chrome: "structured",
    colors: Object.fromEntries(COLOR_ROLES.map((role) => [role, resolved.value.profile.colors[role]])) as InterfaceProfileV1["colors"],
  };
};

const bytesOf = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

describe("Interface Profile import staging", () => {
  it("returns an admitted, detached frozen candidate for a valid manifest", () => {
    const source = builtInManifest();
    const bytes = bytesOf(source);
    const result = stageInterfaceProfileImport(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join("; "));
    expect(result.kind).toBe("staged-candidate");
    expect(result.profile).toEqual(source);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.profile)).toBe(true);
    expect(Object.isFrozen(result.profile.colors)).toBe(true);

    bytes.fill(0);
    expect(result.profile.name).toBe("Tachiko");
    expect(result.profile.colors["text.primary"]).toBe(source.colors["text.primary"]);
  });

  it("preserves parser-first errors for malformed or oversized input", () => {
    expect(stageInterfaceProfileImport(new TextEncoder().encode("{"))).toMatchObject({
      ok: false,
      errors: [{ stage: "parse", path: "$" }],
    });

    expect(stageInterfaceProfileImport(new Uint8Array(32_769))).toMatchObject({
      ok: false,
      errors: [{ stage: "parse", message: expect.stringContaining("32768-byte limit") }],
    });
  });

  it("distinguishes structurally valid but contrast-unsafe manifests", () => {
    const safe = builtInManifest();
    const unsafe: InterfaceProfileV1 = {
      ...safe,
      colors: { ...safe.colors, "text.primary": "#FFFFFF" },
    };
    const result = stageInterfaceProfileImport(bytesOf(unsafe));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        stage: "safety",
        context: expect.stringContaining("text.primary"),
        required: 4.5,
      });
    }
  });
});
