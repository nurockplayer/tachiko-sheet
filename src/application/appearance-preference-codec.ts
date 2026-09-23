/** Pure codecs for the private application preference and its legacy v1 form. */
import {
  APPEARANCE_PROFILE_IDS,
  type AppearanceDensity,
  type AppearanceProfileId,
  type AppearanceSelection,
} from "./appearance-preference.js";
import { admitInterfaceProfileContrast } from "../ui/interface-profile/profile-safety.js";
import {
  COLOR_ROLES,
  type ColorRoleV1,
  type InterfaceProfileV1,
} from "../ui/interface-profile/profile.js";

export const APPEARANCE_PREFERENCE_V2_SCHEMA_VERSION = 2 as const;
export const APPEARANCE_PREFERENCE_MAX_BYTES = 32_768;

export type BuiltInAppearancePreferenceV2 = Readonly<{
  schemaVersion: 2;
  kind: "built-in";
  profileId: AppearanceProfileId;
  density: AppearanceDensity;
}>;

export type ImportedAppearancePreferenceV2 = Readonly<{
  schemaVersion: 2;
  kind: "imported";
  profile: InterfaceProfileV1;
}>;

export type AdmittedAppearancePreferenceV2 = BuiltInAppearancePreferenceV2 | ImportedAppearancePreferenceV2;

export type AppearancePreferenceCodecErrorCode =
  | "invalid-input"
  | "too-large"
  | "invalid-json"
  | "invalid-record"
  | "invalid-profile"
  | "unknown-field"
  | "missing-field"
  | "unsupported-version"
  | "unsupported-kind"
  | "unsupported-profile"
  | "unsupported-density"
  | "unsafe-profile";

export type AppearancePreferenceCodecError = Readonly<{
  code: AppearancePreferenceCodecErrorCode;
  path: string;
  context?: string;
  message: string;
}>;

export type AppearancePreferenceCodecResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; errors: readonly AppearancePreferenceCodecError[] }>;

export type EncodedAppearancePreferenceV2 = Readonly<{
  raw: string;
  preference: AdmittedAppearancePreferenceV2;
}>;

/** Count UTF-8 bytes without allocating for an attacker-sized stored string. */
function exceedsUtf8ByteLimit(value: string, limit: number): boolean {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first <= 0x7f) bytes += 1;
    else if (first <= 0x7ff) bytes += 2;
    else if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > limit) return true;
  }
  return false;
}

function fail<T = never>(
  code: AppearancePreferenceCodecErrorCode,
  path: string,
  message: string,
  context?: string,
): AppearancePreferenceCodecResult<T> {
  return Object.freeze({
    ok: false,
    errors: Object.freeze([Object.freeze({ code, path, ...(context ? { context } : {}), message })]),
  });
}

/** Duplicate-aware bounded JSON syntax scan used before JSON.parse. */
class StoredJsonScanner {
  private index = 0;

  constructor(private readonly source: string) {}

  validate(): void {
    this.whitespace();
    this.value(0);
    this.whitespace();
    if (this.index !== this.source.length) this.invalid("trailing data after the JSON value");
  }

  private invalid(message: string): never {
    throw new SyntaxError(`${message} at character ${this.index}`);
  }

  private whitespace(): void {
    while (/^[\x20\x09\x0a\x0d]$/.test(this.source[this.index] ?? "")) this.index += 1;
  }

  private value(depth: number): void {
    if (depth > 64) this.invalid("JSON nesting limit exceeded");
    const next = this.source[this.index];
    if (next === "{") this.object(depth + 1);
    else if (next === "[") this.array(depth + 1);
    else if (next === '"') this.string();
    else if (next === "t") this.literal("true");
    else if (next === "f") this.literal("false");
    else if (next === "n") this.literal("null");
    else if (next === "-" || (next !== undefined && next >= "0" && next <= "9")) this.number();
    else this.invalid("expected a JSON value");
  }

  private object(depth: number): void {
    this.index += 1;
    this.whitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return;
    }
    const keys = new Set<string>();
    while (true) {
      if (this.source[this.index] !== '"') this.invalid("expected an object key");
      const key = this.string();
      if (keys.has(key)) this.invalid(`duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      this.whitespace();
      if (this.source[this.index] !== ":") this.invalid("expected ':' after object key");
      this.index += 1;
      this.whitespace();
      this.value(depth);
      this.whitespace();
      const delimiter = this.source[this.index];
      if (delimiter === "}") {
        this.index += 1;
        return;
      }
      if (delimiter !== ",") this.invalid("expected ',' or '}' after object value");
      this.index += 1;
      this.whitespace();
    }
  }

  private array(depth: number): void {
    this.index += 1;
    this.whitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return;
    }
    while (true) {
      this.value(depth);
      this.whitespace();
      const delimiter = this.source[this.index];
      if (delimiter === "]") {
        this.index += 1;
        return;
      }
      if (delimiter !== ",") this.invalid("expected ',' or ']' after array value");
      this.index += 1;
      this.whitespace();
    }
  }

  private string(): string {
    const start = this.index++;
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (code === 0x22) {
        this.index += 1;
        return JSON.parse(this.source.slice(start, this.index)) as string;
      }
      if (code <= 0x1f) this.invalid("unescaped control character in JSON string");
      if (code !== 0x5c) {
        this.index += 1;
        continue;
      }
      this.index += 1;
      const escaped = this.source[this.index];
      if (escaped === "u") {
        if (!/^[\da-fA-F]{4}$/.test(this.source.slice(this.index + 1, this.index + 5))) {
          this.invalid("invalid Unicode escape");
        }
        this.index += 5;
      } else if (escaped === '"' || escaped === "\\" || escaped === "/" || "bfnrt".includes(escaped ?? "")) {
        this.index += 1;
      } else {
        this.invalid("invalid JSON string escape");
      }
    }
    this.invalid("unterminated JSON string");
  }

  private literal(expected: "true" | "false" | "null"): void {
    if (this.source.slice(this.index, this.index + expected.length) !== expected) this.invalid("invalid JSON literal");
    this.index += expected.length;
  }

  private number(): void {
    if (this.source[this.index] === "-") this.index += 1;
    const first = this.source[this.index];
    if (first === "0") this.index += 1;
    else if (first !== undefined && first >= "1" && first <= "9") {
      this.index += 1;
      while (this.digit(this.source[this.index])) this.index += 1;
    } else this.invalid("invalid JSON number");
    if (this.source[this.index] === ".") {
      this.index += 1;
      if (!this.digit(this.source[this.index])) this.invalid("fraction requires digits");
      while (this.digit(this.source[this.index])) this.index += 1;
    }
    if (this.source[this.index] === "e" || this.source[this.index] === "E") {
      this.index += 1;
      if (this.source[this.index] === "+" || this.source[this.index] === "-") this.index += 1;
      if (!this.digit(this.source[this.index])) this.invalid("exponent requires digits");
      while (this.digit(this.source[this.index])) this.index += 1;
    }
  }

  private digit(value: string | undefined): boolean {
    return value !== undefined && value >= "0" && value <= "9";
  }
}

function parseBoundedJson(raw: unknown): AppearancePreferenceCodecResult<unknown> {
  if (typeof raw !== "string") return fail("invalid-input", "$", "stored preference must be a string");
  if (exceedsUtf8ByteLimit(raw, APPEARANCE_PREFERENCE_MAX_BYTES)) {
    return fail("too-large", "$", `stored preference exceeds ${APPEARANCE_PREFERENCE_MAX_BYTES} UTF-8 bytes`);
  }
  try {
    new StoredJsonScanner(raw).validate();
    return Object.freeze({ ok: true, value: JSON.parse(raw) as unknown });
  } catch (error) {
    return fail("invalid-json", "$", error instanceof Error ? error.message : "invalid stored JSON");
  }
}

type CapturedRecord = Record<string, unknown>;

function captureExactRecord(
  value: unknown,
  expected: readonly string[],
  path = "$",
): AppearancePreferenceCodecResult<CapturedRecord> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("invalid-record", path, "preference must be a plain object");
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail("invalid-record", path, "preference must be a plain object");
    }
    const keys = Reflect.ownKeys(value);
    const unknown = keys.find((key) => typeof key !== "string" || !expected.includes(key));
    if (unknown !== undefined) {
      const field = typeof unknown === "string" ? unknown : "[symbol]";
      return fail("unknown-field", `${path}.${field}`, "unexpected preference field");
    }
    for (const key of expected) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        return fail("missing-field", `${path}.${key}`, "required preference field is missing");
      }
    }
    if (keys.length !== expected.length) return fail("invalid-record", path, "preference keys are not exact");
    const captured: CapturedRecord = Object.create(null) as CapturedRecord;
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) return fail("invalid-record", `${path}.${key}`, "accessors are not allowed");
      captured[key] = descriptor.value;
    }
    return Object.freeze({ ok: true, value: captured });
  } catch {
    return fail("invalid-record", path, "preference could not be safely inspected");
  }
}

const isProfileId = (value: unknown): value is AppearanceProfileId =>
  (APPEARANCE_PROFILE_IDS as readonly unknown[]).includes(value);

const isDensity = (value: unknown): value is AppearanceDensity =>
  value === "compact" || value === "comfortable";

function normalizeProfile(profile: InterfaceProfileV1): InterfaceProfileV1 {
  const colors = {} as Record<ColorRoleV1, `#${string}`>;
  for (const role of COLOR_ROLES) colors[role] = profile.colors[role].toUpperCase() as `#${string}`;
  return Object.freeze({
    schemaVersion: 1,
    name: profile.name,
    colorScheme: profile.colorScheme,
    typography: profile.typography,
    density: profile.density,
    chrome: profile.chrome,
    colors: Object.freeze(colors),
  });
}

function admittedImported(profile: unknown): AppearancePreferenceCodecResult<ImportedAppearancePreferenceV2> {
  const result = admitInterfaceProfileContrast(profile);
  if (!result.ok) {
    return Object.freeze({
      ok: false,
      errors: Object.freeze(result.errors.map((error) => Object.freeze({
        code: "context" in error && error.context === "manifest" ? "invalid-profile" as const : "unsafe-profile" as const,
        path: "path" in error ? `profile.${error.path}` : "profile",
        ...( "context" in error ? { context: error.context } : {}),
        message: error.message,
      }))),
    });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({ schemaVersion: 2, kind: "imported", profile: result.profile }),
  });
}

/** Encode exactly one built-in or imported choice to the private v2 string. */
export function encodeAppearancePreferenceV2(input: unknown): AppearancePreferenceCodecResult<EncodedAppearancePreferenceV2> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("invalid-record", "$", "preference must be a plain object");
  }
  let kind: unknown;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, "kind");
    if (!descriptor || !("value" in descriptor)) return fail("invalid-record", "$.kind", "kind must be a data property");
    kind = descriptor.value;
  } catch {
    return fail("invalid-record", "$.kind", "kind could not be safely inspected");
  }
  if (kind === "built-in") {
    const builtInRecord = captureExactRecord(input, ["schemaVersion", "kind", "profileId", "density"]);
    if (!builtInRecord.ok) return builtInRecord;
    return encodeBuiltInRecord(builtInRecord.value);
  }
  if (kind === "imported") {
    const importedRecord = captureExactRecord(input, ["schemaVersion", "kind", "profile"]);
    if (!importedRecord.ok) return importedRecord;
    return encodeImportedRecord(importedRecord.value);
  }
  return fail("unsupported-kind", "$.kind", "kind must be built-in or imported");
}

function encodeBuiltInRecord(record: CapturedRecord): AppearancePreferenceCodecResult<EncodedAppearancePreferenceV2> {
  if (record.schemaVersion !== 2) return fail("unsupported-version", "$.schemaVersion", "schemaVersion must be 2");
  if (!isProfileId(record.profileId)) return fail("unsupported-profile", "$.profileId", "profileId is not a built-in profile");
  if (!isDensity(record.density)) return fail("unsupported-density", "$.density", "density must be compact or comfortable");
  const preference: BuiltInAppearancePreferenceV2 = Object.freeze({
    schemaVersion: 2,
    kind: "built-in",
    profileId: record.profileId,
    density: record.density,
  });
  return encoded(preference, JSON.stringify(preference));
}

function encodeImportedRecord(record: CapturedRecord): AppearancePreferenceCodecResult<EncodedAppearancePreferenceV2> {
  if (record.schemaVersion !== 2) return fail("unsupported-version", "$.schemaVersion", "schemaVersion must be 2");
  const admitted = admittedImported(record.profile);
  if (!admitted.ok) return admitted;
  const preference: ImportedAppearancePreferenceV2 = Object.freeze({
    schemaVersion: 2,
    kind: "imported",
    profile: normalizeProfile(admitted.value.profile),
  });
  return encoded(preference, JSON.stringify(preference));
}

function encoded(
  preference: AdmittedAppearancePreferenceV2,
  raw: string,
): AppearancePreferenceCodecResult<EncodedAppearancePreferenceV2> {
  if (exceedsUtf8ByteLimit(raw, APPEARANCE_PREFERENCE_MAX_BYTES)) {
    return fail("too-large", "$", `encoded preference exceeds ${APPEARANCE_PREFERENCE_MAX_BYTES} UTF-8 bytes`);
  }
  return Object.freeze({ ok: true, value: Object.freeze({ raw, preference }) });
}

/** Decode a present v2 string. A corrupt v2 record is an error, never a v1 fallback signal. */
export function decodeAppearancePreferenceV2(raw: unknown): AppearancePreferenceCodecResult<AdmittedAppearancePreferenceV2> {
  const parsed = parseBoundedJson(raw);
  if (!parsed.ok) return parsed;
  if (typeof parsed.value !== "object" || parsed.value === null || Array.isArray(parsed.value)) {
    return fail("invalid-record", "$", "v2 preference must be an object");
  }
  let kind: unknown;
  let schemaVersion: unknown;
  try {
    kind = (parsed.value as { kind?: unknown }).kind;
    schemaVersion = (parsed.value as { schemaVersion?: unknown }).schemaVersion;
  } catch {
    return fail("invalid-record", "$", "v2 preference could not be safely inspected");
  }
  if (schemaVersion !== 2) return fail("unsupported-version", "$.schemaVersion", "schemaVersion must be 2");
  if (kind === "built-in") {
    const captured = captureExactRecord(parsed.value, ["schemaVersion", "kind", "profileId", "density"]);
    if (!captured.ok) return captured;
    const result = encodeBuiltInRecord(captured.value);
    return result.ok ? Object.freeze({ ok: true, value: result.value.preference }) : result;
  }
  if (kind === "imported") {
    const captured = captureExactRecord(parsed.value, ["schemaVersion", "kind", "profile"]);
    if (!captured.ok) return captured;
    const result = encodeImportedRecord(captured.value);
    return result.ok ? Object.freeze({ ok: true, value: result.value.preference }) : result;
  }
  return fail("unsupported-kind", "$.kind", "kind must be built-in or imported");
}

/** Decode only the exact legacy v1 built-in preference shape. */
export function decodeLegacyAppearancePreferenceV1(raw: unknown): AppearancePreferenceCodecResult<AppearanceSelection> {
  const parsed = parseBoundedJson(raw);
  if (!parsed.ok) return parsed;
  const captured = captureExactRecord(parsed.value, ["schemaVersion", "profileId", "density"]);
  if (!captured.ok) return captured;
  if (captured.value.schemaVersion !== 1) return fail("unsupported-version", "$.schemaVersion", "legacy schemaVersion must be 1");
  if (!isProfileId(captured.value.profileId)) return fail("unsupported-profile", "$.profileId", "profileId is not a built-in profile");
  if (!isDensity(captured.value.density)) return fail("unsupported-density", "$.density", "density must be compact or comfortable");
  return Object.freeze({
    ok: true,
    value: Object.freeze({ profileId: captured.value.profileId, density: captured.value.density }),
  });
}
