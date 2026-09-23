/** Duplicate-aware JSON grammar validation shared by bounded text callers. */
const MAX_JSON_NESTING = 64;

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
      if (character === 0x20 || character === 0x09 || character === 0x0a || character === 0x0d) this.index += 1;
      else return;
    }
  }

  private value(depth: number): void {
    if (depth > MAX_JSON_NESTING) this.invalid("JSON nesting limit exceeded");
    const character = this.source[this.index];
    if (character === "{") this.object(depth + 1);
    else if (character === "[") this.array(depth + 1);
    else if (character === '"') this.string();
    else if (character === "t") this.literal("true");
    else if (character === "f") this.literal("false");
    else if (character === "n") this.literal("null");
    else if (character === "-" || (character !== undefined && character >= "0" && character <= "9")) this.number();
    else this.invalid("expected a JSON value");
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
      } else this.invalid("invalid string escape");
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
      while (this.isDigit(this.source[this.index])) this.index += 1;
    } else this.invalid("invalid JSON number");
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

/** Validate standard JSON grammar and reject duplicate decoded keys at every depth. */
export function validateStrictJson(source: string): void {
  new DuplicateAwareJsonScanner(source).validate();
}
