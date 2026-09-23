/**
 * Closed application-owned Interface Profile v1 contract.
 * This module has no UI, DOM, workbook, persistence, or network dependency.
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
  } else {
    let scalarCount = 0;
    let invalidName = false;
    for (let index = 0; index < profile.name.length;) {
      const first = profile.name.charCodeAt(index);
      let codePoint = first;
      let units = 1;
      if (first >= 0xd800 && first <= 0xdbff) {
        const second = profile.name.charCodeAt(index + 1);
        if (!(second >= 0xdc00 && second <= 0xdfff)) {
          invalidName = true;
          break;
        }
        codePoint = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
        units = 2;
      } else if (first >= 0xdc00 && first <= 0xdfff) {
        invalidName = true;
        break;
      }
      if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) invalidName = true;
      scalarCount += 1;
      index += units;
    }
    if (invalidName || scalarCount < 1 || scalarCount > 80) {
      errors.push({ path: "name", message: "must contain 1 to 80 Unicode scalar values and no control characters" });
    }
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
