import { describe, expect, it } from "vitest";
import {
  parseInterfaceProfileJsonBytes,
  INTERFACE_PROFILE_JSON_MAX_BYTES,
} from "./profile-package.js";
import { admitInterfaceProfileContrast } from "./profile-safety.js";
import {
  encodeInterfaceProfileExport,
  INTERFACE_PROFILE_EXPORT_MAX_BYTES,
  INTERFACE_PROFILE_SUGGESTED_FILENAME,
} from "./profile-export.js";
import {
  BUILT_IN_INTERFACE_PROFILE_IDS,
  COLOR_ROLES,
  resolveBuiltInInterfaceProfile,
  resolveInterfaceProfile,
  type InterfaceProfileV1,
} from "./profile.js";

const builtIn = (id: (typeof BUILT_IN_INTERFACE_PROFILE_IDS)[number], density: "compact" | "comfortable") => {
  const resolved = resolveBuiltInInterfaceProfile(id, density);
  if (!resolved.ok) throw new Error(`Invalid built-in fixture: ${id}/${density}`);
  return resolved.value.profile;
};

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

const normalizedResolvedAppearance = (input: unknown) => {
  const resolved = resolveInterfaceProfile(input);
  if (!resolved.ok) throw new Error("Could not resolve profile fixture");
  return {
    profile: {
      name: resolved.value.profile.name,
      colorScheme: resolved.value.profile.colorScheme,
      typography: resolved.value.profile.typography,
      density: resolved.value.profile.density,
      chrome: resolved.value.profile.chrome,
    },
    variables: Object.fromEntries(Object.entries(resolved.value.variables).map(([key, value]) => [key, value.toUpperCase()])),
    attributes: resolved.value.attributes,
  };
};

describe("interface profile export encoder", () => {
  it("round-trips all three built-ins and both densities through parse and safety admission", () => {
    for (const id of BUILT_IN_INTERFACE_PROFILE_IDS) {
      for (const density of ["compact", "comfortable"] as const) {
        const source = builtIn(id, density);
        const encoded = encodeInterfaceProfileExport(source);
        expect(encoded, `${id}/${density}`).toMatchObject({ ok: true, filename: INTERFACE_PROFILE_SUGGESTED_FILENAME });
        if (!encoded.ok) throw new Error(`${id}/${density}: ${encoded.errors.map((error) => error.message).join("; ")}`);
        expect(encoded.bytes.byteLength).toBeLessThanOrEqual(INTERFACE_PROFILE_EXPORT_MAX_BYTES);
        expect(encoded.bytes.byteLength).toBeLessThanOrEqual(INTERFACE_PROFILE_JSON_MAX_BYTES);

        const parsed = parseInterfaceProfileJsonBytes(encoded.bytes);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) throw new Error(`${id}/${density}: ${parsed.errors.map((error) => error.message).join("; ")}`);
        const admitted = admitInterfaceProfileContrast(parsed.manifest);
        expect(admitted.ok).toBe(true);
        if (!admitted.ok) throw new Error(`${id}/${density}: ${admitted.errors.map((error) => error.message).join("; ")}`);
        expect(normalizedResolvedAppearance(admitted.profile)).toEqual(normalizedResolvedAppearance(source));
      }
    }
  });

  it("writes exact field and role order, uppercase colors, two-space JSON and one final LF", () => {
    const builtInSource = builtIn("tachiko", "compact");
    const source = {
      ...builtInSource,
      colors: Object.fromEntries(
        COLOR_ROLES.map((role) => [role, builtInSource.colors[role].toLowerCase()]),
      ) as InterfaceProfileV1["colors"],
    };
    const encoded = encodeInterfaceProfileExport(source);
    if (!encoded.ok) throw new Error(encoded.errors.map((error) => error.message).join("; "));
    const json = decode(encoded.bytes);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      "schemaVersion", "name", "colorScheme", "typography", "density", "chrome", "colors",
    ]);
    const colors = parsed.colors as Record<string, string>;
    expect(Object.keys(colors)).toEqual([...COLOR_ROLES]);
    expect(Object.values(colors).every((color) => /^#[0-9A-F]{6}$/.test(color))).toBe(true);
    expect(source.colors["text.primary"]).toBe("#252735");
    expect(source.colors["text.link"]).toBe("#5542b5");
    expect(colors["text.link"]).toBe("#5542B5");
    expect(json).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    expect(json.endsWith("\n")).toBe(true);
    expect(json.endsWith("\n\n")).toBe(false);
    expect(json).not.toContain("\r\n");
  });

  it("is deterministic for the same admitted profile and suggests a fixed safe filename", () => {
    const source = builtIn("familiar-spreadsheet", "comfortable");
    const first = encodeInterfaceProfileExport(source);
    const second = encodeInterfaceProfileExport(source);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Expected built-in export success");
    expect(Array.from(first.bytes)).toEqual(Array.from(second.bytes));
    expect(first.filename).toBe("appearance.tachiko-profile.json");
    expect(first.filename.endsWith(".tachiko-profile.json")).toBe(true);
  });

  it("returns contextual errors and no file data for invalid or unsafe inputs", () => {
    const structural = encodeInterfaceProfileExport({
      ...builtIn("tachiko", "compact"),
      unexpected: "must not leak",
    });
    expect(structural).toMatchObject({ ok: false, errors: [{ context: "manifest", path: "$.unexpected" }] });

    const base = builtIn("tachiko", "compact");
    const unsafe: InterfaceProfileV1 = {
      ...base,
      colors: { ...base.colors, "text.primary": "#FFFFFF" },
    };
    const contrast = encodeInterfaceProfileExport(unsafe);
    expect(contrast.ok).toBe(false);
    if (!contrast.ok) {
      expect(contrast.errors.some((error) => error.context.includes("grid cell text on grid canvas"))).toBe(true);
      expect(contrast.errors.every((error) => !("bytes" in error))).toBe(true);
    }
    expect(structural).not.toHaveProperty("bytes");
    expect(contrast).not.toHaveProperty("bytes");
  });

  it("does not serialize caller-owned extra or prototype-shaped data", () => {
    const profile = builtIn("minimal-focus", "compact");
    const hostile = Object.assign(Object.create({ inheritedSecret: "must not leak" }), profile) as InterfaceProfileV1 & {
      installationId?: string;
    };
    hostile.installationId = "must not leak";
    const result = encodeInterfaceProfileExport(hostile);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.context === "manifest")).toBe(true);
    expect(result).not.toHaveProperty("bytes");
  });
});
