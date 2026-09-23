import { describe, expect, it } from "vitest";

import { TACHIKO_COMPACT_PORCELAIN_PROFILE, type InterfaceProfileV1 } from "./profile.js";
import { INTERFACE_PROFILE_JSON_MAX_BYTES, parseInterfaceProfileJsonBytes } from "./profile-package.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const profileRecord = (name = "Imported profile"): Record<string, unknown> => ({
  ...TACHIKO_COMPACT_PORCELAIN_PROFILE,
  name,
  colors: { ...TACHIKO_COMPACT_PORCELAIN_PROFILE.colors },
});

const jsonFor = (name = "Imported profile"): string => JSON.stringify(profileRecord(name));

const expectRejected = (text: string) => {
  const result = parseInterfaceProfileJsonBytes(encode(text));
  expect(result.ok).toBe(false);
  return result;
};

describe("Interface Profile JSON package structural parser", () => {
  it("accepts the exact byte cap including a multibyte name and one leading BOM", () => {
    const exactBase = encode(`\uFEFF${jsonFor("漢")}`);
    expect(exactBase.byteLength).toBeLessThan(INTERFACE_PROFILE_JSON_MAX_BYTES);
    const exactText = `\uFEFF${jsonFor("漢")}${" ".repeat(INTERFACE_PROFILE_JSON_MAX_BYTES - exactBase.byteLength)}`;
    const exactBytes = encode(exactText);
    expect(exactBytes.byteLength).toBe(INTERFACE_PROFILE_JSON_MAX_BYTES);

    const result = parseInterfaceProfileJsonBytes(exactBytes);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.name).toBe("漢");

    const oversized = new Uint8Array(INTERFACE_PROFILE_JSON_MAX_BYTES + 1);
    oversized.set(exactBytes);
    oversized[oversized.length - 1] = 0x20;
    const rejected = parseInterfaceProfileJsonBytes(oversized);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors[0]?.message).toContain("32768-byte limit");
  });

  it("accepts one BOM, counts it toward the limit, and rejects a second leading BOM", () => {
    const parsed = parseInterfaceProfileJsonBytes(encode(`\uFEFF${jsonFor("Tachiko")}`));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.manifest.name).toBe("Tachiko");

    expectRejected(`\uFEFF\uFEFF${jsonFor("Tachiko")}`);
  });

  it("rejects malformed UTF-8 before JSON parsing", () => {
    const result = parseInterfaceProfileJsonBytes(new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain("UTF-8");
  });

  it.each([
    ["", "empty input"],
    ["{\"schemaVersion\":}", "missing value"],
    [`${jsonFor()} {}`, "trailing JSON value"],
    [jsonFor().replace(/}$/, ",}"), "trailing comma"],
    ["{\"x\":01}", "leading-zero number"],
  ])("rejects malformed JSON (%s)", (text) => {
    expect(expectRejected(text).ok).toBe(false);
  });

  it.each([
    [jsonFor().replace('"name":"Imported profile"', '"name":"Imported profile","name":"Again"'), "raw duplicate root key"],
    [jsonFor().replace('"name":"Imported profile"', '"name":"Imported profile","na\\u006de":"Again"'), "escaped-equivalent duplicate root key"],
    [jsonFor().replace('"focus.ring":"#6551CE"', '"focus.ring":"#6551CE","focus.ring":"#000000"'), "raw duplicate color key"],
    [jsonFor().replace('"focus.ring":"#6551CE"', '"focus.ring":"#6551CE","focus.\\u0072ing":"#000000"'), "escaped-equivalent duplicate color key"],
  ])("rejects decoded duplicate keys (%s)", (text) => {
    const result = expectRejected(text);
    if (!result.ok) expect(result.errors[0]?.message).toContain("duplicate object key");
  });

  it("does not mistake braces, escaped quotes, or key-like text inside strings for structure", () => {
    const name = 'text } { "name": \\"not a key\\"';
    const result = parseInterfaceProfileJsonBytes(encode(jsonFor(name)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.name).toBe(name);
  });

  it("rejects deeply nested JSON safely and detects duplicate keys inside ignored nested objects", () => {
    const deep = `${"[".repeat(80)}0${"]".repeat(80)}`;
    const deepResult = expectRejected(deep);
    if (!deepResult.ok) expect(deepResult.errors[0]?.message).toContain("nesting limit");

    const nestedDuplicate = jsonFor().replace(/}$/, ',"ignored":{"nested":{"x":1,"x":2}}}');
    const duplicateResult = expectRejected(nestedDuplicate);
    if (!duplicateResult.ok) expect(duplicateResult.errors[0]?.message).toContain("duplicate object key");
  });

  it.each([
    [jsonFor().replace(/}$/, ',"extra":true}'), "unknown root field"],
    [jsonFor().replace(/^{/, '{"__proto__":{"polluted":true},'), "root __proto__ field"],
    [jsonFor().replace('"colors":{', '"colors":{"extra.role":"#010203",'), "unknown color field"],
    [jsonFor().replace('"colors":{', '"colors":{"__proto__":"#010203",'), "color __proto__ field"],
    [jsonFor().replace('"surface.app":"#FFFFFF"', '"surface.app":{"value":"#FFFFFF"}'), "structurally invalid nested color value"],
  ])("rejects hostile or invalid shape (%s)", (text) => {
    const result = expectRejected(text);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns a detached frozen parsed manifest, including a built-in-equal name", () => {
    const source = encode(jsonFor("Tachiko"));
    const result = parseInterfaceProfileJsonBytes(source);
    source.fill(0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest: InterfaceProfileV1 = result.manifest;
    expect(result.kind).toBe("parsed-manifest");
    expect(manifest.name).toBe("Tachiko");
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.colors)).toBe(true);
    expect(manifest.colors["surface.app"]).toBe("#FFFFFF");
  });
});
