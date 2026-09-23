import { describe, expect, it } from "vitest";
import {
  admitInterfaceProfileContrast,
  contrastRatio,
  relativeLuminance,
} from "./profile-safety.js";
import {
  BUILT_IN_INTERFACE_PROFILE_IDS,
  resolveBuiltInInterfaceProfile,
  type InterfaceProfileV1,
} from "./profile.js";

const builtIn = (id: (typeof BUILT_IN_INTERFACE_PROFILE_IDS)[number], density: "compact" | "comfortable") => {
  const resolved = resolveBuiltInInterfaceProfile(id, density);
  if (!resolved.ok) throw new Error(`Invalid built-in fixture: ${id}/${density}`);
  return resolved.value.profile;
};

const mutant = (
  profile: InterfaceProfileV1,
  changes: Partial<InterfaceProfileV1["colors"]>,
): InterfaceProfileV1 => ({ ...profile, colors: { ...profile.colors, ...changes } });

const matchingContext = (result: ReturnType<typeof admitInterfaceProfileContrast>, pattern: RegExp) => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected contrast admission to reject profile");
  return result.errors.filter((error) => "context" in error && pattern.test(error.context));
};

describe("interface profile contrast admission", () => {
  it("uses WCAG 2.1 sRGB relative luminance and contrast", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 12);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 12);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(relativeLuminance("white")).toBeUndefined();
  });

  it("admits all three built-ins at both supported densities as detached frozen manifests", () => {
    for (const id of BUILT_IN_INTERFACE_PROFILE_IDS) {
      for (const density of ["compact", "comfortable"] as const) {
        const source = builtIn(id, density);
        const result = admitInterfaceProfileContrast(source);
        expect(result, `${id}/${density}`).toMatchObject({ ok: true, kind: "contrast-admitted-manifest" });
        if (!result.ok) throw new Error(`${id}/${density}: ${result.errors.map((error) => error.message).join("; ")}`);
        expect(result.profile).not.toBe(source);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.profile)).toBe(true);
        expect(Object.isFrozen(result.profile.colors)).toBe(true);
        expect(result.profile).toEqual(source);
      }
    }
  });

  it("revalidates malformed input and safely reports uninspectable values", () => {
    const malformed = admitInterfaceProfileContrast({ schemaVersion: 1, colors: {} });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.errors.some((error) => error.context === "manifest")).toBe(true);

    const hostile = new Proxy({}, { ownKeys() { throw new Error("trap"); } });
    expect(admitInterfaceProfileContrast(hostile)).toMatchObject({
      ok: false,
      errors: [{ context: "manifest", path: "$" }],
    });
  });

  it("rejects low contrast for selected Appearance radios and Table selector text", () => {
    const base = builtIn("tachiko", "compact");
    const radio = admitInterfaceProfileContrast(mutant(base, {
      "action.primary.background": "#FFFFFF",
    }));
    expect(matchingContext(radio, /selected Appearance radio marker/).length).toBeGreaterThan(0);

    const table = admitInterfaceProfileContrast(mutant(base, {
      "text.primary": "#FFFFFF",
    }));
    expect(matchingContext(table, /Table selector text on selected header/).length).toBeGreaterThan(0);
  });

  it("rejects each primary fill state when its painted boundary disappears on a consumer surface", () => {
    const base = builtIn("tachiko", "compact");
    const primaryStates = [
      ["action.primary.background", "action.primary.background primary control boundary on content surface"],
      ["action.primary.hover", "action.primary.hover primary control boundary on content surface"],
      ["action.primary.pressed", "action.primary.pressed primary control boundary on content surface"],
    ] as const;
    for (const [role, context] of primaryStates) {
      const result = admitInterfaceProfileContrast(mutant(base, {
        [role]: "#FFFFFF",
        "surface.content": "#FFFFFF",
      }));
      expect(matchingContext(result, new RegExp(context.replaceAll(".", "\\.")))).toEqual(
        expect.arrayContaining([expect.objectContaining({ required: 3, ratio: 1 })]),
      );
    }

    // Mirrors Oracle's all-white content/header/action-fill counterexample;
    // every pre-existing pair passes: foreground roles are gray on white or
    // black, and the Appearance radio marker is white against black accent.
    const oracleManifest = mutant(base, {
      "surface.content": "#FFFFFF",
      "surface.chrome": "#FFFFFF",
      "surface.chrome.tint": "#FFFFFF",
      "surface.inset": "#FFFFFF",
      "grid.canvas": "#FFFFFF",
      "grid.header.background": "#FFFFFF",
      "selection.row.background": "#FFFFFF",
      "selection.active.background": "#FFFFFF",
      "text.primary": "#767676",
      "text.secondary": "#767676",
      "text.onTint": "#767676",
      "text.link": "#767676",
      "text.reference": "#767676",
      "action.primary.background": "#FFFFFF",
      "action.primary.hover": "#FFFFFF",
      "action.primary.pressed": "#FFFFFF",
      "action.primary.foreground": "#767676",
      "accent.foreground": "#767676",
      "accent.background": "#000000",
      "grid.header.foreground": "#767676",
      "selection.header.foreground": "#767676",
      "selection.header.background": "#000000",
      "border.control": "#767676",
      "selection.active.border": "#767676",
      "focus.ring": "#767676",
    });
    const oracleResult = admitInterfaceProfileContrast(oracleManifest);
    const contentBoundary = matchingContext(oracleResult, /primary control boundary on content surface/);
    const rowHeader = matchingContext(oracleResult, /selected row header state on grid header/);
    expect(contentBoundary.length).toBeGreaterThan(0);
    expect(rowHeader.length).toBeGreaterThan(0);
    expect(oracleResult.ok).toBe(false);
  });

  it("guards all primary fill states over Porcelain chrome and checks focused grid pairs", () => {
    const base = builtIn("tachiko", "compact");
    const gradient = admitInterfaceProfileContrast(mutant(base, {
      "action.primary.background": "#F8F8FC",
      "action.primary.hover": "#F8F8FC",
      "action.primary.pressed": "#F8F8FC",
      "surface.chrome.tint": "#F8F8FC",
      "surface.chrome": "#F8F8FC",
    }));
    for (const role of ["action.primary.background", "action.primary.hover", "action.primary.pressed"] as const) {
      expect(matchingContext(gradient, new RegExp(`Porcelain chrome gradient step \\d+/256: ${role.replaceAll(".", "\\.")} primary control boundary`)).length)
        .toBeGreaterThan(0);
    }

    const focus = admitInterfaceProfileContrast(mutant(base, { "focus.ring": "#FFFFFF", "grid.canvas": "#FFFFFF" }));
    expect(matchingContext(focus, /keyboard focus indicator against grid canvas/).length).toBeGreaterThan(0);
    const control = admitInterfaceProfileContrast(mutant(base, {
      "border.control": "#FFFFFF",
      "grid.canvas": "#FFFFFF",
      "selection.row.background": "#FFFFFF",
    }));
    expect(matchingContext(control, /essential control boundary against grid canvas/).length).toBeGreaterThan(0);
    expect(matchingContext(control, /essential control boundary against selected row/).length).toBeGreaterThan(0);
  });

  it("checks warning text on actual grid backgrounds and primary action hover/pressed states", () => {
    const base = builtIn("familiar-spreadsheet", "compact");
    const warning = admitInterfaceProfileContrast(mutant(base, { "grid.canvas": "#000000" }));
    expect(matchingContext(warning, /warning status text on grid canvas/).length).toBeGreaterThan(0);
    const rowWarning = admitInterfaceProfileContrast(mutant(base, { "selection.row.background": "#000000" }));
    expect(matchingContext(rowWarning, /warning status text on selected row/).length).toBeGreaterThan(0);
    const activeWarning = admitInterfaceProfileContrast(mutant(base, { "selection.active.background": "#000000" }));
    expect(matchingContext(activeWarning, /warning status text on active cell/).length).toBeGreaterThan(0);

    const hover = admitInterfaceProfileContrast(mutant(base, { "action.primary.hover": "#FFFFFF" }));
    expect(matchingContext(hover, /primary action text on action\.primary\.hover/).length).toBeGreaterThan(0);

    const pressed = admitInterfaceProfileContrast(mutant(base, { "action.primary.pressed": "#FFFFFF" }));
    expect(matchingContext(pressed, /primary action text on action\.primary\.pressed/).length).toBeGreaterThan(0);
  });

  it("rejects insufficient focus and active-cell boundary contrast", () => {
    const base = builtIn("minimal-focus", "comfortable");
    const focus = admitInterfaceProfileContrast(mutant(base, { "focus.ring": "#FFFFFF" }));
    expect(matchingContext(focus, /keyboard focus indicator against surface\.content/).length).toBeGreaterThan(0);

    const active = admitInterfaceProfileContrast(mutant(base, { "selection.active.border": "#FFFFFF" }));
    expect(matchingContext(active, /active cell border on grid canvas/).length).toBeGreaterThan(0);
  });

  it("samples Porcelain chrome gradient intermediates, not just its endpoints", () => {
    const base = builtIn("tachiko", "compact");
    const gradient = admitInterfaceProfileContrast(mutant(base, {
      "surface.chrome.tint": "#252735",
      "surface.chrome": "#252735",
    }));
    const failures = matchingContext(gradient, /Porcelain chrome gradient step/);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((error) => error.context.includes("step 1/256"))).toBe(true);
  });

  it("does not impose contrast on decorative grid lattice or subtle borders", () => {
    const base = builtIn("tachiko", "compact");
    const decorative = admitInterfaceProfileContrast(mutant(base, {
      "grid.line.horizontal": "#FFFFFF",
      "grid.line.vertical": "#FFFFFF",
      "border.subtle": "#FFFFFF",
    }));
    expect(decorative.ok).toBe(true);
  });
});
