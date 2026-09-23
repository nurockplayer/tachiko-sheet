/**
 * Pure contrast admission for detached Interface Profile v1 manifests.
 *
 * A successful result only says that the known semantic color consumers meet
 * their contrast floors. It is not a resolver result and has no DOM,
 * persistence, or application effect. Browser evidence must still qualify the
 * painted CSS, especially the sampled chrome gradient.
 */
import {
  validateInterfaceProfile,
  type ColorRoleV1,
  type InterfaceProfileV1,
} from "./profile.js";

export type ProfileSafetyError = Readonly<{
  context: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  message: string;
}>;

export type ProfileSafetyValidationError = Readonly<{
  context: "manifest";
  path: string;
  message: string;
}>;

export type ProfileSafetyResult =
  | Readonly<{ ok: true; kind: "contrast-admitted-manifest"; profile: InterfaceProfileV1 }>
  | Readonly<{ ok: false; errors: readonly (ProfileSafetyError | ProfileSafetyValidationError)[] }>;

const TEXT_ROLES = [
  "text.primary",
  "text.secondary",
  "text.onTint",
  "text.link",
  "text.reference",
] as const satisfies readonly ColorRoleV1[];

const TEXT_SURFACES = [
  "surface.content",
  "surface.chrome",
  "surface.chrome.tint",
  "surface.inset",
  "selection.row.background",
] as const satisfies readonly ColorRoleV1[];

const CONTROL_SURFACES = [
  "surface.content",
  "surface.chrome",
  "surface.inset",
] as const satisfies readonly ColorRoleV1[];

const INDICATOR_SURFACES = [
  "surface.content",
  "surface.chrome",
  "surface.inset",
  "selection.row.background",
  "selection.header.background",
] as const satisfies readonly ColorRoleV1[];

const textPair = (foreground: ColorRoleV1, background: ColorRoleV1, context: string) => ({
  foreground,
  background,
  context,
  required: 4.5 as const,
});

const indicatorPair = (foreground: ColorRoleV1, background: ColorRoleV1, context: string) => ({
  foreground,
  background,
  context,
  required: 3 as const,
});

/** WCAG 2.1 relative luminance for an sRGB #RRGGBB color. */
export function relativeLuminance(hex: string): number | undefined {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export function contrastRatio(foreground: string, background: string): number | undefined {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === undefined || backgroundLuminance === undefined) return undefined;
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

type Pair = Readonly<{
  foreground: ColorRoleV1;
  background: ColorRoleV1;
  context: string;
  required: 3 | 4.5;
}>;

const APPROVED_PAIRS: readonly Pair[] = Object.freeze([
  ...TEXT_ROLES.flatMap((foreground) => TEXT_SURFACES.map((background) =>
    textPair(foreground, background, `${foreground} text on ${background}`),
  )),
  ...([
    "action.primary.background",
    "action.primary.hover",
    "action.primary.pressed",
  ] as const).map((background) =>
    textPair("action.primary.foreground", background, `primary action text on ${background}`),
  ),
  textPair("grid.header.foreground", "grid.header.background", "grid column header text"),
  textPair("selection.header.foreground", "selection.header.background", "selected row header text"),
  textPair("accent.foreground", "accent.background", "accent label text"),
  ...INDICATOR_SURFACES.map((background) =>
    indicatorPair("focus.ring", background, `keyboard focus indicator against ${background}`),
  ),
  ...CONTROL_SURFACES.map((background) =>
    indicatorPair("border.control", background, `essential control boundary against ${background}`),
  ),
  ...INDICATOR_SURFACES.map((background) =>
    indicatorPair("selection.active.border", background, `active cell boundary against ${background}`),
  ),
]);

// Only named rendered consumers are admitted. Subtle separators and grid
// lattice lines are decorative and intentionally have no contrast floor.
const EXTRA_ACTUAL_USE_PAIRS: readonly Pair[] = Object.freeze([
  textPair("text.primary", "selection.header.background", "Table selector text on selected header"),
  textPair("text.primary", "grid.canvas", "grid cell text on grid canvas"),
  textPair("text.primary", "selection.active.background", "selected editor text on active cell"),
  textPair("text.primary", "accent.background", "selected Appearance option label"),
  textPair("accent.foreground", "surface.content", "accent label on content surface"),
  textPair("text.secondary", "grid.canvas", "secondary grid text on grid canvas"),
  textPair("text.secondary", "selection.active.background", "secondary selected editor text"),
  textPair("text.reference", "grid.canvas", "reference grid text on grid canvas"),
  textPair("text.reference", "selection.active.background", "reference selected editor text"),
  indicatorPair("action.primary.background", "accent.background", "selected Appearance radio marker"),
  indicatorPair("selection.active.border", "grid.canvas", "active cell border on grid canvas"),
  indicatorPair("selection.active.border", "selection.active.background", "active cell border on selected editor"),
  indicatorPair("focus.ring", "accent.background", "Appearance keyboard focus against selected option"),
  indicatorPair("focus.ring", "selection.active.background", "keyboard focus against active cell"),
]);

const FIXED_STATUS_PAIRS = Object.freeze([
  { foreground: "#A02D42", background: "#FFF0F3", context: "protected error status pair" },
  { foreground: "#865015", background: "#FFF3DD", context: "protected warning status pair" },
  { foreground: "#206C4E", background: "#E9F6F0", context: "protected success status pair" },
] as const);

const FIXED_WARNING_ACTUAL_USE = Object.freeze([
  { background: "grid.canvas", context: "warning status text on grid canvas" },
  { background: "selection.row.background", context: "warning status text on selected row" },
  { background: "selection.active.background", context: "warning status text on active cell" },
] as const satisfies readonly { background: ColorRoleV1; context: string }[]);

const ratioError = (
  context: string,
  foreground: string,
  background: string,
  required: number,
): ProfileSafetyError | undefined => {
  const ratio = contrastRatio(foreground, background);
  if (ratio === undefined || ratio + 1e-10 >= required) return undefined;
  return Object.freeze({
    context,
    foreground,
    background,
    ratio,
    required,
    message: `${context} has ${ratio.toFixed(2)}:1 contrast; requires at least ${required}:1`,
  });
};

const interpolateSrgb = (from: string, to: string, amount: number): string => {
  const channel = (color: string, offset: number) => Number.parseInt(color.slice(offset, offset + 2), 16);
  const values = [1, 3, 5].map((offset) => Math.round(channel(from, offset) * (1 - amount) + channel(to, offset) * amount));
  return `#${values.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
};

/** Revalidate, detach, and contrast-check a profile at known rendered uses. */
export function admitInterfaceProfileContrast(input: unknown): ProfileSafetyResult {
  let validation: ReturnType<typeof validateInterfaceProfile>;
  try {
    validation = validateInterfaceProfile(input);
  } catch {
    return Object.freeze({
      ok: false,
      errors: Object.freeze([Object.freeze({
        context: "manifest" as const,
        path: "$",
        message: "profile could not be safely inspected",
      })]),
    });
  }
  if (!validation.ok) {
    return Object.freeze({
      ok: false,
      errors: Object.freeze(validation.errors.map((error) => Object.freeze({
        context: "manifest" as const,
        path: error.path,
        message: error.message,
      }))),
    });
  }

  const profile = validation.value;
  const colors = profile.colors;
  const errors: ProfileSafetyError[] = [];
  const check = (context: string, foreground: string, background: string, required: number) => {
    const error = ratioError(context, foreground, background, required);
    if (error) errors.push(error);
  };

  for (const pair of [...APPROVED_PAIRS, ...EXTRA_ACTUAL_USE_PAIRS]) {
    check(pair.context, colors[pair.foreground], colors[pair.background], pair.required);
  }
  for (const pair of FIXED_STATUS_PAIRS) check(pair.context, pair.foreground, pair.background, 4.5);
  for (const pair of FIXED_WARNING_ACTUAL_USE) {
    check(pair.context, "#865015", colors[pair.background], 4.5);
  }

  // Porcelain uses a CSS gradient from chrome.tint to chrome. Sampling 257
  // sRGB points catches contrast loss inside the actual-use interval; the
  // final browser evidence must still qualify the painted CSS gradient.
  if (profile.chrome === "porcelain") {
    for (let step = 0; step <= 256; step += 1) {
      const background = interpolateSrgb(colors["surface.chrome.tint"], colors["surface.chrome"], step / 256);
      for (const foreground of TEXT_ROLES) {
        check(
          `Porcelain chrome gradient step ${step}/256: ${foreground} text`,
          colors[foreground],
          background,
          4.5,
        );
      }
    }
  }

  if (errors.length > 0) return Object.freeze({ ok: false, errors: Object.freeze(errors) });
  return Object.freeze({ ok: true, kind: "contrast-admitted-manifest", profile });
}
