import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import {
  BUILT_IN_INTERFACE_PROFILE_IDS,
  COLOR_ROLES,
  PRIVATE_CSS_VARIABLES,
  TACHIKO_COMPACT_PORCELAIN_PROFILE,
  applyResolvedProfile,
  resolveBuiltInInterfaceProfile,
  resolveInterfaceProfile,
  validateInterfaceProfile,
} from "./profile.js";
import mapping from "../../../docs/design/interface-profile-v1-mapping.json";

const validInput = (): Record<string, unknown> => ({
  ...TACHIKO_COMPACT_PORCELAIN_PROFILE,
  colors: { ...TACHIKO_COMPACT_PORCELAIN_PROFILE.colors },
});

const approvedOverrides = {
  "familiar-spreadsheet": {
    "surface.chrome": "#F3F4F6",
    "surface.chrome.tint": "#EFF1F4",
    "surface.inset": "#F0F2F5",
    "text.primary": "#24292F",
    "text.secondary": "#57606A",
    "text.onTint": "#4B5563",
    "text.link": "#1755B5",
    "text.reference": "#1755B5",
    "border.subtle": "#CCD1D8",
    "border.control": "#7A8491",
    "action.primary.background": "#245EB8",
    "action.primary.hover": "#1D4E9B",
    "action.primary.pressed": "#183F80",
    "accent.foreground": "#1755B5",
    "accent.background": "#EAF1FC",
    "grid.line.horizontal": "#D7DCE2",
    "grid.line.vertical": "#DFE3E8",
    "grid.header.background": "#EBEDF0",
    "grid.header.foreground": "#4B5563",
    "selection.row.background": "#F0F5FD",
    "selection.header.background": "#DDE9FA",
    "selection.header.foreground": "#1755B5",
    "selection.active.border": "#245EB8",
    "focus.ring": "#245EB8",
  },
  "minimal-focus": {
    "surface.chrome": "#FCFCFD",
    "surface.chrome.tint": "#FCFCFD",
    "surface.inset": "#F7F7F9",
    "text.secondary": "#656570",
    "text.onTint": "#5F606B",
    "text.link": "#62528C",
    "text.reference": "#62528C",
    "border.subtle": "#E5E5EB",
    "border.control": "#898793",
    "action.primary.background": "#6C5B95",
    "action.primary.hover": "#5E4D86",
    "action.primary.pressed": "#514173",
    "accent.foreground": "#62528C",
    "accent.background": "#F5F2FA",
    "grid.line.horizontal": "#EBEBF0",
    "grid.line.vertical": "#F1F1F4",
    "grid.header.background": "#FAFAFC",
    "grid.header.foreground": "#5F606B",
    "selection.row.background": "#F8F6FC",
    "selection.header.background": "#F0ECF7",
    "selection.header.foreground": "#62528C",
    "selection.active.border": "#6C5B95",
    "focus.ring": "#6C5B95",
  },
} as const;

describe("Interface Profile v1 closed contract", () => {
  it("has exactly the canonical 29 roles and canonical Tachiko values", () => {
    expect(COLOR_ROLES).toHaveLength(29);
    expect(Object.isFrozen(COLOR_ROLES)).toBe(true);
    expect(TACHIKO_COMPACT_PORCELAIN_PROFILE.colors["text.link"]).toBe("#5542B5");
    expect(TACHIKO_COMPACT_PORCELAIN_PROFILE.colors["text.reference"]).toBe("#4F54AD");
    expect(TACHIKO_COMPACT_PORCELAIN_PROFILE.colors["grid.header.foreground"]).toBe("#5B6072");
  });

  it("accepts names of 1 to 80 Unicode scalar values and preserves their spelling", () => {
    const oneScalar = validInput();
    oneScalar.name = "漢";
    const one = validateInterfaceProfile(oneScalar);
    expect(one.ok).toBe(true);
    if (one.ok) expect(one.value.name).toBe("漢");

    const eightyScalars = validInput();
    eightyScalars.name = "🙂".repeat(80);
    const eighty = validateInterfaceProfile(eightyScalars);
    expect(eighty.ok).toBe(true);
    if (eighty.ok) expect([...eighty.value.name]).toHaveLength(80);

    const decomposed = validInput();
    decomposed.name = "e\u0301";
    const preserved = validateInterfaceProfile(decomposed);
    expect(preserved.ok).toBe(true);
    if (preserved.ok) expect(preserved.value.name).toBe("e\u0301");
  });

  it.each([
    ["", "empty"],
    ["a".repeat(81), "more than 80 scalars"],
    ["name\u0000", "C0 control"],
    ["name\u0085", "C1 control"],
    ["\uD800", "lone high surrogate"],
    ["\uDC00", "lone low surrogate"],
  ])("rejects invalid profile name (%s)", (name) => {
    const input = validInput();
    input.name = name;
    const result = validateInterfaceProfile(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.path === "name")).toBe(true);
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

  it.each(BUILT_IN_INTERFACE_PROFILE_IDS.flatMap((profileId) =>
    (["compact", "comfortable"] as const).map((density) => [profileId, density] as const),
  ))("resolves the closed built-in recipe %s at %s density", (profileId, density) => {
    const result = resolveBuiltInInterfaceProfile(profileId, density);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const metadata = {
      tachiko: { name: "Tachiko", typography: "tachiko-local", chrome: "porcelain" },
      "familiar-spreadsheet": { name: "Familiar Spreadsheet", typography: "system-local", chrome: "structured" },
      "minimal-focus": { name: "Minimal-Focus", typography: "tachiko-local", chrome: "quiet" },
    }[profileId];
    expect(result.value.profile).toMatchObject(metadata);
    expect(result.value.profile.density).toBe(density);
    expect(result.value.profile.colors).toHaveProperty("surface.app");
    expect(Object.keys(result.value.variables)).toHaveLength(COLOR_ROLES.length);
    expect(result.value.attributes["data-ts-profile-density"]).toBe(density);
    expect(result.value.attributes["data-ts-profile-color-scheme"]).toBe("light");
    expect(Object.isFrozen(result.value.profile.colors)).toBe(true);
  });

  it("matches all Phase A Familiar and Minimal role values and preserves Tachiko parity elsewhere", () => {
    for (const [profileId, overrides] of Object.entries(approvedOverrides)) {
      const result = resolveBuiltInInterfaceProfile(profileId, "compact");
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const { profile } = result.value;
      for (const role of COLOR_ROLES) {
        const expected = role in overrides
          ? overrides[role as keyof typeof overrides]
          : TACHIKO_COMPACT_PORCELAIN_PROFILE.colors[role];
        expect(profile.colors[role], `${profileId}: ${role}`).toBe(expected);
      }
    }
  });

  it("preserves the original Tachiko compact recipe exactly and varies only density for the other combinations", () => {
    const tachiko = resolveBuiltInInterfaceProfile("tachiko", "compact");
    expect(tachiko.ok).toBe(true);
    if (tachiko.ok) expect(tachiko.value.profile).toEqual(TACHIKO_COMPACT_PORCELAIN_PROFILE);

    for (const profileId of BUILT_IN_INTERFACE_PROFILE_IDS) {
      const compact = resolveBuiltInInterfaceProfile(profileId, "compact");
      const comfortable = resolveBuiltInInterfaceProfile(profileId, "comfortable");
      expect(compact.ok).toBe(true);
      expect(comfortable.ok).toBe(true);
      if (!compact.ok || !comfortable.ok) continue;
      expect(comfortable.value.profile.colors).toEqual(compact.value.profile.colors);
      expect(comfortable.value.profile.name).toBe(compact.value.profile.name);
      expect(comfortable.value.profile.typography).toBe(compact.value.profile.typography);
      expect(comfortable.value.profile.chrome).toBe(compact.value.profile.chrome);
    }
  });

  it.each([
    ["custom", "compact", "profileId"],
    [{ schemaVersion: 1, name: "Tachiko" }, "compact", "profileId"],
    ["tachiko", "spacious", "density"],
    ["minimal-focus", null, "density"],
  ] as const)("rejects non-built-in resolver input %j / %j", (profileId, density, path) => {
    const result = resolveBuiltInInterfaceProfile(profileId, density);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.path === path)).toBe(true);
  });

  it("keeps the report canvas border fixed while ordinary controls follow profile borders", async () => {
    const css = await readFile(new URL("../sheet-shell.css", import.meta.url), "utf8");
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
    });
    try {
      const page = await browser.newPage();
      await page.setContent(`<style>${css}</style><button class="ts-button"></button><canvas class="ts-report-canvas"></canvas>`);
      const edges: Array<{ control: string; report: string }> = [];
      for (const profileId of BUILT_IN_INTERFACE_PROFILE_IDS) {
        const resolved = resolveBuiltInInterfaceProfile(profileId, "compact");
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) continue;
        await page.evaluate(({ variables, attributes }) => {
          const root = document.documentElement;
          for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
          for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value);
        }, resolved.value);
        edges.push(await page.evaluate(() => ({
          control: getComputedStyle(document.querySelector(".ts-button")!).borderTopColor,
          report: getComputedStyle(document.querySelector(".ts-report-canvas")!).borderTopColor,
        })));
      }
      expect(edges.map(({ control }) => control)).toEqual([
        "rgb(133, 139, 156)",
        "rgb(122, 132, 145)",
        "rgb(137, 135, 147)",
      ]);
      expect(edges.map(({ report }) => report)).toEqual([
        "rgb(133, 139, 156)",
        "rgb(133, 139, 156)",
        "rgb(133, 139, 156)",
      ]);
    } finally {
      await browser.close();
    }
  }, 15_000);
});
