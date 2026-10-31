import { describe, expect, it } from "vitest";
import { CSV_DELIMITER_LABELS, CSV_ENCODING_LABELS, detectCsvDelimiter, guessCsvEncoding, toUtf8Bytes } from "./csv-text.js";

/** printf '名稱,金額\n午餐,120\n' | iconv -f UTF-8 -t BIG5 */
const BIG5 = new Uint8Array([
  0xa6, 0x57, 0xba, 0xd9, 0x2c, 0xaa, 0xf7, 0xc3, 0x42, 0x0a, 0xa4, 0xc8,
  0xc0, 0x5c, 0x2c, 0x31, 0x32, 0x30, 0x0a,
]);
/** printf '名前,金額\n昼食,120\n' | iconv -f UTF-8 -t SHIFT_JIS */
const SHIFT_JIS = new Uint8Array([
  0x96, 0xbc, 0x91, 0x4f, 0x2c, 0x8b, 0xe0, 0x8a, 0x7a, 0x0a, 0x92, 0x8b,
  0x90, 0x48, 0x2c, 0x31, 0x32, 0x30, 0x0a,
]);

function utf16leWithBom(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = code & 0xff;
    bytes[3 + i * 2] = code >> 8;
  }
  return bytes;
}

const decoded = (bytes: ArrayBuffer) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

describe("detectCsvDelimiter", () => {
  it("picks the semicolon of a decimal-comma European export", () => {
    expect(detectCsvDelimiter("Name;Amount\nLunch;12,50\nTaxi;8,00\n")).toBe(";");
  });

  it("picks the tab of an Excel text export", () => {
    expect(detectCsvDelimiter("Name\tAmount\nLunch\t12,50\n")).toBe("\t");
  });

  it("ignores separators inside quoted fields", () => {
    expect(detectCsvDelimiter('a,b\n"x;y",1\n')).toBe(",");
    expect(detectCsvDelimiter('Name;Note\nLunch;"12,50"\n')).toBe(";");
  });

  it("keeps a quoted newline inside one field", () => {
    expect(detectCsvDelimiter('Name,Note\n"a\nb",1\n')).toBe(",");
  });

  it("prefers tab, then semicolon, then comma on ties", () => {
    expect(detectCsvDelimiter("a,b;c\n1,2;3\n")).toBe(";");
    expect(detectCsvDelimiter("a;b\tc\n1;2\t3\n")).toBe("\t");
  });

  it("falls back to comma for a single column, empty text or mismatched records", () => {
    expect(detectCsvDelimiter("Name\nLunch\n")).toBe(",");
    expect(detectCsvDelimiter("")).toBe(",");
    expect(detectCsvDelimiter("a;b\n1;2;3\n")).toBe(",");
  });
});

describe("guessCsvEncoding and toUtf8Bytes", () => {
  it("reads Traditional Chinese Big5 using the language preference", () => {
    expect(guessCsvEncoding(BIG5.buffer, ["zh-TW"])).toBe("big5");
    expect(decoded(toUtf8Bytes(BIG5.buffer, "big5"))).toBe("名稱,金額\n午餐,120\n");
  });

  it("reads Japanese Shift_JIS using the language preference", () => {
    expect(guessCsvEncoding(SHIFT_JIS.buffer, ["ja-JP"])).toBe("shift_jis");
    expect(decoded(toUtf8Bytes(SHIFT_JIS.buffer, "shift_jis"))).toBe("名前,金額\n昼食,120\n");
  });

  it("leaves UTF-8 bytes unchanged but copies them", () => {
    const utf8 = new TextEncoder().encode("名稱,金額\n午餐,120\n").buffer as ArrayBuffer;
    expect(guessCsvEncoding(utf8, ["zh-TW"])).toBe("utf-8");
    const converted = toUtf8Bytes(utf8, "utf-8");
    expect(converted).not.toBe(utf8);
    expect(decoded(converted)).toBe("名稱,金額\n午餐,120\n");
  });

  it("detects UTF-16LE from its BOM and drops the BOM when converting", () => {
    const bytes = utf16leWithBom("名稱,金額\n午餐,120\n");
    expect(guessCsvEncoding(bytes.buffer, [])).toBe("utf-16le");
    expect(decoded(toUtf8Bytes(bytes.buffer, "utf-16le"))).toBe("名稱,金額\n午餐,120\n");
  });

  it("labels every encoding and delimiter", () => {
    expect(CSV_ENCODING_LABELS["utf-8"]).toBe("Unicode (UTF-8)");
    expect(CSV_ENCODING_LABELS.shift_jis).toBe("Japanese (Shift_JIS)");
    expect(CSV_DELIMITER_LABELS).toEqual({ ",": "Comma", ";": "Semicolon", "\t": "Tab" });
  });
});
