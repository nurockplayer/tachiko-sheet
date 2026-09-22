import { describe, expect, it } from "vitest";
import {
  COLOR_ROLES,
  PRIVATE_CSS_VARIABLES,
  TACHIKO_COMPACT_PORCELAIN_PROFILE,
  applyResolvedProfile,
  resolveInterfaceProfile,
  validateInterfaceProfile,
} from "./profile.js";
import mapping from "../../../docs/design/interface-profile-v1-mapping.json";

const validInput = (): Record<string, unknown> => ({
  ...TACHIKO_COMPACT_PORCELAIN_PROFILE,
  colors: { ...TACHIKO_COMPACT_PORCELAIN_PROFILE.colors },
});

describe("Interface Profile v1 closed contract", () => {
  it("has exactly the canonical 29 roles and canonical Tachiko values", () => {
    expect(COLOR_ROLES).toHaveLength(29);
    expect(Object.isFrozen(COLOR_ROLES)).toBe(true);
    expect(TACHIKO_COMPACT_PORCELAIN_PROFILE.colors["text.link"]).toBe("#5542B5");
    expect(TACHIKO_COMPACT_PORCELAIN_PROFILE.colors["text.reference"]).toBe("#4F54AD");
    expect(TACHIKO_COMPACT_PORCELAIN_PROFILE.colors["grid.header.foreground"]).toBe("#5B6072");
  });

  it.each(["schemaVersion", "name", "colorScheme", "typography", "density", "chrome", "colors"])(
    "rejects missing field %s",
    (key) => {
      const input = validInput();
      delete input[key];
      const result = validateInterfaceProfile(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((error) => error.path === key)).toBe(true);
    },
  );

  it.each(["protected", "state", "error", "disabled", "destructive", "scrim"])(
    "rejects unknown/protected top-level field %s",
    (key) => {
    const input = validInput();
    input[key] = { value: "#000000" };
    const result = validateInterfaceProfile(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.path === `$.${key}`)).toBe(true);
    },
  );

  it.each(COLOR_ROLES)("rejects missing color role %s", (role) => {
    const missing = validInput();
    delete (missing.colors as Record<string, unknown>)[role];
    const missingResult = validateInterfaceProfile(missing);
    expect(missingResult.ok).toBe(false);
  });

  it.each(["state.error", "disabled", "destructive", "scrim", "focus.geometry"])(
    "rejects unknown/protected color role %s",
    (role) => {
    const unknown = validInput();
    (unknown.colors as Record<string, unknown>)[role] = "#AABBCC";
    const unknownResult = validateInterfaceProfile(unknown);
    expect(unknownResult.ok).toBe(false);
    },
  );

  it.each([
    ["schemaVersion", "1"],
    ["name", 3],
    ["colorScheme", "dark"],
    ["typography", "remote-font"],
    ["density", "spacious"],
    ["chrome", "glass"],
  ] as const)("rejects invalid enum/type %s independently", (key, value) => {
    const input = validInput();
    input[key] = value;
    const result = validateInterfaceProfile(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.path === key)).toBe(true);
  });

  it.each([
    ["schemaVersion", null],
    ["name", {}],
    ["colorScheme", []],
    ["typography", null],
    ["density", {}],
    ["chrome", []],
    ["colors", []],
  ] as const)("rejects invalid field type %s independently", (key, value) => {
    const input = validInput();
    input[key] = value;
    expect(validateInterfaceProfile(input).ok).toBe(false);
  });

  it.each(["#123", "#12345", "#1234567", "#12345678", "red", "rgb(0,0,0)", "url(https://evil)", "#123456; color:red", "#123456\n", "#123456\nbody{}"]) (
    "rejects invalid color syntax %s independently",
    (value) => {
      const input = validInput();
      (input.colors as Record<string, unknown>)["focus.ring"] = value;
      const result = validateInterfaceProfile(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((error) => error.path === "colors.focus.ring")).toBe(true);
    },
  );

  it.each([null, [], "profile", 1, true])("rejects top-level non-record %j", (input) => {
    expect(validateInterfaceProfile(input).ok).toBe(false);
  });

  it("detaches and freezes a valid manifest", () => {
    const input = validInput();
    const result = validateInterfaceProfile(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    input.name = "mutated";
    (input.colors as Record<string, string>)["text.primary"] = "#000000";
    expect(result.value.name).toBe("Tachiko");
    expect(result.value.colors["text.primary"]).toBe("#252735");
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.colors)).toBe(true);
  });

  it("accepts a valid null-prototype manifest and rejects inherited fields", () => {
    const input = Object.create(null) as Record<string, unknown>;
    Object.assign(input, validInput());
    input.colors = Object.assign(Object.create(null), input.colors);
    expect(validateInterfaceProfile(input).ok).toBe(true);
    const inherited = Object.create({ name: "inherited" }) as Record<string, unknown>;
    Object.assign(inherited, validInput());
    delete inherited.name;
    const result = validateInterfaceProfile(inherited);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.path === "name")).toBe(true);
  });

  it("rejects hidden non-enumerable and symbol fields", () => {
    const input = validInput();
    Object.defineProperty(input, "hidden", { value: true, enumerable: false });
    const symbol = Symbol("protected");
    Object.defineProperty(input, symbol, { value: true, enumerable: false });
    const inputResult = validateInterfaceProfile(input);
    expect(inputResult.ok).toBe(false);
    const colors = input.colors as Record<string, unknown>;
    Object.defineProperty(colors, "state.error", { value: "#000000", enumerable: false });
    const colorsResult = validateInterfaceProfile(input);
    expect(colorsResult.ok).toBe(false);
  });

  it("rejects accessors without executing them", () => {
    const input = validInput();
    let topLevelReads = 0;
    Object.defineProperty(input, "name", {
      get() {
        topLevelReads += 1;
        return "Tachiko";
      },
      enumerable: true,
    });
    const colors = input.colors as Record<string, unknown>;
    let colorReads = 0;
    Object.defineProperty(colors, "focus.ring", {
      get() {
        colorReads += 1;
        return "#6551CE";
      },
      enumerable: true,
    });
    expect(validateInterfaceProfile(input).ok).toBe(false);
    expect(topLevelReads).toBe(0);
    expect(colorReads).toBe(0);
  });

  it("resolves only the exhaustive private allowlist", () => {
    const result = resolveInterfaceProfile(validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.variables)).toHaveLength(29);
    expect(Object.keys(result.value.variables).sort()).toEqual(
      Object.values(PRIVATE_CSS_VARIABLES).sort(),
    );
    expect(result.value.variables[PRIVATE_CSS_VARIABLES["surface.app"]]).toBe("#FFFFFF");
    expect(result.value.attributes["data-ts-profile-density"]).toBe("compact");
  });

  it("keeps the checked-in mapping exactly aligned with the canonical manifest and bindings", () => {
    expect(mapping.roles).toHaveLength(COLOR_ROLES.length);
    const expected = COLOR_ROLES.map((role) => ({
      role,
      value: TACHIKO_COMPACT_PORCELAIN_PROFILE.colors[role],
      privateCssName: PRIVATE_CSS_VARIABLES[role],
    }));
    expect(mapping.roles.map(({ role, value, privateCssName }) => ({ role, value, privateCssName }))).toEqual(expected);
    for (const role of mapping.roles) {
      expect(Object.keys(role).sort()).toEqual(["binding", "nodeUri", "privateCssName", "role", "value"]);
      expect(Object.keys(role.binding).sort()).toEqual(["collectionId", "modeId", "variableId"]);
      expect(role.binding).toEqual({ variableId: null, collectionId: null, modeId: null });
    }
  });

  it("does not apply forged or invalid resolver output", () => {
    const styleWrites: string[] = [];
    const target = {
      style: { setProperty: (name: string) => styleWrites.push(name) },
      setAttribute: () => undefined,
    } as unknown as HTMLElement;
    expect(applyResolvedProfile(target, { variables: {}, attributes: {} })).toBe(false);
    expect(styleWrites).toEqual([]);
  });

  it("applies exactly 29 variables and four enum attributes", () => {
    const result = resolveInterfaceProfile(validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const styleWrites: string[] = [];
    const attrs: string[] = [];
    const target = {
      style: { setProperty: (name: string) => styleWrites.push(name) },
      setAttribute: (name: string) => attrs.push(name),
    } as unknown as HTMLElement;
    expect(applyResolvedProfile(target, result.value)).toBe(true);
    expect(styleWrites).toHaveLength(29);
    expect(styleWrites.every((key) => key.startsWith("--ts-profile-"))).toBe(true);
    expect(attrs).toEqual([
      "data-ts-profile-color-scheme",
      "data-ts-profile-typography",
      "data-ts-profile-density",
      "data-ts-profile-chrome",
    ]);
  });
});
