/** Pure structural parsing for an Interface Profile v1 JSON package. */
import {
  validateInterfaceProfile,
  type InterfaceProfileV1,
  type ProfileValidationError,
} from "./profile.js";

export const INTERFACE_PROFILE_JSON_MAX_BYTES = 32_768;

/** A parsed closed manifest is structural input only; safety admission is a separate boundary. */
export type ProfilePackageParseResult =
  | Readonly<{ ok: true; kind: "parsed-manifest"; manifest: InterfaceProfileV1 }>
  | Readonly<{ ok: false; errors: readonly ProfileValidationError[] }>;

const MAX_JSON_NESTING = 64;

function failure(message: string): ProfilePackageParseResult {
  return {
    ok: false,
    errors: Object.freeze([Object.freeze({ path: "$", message })]),
  };
}

/**
 * Scans JSON grammar while retaining each decoded object's own key set. This
 * catches duplicate decoded names before JSON.parse can collapse them into an
 * ordinary object. The scanner is bounded by the package byte cap and depth
 * cap; JSON.parse remains the authoritative construction step afterward.
 */
class DuplicateAwareJsonScanner {
  private index = 0;

  constructor(private readonly source: string) {}

  validate(): void {
    this.skipWhitespace();
    this.value(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) this.invalid("trailing content after the JSON value");
  }

  private invalid(message: string): never {
    throw new SyntaxError(`${message} at character ${this.index}`);
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length) {
      const character = this.source.charCodeAt(this.index);
      if (character === 0x20 || character === 0x09 || character === 0x0a || character === 0x0d) {
        this.index += 1;
      } else {
        return;
      }
    }
  }

  private value(depth: number): void {
    if (depth > MAX_JSON_NESTING) this.invalid("JSON nesting limit exceeded");
    const character = this.source[this.index];
    if (character === "{") {
      this.object(depth + 1);
    } else if (character === "[") {
      this.array(depth + 1);
    } else if (character === '"') {
      this.string();
    } else if (character === "t") {
      this.literal("true");
    } else if (character === "f") {
      this.literal("false");
    } else if (character === "n") {
      this.literal("null");
    } else if (character === "-" || (character !== undefined && character >= "0" && character <= "9")) {
      this.number();
    } else {
      this.invalid("expected a JSON value");
    }
  }

  private object(depth: number): void {
    if (depth > MAX_JSON_NESTING) this.invalid("JSON nesting limit exceeded");
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return;
    }

    const keys = new Set<string>();
    while (true) {
      if (this.source[this.index] !== '"') this.invalid("expected an object key string");
      const key = this.string();
      if (keys.has(key)) this.invalid(`duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ":") this.invalid("expected ':' after an object key");
      this.index += 1;
      this.skipWhitespace();
      this.value(depth);
      this.skipWhitespace();
      const delimiter = this.source[this.index];
      if (delimiter === "}") {
        this.index += 1;
        return;
      }
      if (delimiter !== ",") this.invalid("expected ',' or '}' after an object value");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private array(depth: number): void {
    if (depth > MAX_JSON_NESTING) this.invalid("JSON nesting limit exceeded");
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return;
    }
    while (true) {
      this.value(depth);
      this.skipWhitespace();
      const delimiter = this.source[this.index];
      if (delimiter === "]") {
        this.index += 1;
        return;
      }
      if (delimiter !== ",") this.invalid("expected ',' or ']' after an array value");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source.charCodeAt(this.index);
      if (character === 0x22) {
        this.index += 1;
        return JSON.parse(this.source.slice(start, this.index)) as string;
      }
      if (character <= 0x1f) this.invalid("unescaped control character in a JSON string");
      if (character !== 0x5c) {
        this.index += 1;
        continue;
      }

      this.index += 1;
      const escape = this.source[this.index];
      if (escape === "u") {
        const digits = this.source.slice(this.index + 1, this.index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(digits)) this.invalid("invalid Unicode escape");
        this.index += 5;
      } else if (escape === '"' || escape === "\\" || escape === "/" || escape === "b" || escape === "f" || escape === "n" || escape === "r" || escape === "t") {
        this.index += 1;
      } else {
        this.invalid("invalid string escape");
      }
    }
    this.invalid("unterminated JSON string");
  }

  private literal(expected: "true" | "false" | "null"): void {
    if (this.source.slice(this.index, this.index + expected.length) !== expected) {
      this.invalid("invalid JSON literal");
    }
    this.index += expected.length;
  }

  private number(): void {
    if (this.source[this.index] === "-") this.index += 1;
    const first = this.source[this.index];
    if (first === "0") {
      this.index += 1;
    } else if (first !== undefined && first >= "1" && first <= "9") {
      this.index += 1;
      while (this.isDigit(this.source[this.index])) this.index += 1;
    } else {
      this.invalid("invalid JSON number");
    }

    if (this.source[this.index] === ".") {
      this.index += 1;
      if (!this.isDigit(this.source[this.index])) this.invalid("fraction requires at least one digit");
      while (this.isDigit(this.source[this.index])) this.index += 1;
    }
    if (this.source[this.index] === "e" || this.source[this.index] === "E") {
      this.index += 1;
      if (this.source[this.index] === "+" || this.source[this.index] === "-") this.index += 1;
      if (!this.isDigit(this.source[this.index])) this.invalid("exponent requires at least one digit");
      while (this.isDigit(this.source[this.index])) this.index += 1;
    }
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }
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
    new DuplicateAwareJsonScanner(jsonText).validate();
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
