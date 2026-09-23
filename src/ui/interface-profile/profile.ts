/**
 * Closed, application-owned appearance boundary for Interface Profile v1.
 *
 * This module deliberately has no React, workbook, persistence, network, or
 * stylesheet imports. The CSS variable names below are private migration
 * aliases; public callers only use the semantic role identifiers.
 */

export const COLOR_ROLES = Object.freeze([
  "surface.app",
  "surface.chrome",
  "surface.chrome.tint",
  "surface.content",
  "surface.inset",
  "text.primary",
  "text.secondary",
  "text.onTint",
  "text.link",
  "text.reference",
  "border.subtle",
  "border.control",
  "action.primary.background",
  "action.primary.hover",
  "action.primary.pressed",
  "action.primary.foreground",
  "accent.foreground",
  "accent.background",
  "grid.canvas",
  "grid.line.horizontal",
  "grid.line.vertical",
  "grid.header.background",
  "grid.header.foreground",
  "selection.row.background",
  "selection.header.background",
  "selection.header.foreground",
  "selection.active.background",
  "selection.active.border",
  "focus.ring",
] as const);

export type ColorRoleV1 = (typeof COLOR_ROLES)[number];
export type HexColor = `#${string}`;
export type TypographyV1 = "tachiko-local" | "system-local";
export type DensityV1 = "compact" | "comfortable";
export type ChromeV1 = "porcelain" | "structured" | "quiet";

export type InterfaceProfileV1 = Readonly<{
  schemaVersion: 1;
  name: string;
  colorScheme: "light";
  typography: TypographyV1;
  density: DensityV1;
  chrome: ChromeV1;
  colors: Readonly<Record<ColorRoleV1, HexColor>>;
}>;

export type ProfileValidationError = Readonly<{
  path: string;
  message: string;
}>;

export type ProfileValidationResult =
  | Readonly<{ ok: true; value: InterfaceProfileV1 }>
  | Readonly<{ ok: false; errors: readonly ProfileValidationError[] }>;

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

const PROFILE_KEYS = [
  "schemaVersion",
  "name",
  "colorScheme",
  "typography",
  "density",
  "chrome",
  "colors",
] as const;

const ENUMS = {
  colorScheme: ["light"],
  typography: ["tachiko-local", "system-local"],
  density: ["compact", "comfortable"],
  chrome: ["porcelain", "structured", "quiet"],
} as const;

type DataRecord = Record<string, unknown>;

const isPlainRecord = (value: unknown): value is Record<PropertyKey, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isHexColor = (value: unknown): value is HexColor =>
  typeof value === "string" && value.length === 7 && /^#[0-9a-fA-F]{6}$/.test(value);

const readDataRecord = (
  value: unknown,
  allowed: readonly string[],
  path: string,
  errors: ProfileValidationError[],
): DataRecord | undefined => {
  if (!isPlainRecord(value)) {
    errors.push({ path, message: "must be an ordinary object or null-prototype data record" });
    return undefined;
  }
  const captured = Object.create(null) as DataRecord;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      errors.push({ path: typeof key === "string" ? `${path}.${key}` : `${path}.[symbol]`, message: "unknown field" });
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      errors.push({ path: `${path}.${key}`, message: "accessor properties are not allowed" });
      continue;
    }
    captured[key] = descriptor.value;
  }
  return captured;
};

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

/** Validate and detach an untrusted manifest. Invalid input has no fallback value. */
export function validateInterfaceProfile(input: unknown): ProfileValidationResult {
  const errors: ProfileValidationError[] = [];
  const profile = readDataRecord(input, PROFILE_KEYS, "$", errors);
  for (const key of PROFILE_KEYS) {
    if (!profile || !Object.prototype.hasOwnProperty.call(profile, key)) {
      errors.push({ path: key, message: "required profile field is missing" });
    }
  }

  if (profile?.schemaVersion !== 1) {
    errors.push({ path: "schemaVersion", message: "must be the number 1" });
  }
  if (typeof profile?.name !== "string") {
    errors.push({ path: "name", message: "must be a string" });
  }
  for (const key of ["colorScheme", "typography", "density", "chrome"] as const) {
    if (!(ENUMS[key] as readonly unknown[]).includes(profile?.[key])) {
      errors.push({ path: key, message: `must be one of: ${ENUMS[key].join(", ")}` });
    }
  }

  const colors = readDataRecord(profile?.colors, COLOR_ROLES, "colors", errors);
  if (colors) {
    for (const role of COLOR_ROLES) {
      if (!Object.prototype.hasOwnProperty.call(colors, role)) {
        errors.push({ path: `colors.${role}`, message: "required color role is missing" });
      } else if (!isHexColor(colors[role])) {
        errors.push({ path: `colors.${role}`, message: "must be a six-digit #RRGGBB color" });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors: Object.freeze(errors) };

  const detachedColors = {} as Record<ColorRoleV1, HexColor>;
  for (const role of COLOR_ROLES) detachedColors[role] = colors![role] as HexColor;
  return {
    ok: true,
    value: freezeProfile({
      schemaVersion: 1,
      name: profile!.name as string,
      colorScheme: "light",
      typography: profile!.typography as TypographyV1,
      density: profile!.density as DensityV1,
      chrome: profile!.chrome as ChromeV1,
      colors: detachedColors,
    }),
  };
}

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
