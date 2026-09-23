/** Pure structural parsing for an Interface Profile v1 JSON package. */
import {
  validateInterfaceProfile,
  type InterfaceProfileV1,
  type ProfileValidationError,
} from "./interface-profile-contract.js";
import { validateStrictJson } from "./strict-json.js";

export const INTERFACE_PROFILE_JSON_MAX_BYTES = 32_768;

/** A parsed closed manifest is structural input only; safety admission is a separate boundary. */
export type ProfilePackageParseResult =
  | Readonly<{ ok: true; kind: "parsed-manifest"; manifest: InterfaceProfileV1 }>
  | Readonly<{ ok: false; errors: readonly ProfileValidationError[] }>;

function failure(message: string): ProfilePackageParseResult {
  return {
    ok: false,
    errors: Object.freeze([Object.freeze({ path: "$", message })]),
  };
}

/** Parse bytes into a detached closed manifest, without safety admission or application. */
export function parseInterfaceProfileJsonBytes(bytes: Uint8Array): ProfilePackageParseResult {
  if (!(bytes instanceof Uint8Array)) return failure("package input must be a Uint8Array");
  if (bytes.byteLength > INTERFACE_PROFILE_JSON_MAX_BYTES) {
    return failure(`package exceeds the ${INTERFACE_PROFILE_JSON_MAX_BYTES}-byte limit`);
  }

  let jsonText: string;
  try {
    jsonText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return failure("package is not valid UTF-8");
  }
  if (jsonText.startsWith("\uFEFF")) jsonText = jsonText.slice(1);

  try {
    validateStrictJson(jsonText);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "invalid JSON structure");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return failure("package is not valid JSON");
  }
  const validation = validateInterfaceProfile(parsed);
  if (!validation.ok) return validation;
  return Object.freeze({ ok: true, kind: "parsed-manifest", manifest: validation.value });
}
