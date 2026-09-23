/** UI-owned bindings and built-in recipes for Interface Profile v1. */
import {
  COLOR_ROLES,
  type ColorRoleV1,
  type HexColor,
  type TypographyV1,
  type DensityV1,
  type ChromeV1,
  type InterfaceProfileV1,
  type ProfileValidationError,
  validateInterfaceProfile,
} from "../../application/interface-profile-contract.js";

export {
  COLOR_ROLES,
  validateInterfaceProfile,
};
export type {
  ColorRoleV1,
  HexColor,
  TypographyV1,
  DensityV1,
  ChromeV1,
  InterfaceProfileV1,
  ProfileValidationError,
  ProfileValidationResult,
} from "../../application/interface-profile-contract.js";

/** Exact role-to-private-variable bindings for the root integration seam. */
export const PRIVATE_CSS_VARIABLES: Readonly<Record<ColorRoleV1, `--${string}`>> = Object.freeze({
  "surface.app": "--ts-profile-surface-app",
  "surface.chrome": "--ts-profile-surface-chrome",
  "surface.chrome.tint": "--ts-profile-surface-chrome-tint",
  "surface.content": "--ts-profile-surface-content",
  "surface.inset": "--ts-profile-surface-inset",
  "text.primary": "--ts-profile-text-primary",
  "text.secondary": "--ts-profile-text-secondary",
  "text.onTint": "--ts-profile-text-on-tint",
  "text.link": "--ts-profile-text-link",
  "text.reference": "--ts-profile-text-reference",
  "border.subtle": "--ts-profile-border-subtle",
  "border.control": "--ts-profile-border-control",
  "action.primary.background": "--ts-profile-action-primary-background",
  "action.primary.hover": "--ts-profile-action-primary-hover",
  "action.primary.pressed": "--ts-profile-action-primary-pressed",
  "action.primary.foreground": "--ts-profile-action-primary-foreground",
  "accent.foreground": "--ts-profile-accent-foreground",
  "accent.background": "--ts-profile-accent-background",
  "grid.canvas": "--ts-profile-grid-canvas",
  "grid.line.horizontal": "--ts-profile-grid-line-horizontal",
  "grid.line.vertical": "--ts-profile-grid-line-vertical",
  "grid.header.background": "--ts-profile-grid-header-background",
  "grid.header.foreground": "--ts-profile-grid-header-foreground",
  "selection.row.background": "--ts-profile-selection-row-background",
  "selection.header.background": "--ts-profile-selection-header-background",
  "selection.header.foreground": "--ts-profile-selection-header-foreground",
  "selection.active.background": "--ts-profile-selection-active-background",
  "selection.active.border": "--ts-profile-selection-active-border",
  "focus.ring": "--ts-profile-focus-ring",
});

const freezeProfile = (profile: {
  schemaVersion: 1;
  name: string;
  colorScheme: "light";
  typography: TypographyV1;
  density: DensityV1;
  chrome: ChromeV1;
  colors: Record<ColorRoleV1, HexColor>;
}): InterfaceProfileV1 =>
  Object.freeze({
    ...profile,
    colors: Object.freeze({ ...profile.colors }),
  });

const isHexColor = (value: unknown): value is HexColor =>
  typeof value === "string" && value.length === 7 && /^#[0-9a-fA-F]{6}$/.test(value);

export const TACHIKO_COMPACT_PORCELAIN_PROFILE: InterfaceProfileV1 = freezeProfile({
  schemaVersion: 1,
  name: "Tachiko",
  colorScheme: "light",
  typography: "tachiko-local",
  density: "compact",
  chrome: "porcelain",
  colors: {
    "surface.app": "#FFFFFF",
    "surface.chrome": "#F8F8FC",
    "surface.chrome.tint": "#F0EDFD",
    "surface.content": "#FFFFFF",
    "surface.inset": "#F5F6F9",
    "text.primary": "#252735",
    "text.secondary": "#646879",
    "text.onTint": "#5B6072",
    "text.link": "#5542B5",
    "text.reference": "#4F54AD",
    "border.subtle": "#DFE2EA",
    "border.control": "#858B9C",
    "action.primary.background": "#6350D2",
    "action.primary.hover": "#5541C2",
    "action.primary.pressed": "#4936AB",
    "action.primary.foreground": "#FFFFFF",
    "accent.foreground": "#5542B5",
    "accent.background": "#F0EDFD",
    "grid.canvas": "#FFFFFF",
    "grid.line.horizontal": "#E9EBF1",
    "grid.line.vertical": "#EEF0F4",
    "grid.header.background": "#F7F8FB",
    "grid.header.foreground": "#5B6072",
    "selection.row.background": "#F6F4FE",
    "selection.header.background": "#ECE9FE",
    "selection.header.foreground": "#5542B5",
    "selection.active.background": "#FFFFFF",
    "selection.active.border": "#6551CE",
    "focus.ring": "#6551CE",
  },
});

export type BuiltInInterfaceProfileId = "tachiko" | "familiar-spreadsheet" | "minimal-focus";
export const BUILT_IN_INTERFACE_PROFILE_IDS: readonly BuiltInInterfaceProfileId[] = Object.freeze([
  "tachiko",
  "familiar-spreadsheet",
  "minimal-focus",
]);

const FAMILIAR_SPREADSHEET_COLORS: Record<ColorRoleV1, HexColor> = {
  ...TACHIKO_COMPACT_PORCELAIN_PROFILE.colors,
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
};

const MINIMAL_FOCUS_COLORS: Record<ColorRoleV1, HexColor> = {
  ...TACHIKO_COMPACT_PORCELAIN_PROFILE.colors,
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
};

const BUILT_IN_PROFILE_TEMPLATES: Readonly<Record<BuiltInInterfaceProfileId, InterfaceProfileV1>> = Object.freeze({
  tachiko: TACHIKO_COMPACT_PORCELAIN_PROFILE,
  "familiar-spreadsheet": freezeProfile({
    schemaVersion: 1,
    name: "Familiar Spreadsheet",
    colorScheme: "light",
    typography: "system-local",
    density: "compact",
    chrome: "structured",
    colors: FAMILIAR_SPREADSHEET_COLORS,
  }),
  "minimal-focus": freezeProfile({
    schemaVersion: 1,
    name: "Minimal-Focus",
    colorScheme: "light",
    typography: "tachiko-local",
    density: "compact",
    chrome: "quiet",
    colors: MINIMAL_FOCUS_COLORS,
  }),
});

export type ResolvedInterfaceProfile = Readonly<{
  profile: InterfaceProfileV1;
  variables: Readonly<Record<`--${string}`, HexColor>>;
  attributes: Readonly<{
    "data-ts-profile-color-scheme": "light";
    "data-ts-profile-typography": TypographyV1;
    "data-ts-profile-density": DensityV1;
    "data-ts-profile-chrome": ChromeV1;
  }>;
}>;

export type ProfileResolutionResult =
  | Readonly<{ ok: true; value: ResolvedInterfaceProfile }>
  | Readonly<{ ok: false; errors: readonly ProfileValidationError[] }>;

const resolvedProfiles = new WeakSet<object>();

/** Validate first, then build a detached exhaustive private binding set. */
export function resolveInterfaceProfile(input: unknown): ProfileResolutionResult {
  const validation = validateInterfaceProfile(input);
  if (!validation.ok) return validation;

  const variables = {} as Record<`--${string}`, HexColor>;
  for (const role of COLOR_ROLES) {
    const variable = PRIVATE_CSS_VARIABLES[role];
    variables[variable] = validation.value.colors[role];
  }
  const resolved = Object.freeze({
    profile: validation.value,
    variables: Object.freeze(variables),
    attributes: Object.freeze({
      "data-ts-profile-color-scheme": validation.value.colorScheme,
      "data-ts-profile-typography": validation.value.typography,
      "data-ts-profile-density": validation.value.density,
      "data-ts-profile-chrome": validation.value.chrome,
    }),
  });
  resolvedProfiles.add(resolved);
  return { ok: true, value: resolved };
}

/**
 * Resolve one of the three application-owned recipes at one of two fixed
 * densities. This is the supported UI entry point; it accepts no caller-built
 * profile object or custom profile identifier.
 */
export function resolveBuiltInInterfaceProfile(
  profileId: unknown,
  density: unknown,
): ProfileResolutionResult {
  const errors: ProfileValidationError[] = [];
  if (!(BUILT_IN_INTERFACE_PROFILE_IDS as readonly unknown[]).includes(profileId)) {
    errors.push({ path: "profileId", message: `must be one of: ${BUILT_IN_INTERFACE_PROFILE_IDS.join(", ")}` });
  }
  if (density !== "compact" && density !== "comfortable") {
    errors.push({ path: "density", message: "must be one of: compact, comfortable" });
  }
  if (errors.length > 0) return { ok: false, errors: Object.freeze(errors) };

  const template = BUILT_IN_PROFILE_TEMPLATES[profileId as BuiltInInterfaceProfileId];
  return resolveInterfaceProfile(freezeProfile({
    ...template,
    density: density as DensityV1,
    colors: { ...template.colors },
  }));
}

const isStyleTarget = (target: unknown): target is { style: { setProperty(name: string, value: string): void } } =>
  typeof target === "object" && target !== null &&
  typeof (target as { style?: { setProperty?: unknown } }).style?.setProperty === "function";

/** Apply only the fixed output keys from a resolver-produced profile. */
export function applyResolvedProfile(target: HTMLElement, resolved: unknown): boolean {
  if (!isStyleTarget(target) || typeof resolved !== "object" || resolved === null || !resolvedProfiles.has(resolved)) return false;
  const resolvedRecord = resolved as Record<string, unknown>;
  const variables = resolvedRecord.variables as Record<string, unknown>;
  const attributes = resolvedRecord.attributes as Record<string, unknown>;
  if (typeof variables !== "object" || variables === null ||
      typeof attributes !== "object" || attributes === null || typeof target.setAttribute !== "function") return false;

  for (const role of COLOR_ROLES) {
    const variable = PRIVATE_CSS_VARIABLES[role];
    const value = variables[variable];
    if (!isHexColor(value)) return false;
    target.style.setProperty(variable, value);
  }
  target.setAttribute("data-ts-profile-color-scheme", attributes["data-ts-profile-color-scheme"] as string);
  target.setAttribute("data-ts-profile-typography", attributes["data-ts-profile-typography"] as string);
  target.setAttribute("data-ts-profile-density", attributes["data-ts-profile-density"] as string);
  target.setAttribute("data-ts-profile-chrome", attributes["data-ts-profile-chrome"] as string);
  return true;
}
