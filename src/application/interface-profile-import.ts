/** Pure import staging: parse an interchange package, then admit its rendered color uses. */
import {
  INTERFACE_PROFILE_JSON_MAX_BYTES,
  parseInterfaceProfileJsonBytes,
  type ProfilePackageParseResult,
} from "./interface-profile-package.js";
import {
  admitInterfaceProfileContrast,
  type ProfileSafetyError,
  type ProfileSafetyValidationError,
} from "./interface-profile-safety.js";
import type { InterfaceProfileV1, ProfileValidationError } from "./interface-profile-contract.js";

export const INTERFACE_PROFILE_IMPORT_MAX_BYTES = INTERFACE_PROFILE_JSON_MAX_BYTES;

export type InterfaceProfileImportError = Readonly<{
  stage: "parse";
  path: string;
  message: string;
}> | Readonly<{
  stage: "safety";
  context: string;
  path?: string;
  foreground?: string;
  background?: string;
  ratio?: number;
  required?: number;
  message: string;
}>;

export type InterfaceProfileImportResult =
  | Readonly<{
      ok: true;
      kind: "staged-candidate";
      profile: InterfaceProfileV1;
    }>
  | Readonly<{
      ok: false;
      errors: readonly InterfaceProfileImportError[];
    }>;

const parseErrors = (result: Extract<ProfilePackageParseResult, { ok: false }>): readonly InterfaceProfileImportError[] =>
  Object.freeze(result.errors.map((error: ProfileValidationError) => Object.freeze({
    stage: "parse" as const,
    path: error.path,
    message: error.message,
  })));

/**
 * Parse bounded JSON bytes before running full contrast admission. A successful
 * result is a detached staged candidate only; it has no selection, persistence,
 * DOM, file, download, or workbook effect.
 */
export function stageInterfaceProfileImport(bytes: Uint8Array): InterfaceProfileImportResult {
  const parsed = parseInterfaceProfileJsonBytes(bytes);
  if (!parsed.ok) return Object.freeze({ ok: false, errors: parseErrors(parsed) });

  const admitted = admitInterfaceProfileContrast(parsed.manifest);
  if (!admitted.ok) {
    const errors = admitted.errors.map((error: ProfileSafetyError | ProfileSafetyValidationError) => {
      if ("path" in error) {
        return Object.freeze({
          stage: "safety" as const,
          context: error.context,
          path: error.path,
          message: error.message,
        });
      }
      return Object.freeze({
        stage: "safety" as const,
        context: error.context,
        foreground: error.foreground,
        background: error.background,
        ratio: error.ratio,
        required: error.required,
        message: error.message,
      });
    });
    return Object.freeze({ ok: false, errors: Object.freeze(errors) });
  }

  return Object.freeze({
    ok: true,
    kind: "staged-candidate",
    profile: admitted.profile,
  });
}
