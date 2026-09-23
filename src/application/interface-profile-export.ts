/** Pure deterministic encoder for an admitted Interface Profile v1 export. */
import { admitInterfaceProfileContrast } from "./interface-profile-safety.js";
import { INTERFACE_PROFILE_JSON_MAX_BYTES } from "./interface-profile-package.js";
import {
  COLOR_ROLES,
  type ColorRoleV1,
  type InterfaceProfileV1,
} from "./interface-profile-contract.js";

export const INTERFACE_PROFILE_EXPORT_MAX_BYTES = INTERFACE_PROFILE_JSON_MAX_BYTES;
export const INTERFACE_PROFILE_SUGGESTED_FILENAME = "appearance.tachiko-profile.json";

export type ProfileExportError = Readonly<{
  context: string;
  path?: string;
  message: string;
}>;

export type ProfileExportResult =
  | Readonly<{
      ok: true;
      kind: "encoded-profile-export";
      filename: typeof INTERFACE_PROFILE_SUGGESTED_FILENAME;
      bytes: Uint8Array;
    }>
  | Readonly<{ ok: false; errors: readonly ProfileExportError[] }>;

/**
 * Revalidate and contrast-admit input, then encode only a fresh closed v1
 * object. This function returns bytes and a fixed suggested name; it never
 * downloads or otherwise performs a file effect.
 */
export function encodeInterfaceProfileExport(input: unknown): ProfileExportResult {
  const admission = admitInterfaceProfileContrast(input);
  if (!admission.ok) {
    return Object.freeze({
      ok: false,
      errors: Object.freeze(admission.errors.map((error) => Object.freeze({
        context: "context" in error ? error.context : "manifest",
        ...("path" in error ? { path: error.path } : {}),
        message: error.message,
      }))),
    });
  }

  const profile = admission.profile;
  const colors = {} as Record<ColorRoleV1, string>;
  for (const role of COLOR_ROLES) colors[role] = profile.colors[role].toUpperCase();

  const manifest: InterfaceProfileV1 = Object.freeze({
    schemaVersion: 1,
    name: profile.name,
    colorScheme: profile.colorScheme,
    typography: profile.typography,
    density: profile.density,
    chrome: profile.chrome,
    colors: Object.freeze(colors) as InterfaceProfileV1["colors"],
  });
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > INTERFACE_PROFILE_EXPORT_MAX_BYTES) {
    return Object.freeze({
      ok: false,
      errors: Object.freeze([Object.freeze({
        context: "export",
        message: `encoded package exceeds the ${INTERFACE_PROFILE_EXPORT_MAX_BYTES}-byte limit`,
      })]),
    });
  }

  return Object.freeze({
    ok: true,
    kind: "encoded-profile-export",
    filename: INTERFACE_PROFILE_SUGGESTED_FILENAME,
    bytes,
  });
}
