/** Separator and text-encoding helpers for CSV/TSV files saved by other spreadsheets. */

export type CsvDelimiter = "," | ";" | "\t";
export type CsvEncoding = "utf-8" | "utf-16le" | "utf-16be" | "big5" | "shift_jis" | "gb18030" | "euc-kr" | "windows-1252";

/** Tie-break order after the preferred separator: a candidate must beat the previous one, so tab wins ties, then comma, then semicolon. */
const DELIMITER_CANDIDATES: readonly CsvDelimiter[] = ["\t", ",", ";"];
const ENCODING_CANDIDATES: readonly CsvEncoding[] = ["big5", "shift_jis", "gb18030", "euc-kr"];
const RECORD_LIMIT = 10;

interface CsvRecord {
  /** Number of fields in the record; separators inside quoted fields do not count. */
  fields: number;
  /** Blank lines do not take part in the field-count comparison. */
  empty: boolean;
}

/** Split up to `RECORD_LIMIT` records, honouring "quoted" fields with doubled quotes and embedded newlines. */
function scanRecords(text: string, delimiter: CsvDelimiter): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields = 1;
  let recordStart = 0;
  let inQuotes = false;
  let atFieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char !== '"') continue;
      if (text[i + 1] === '"') { i++; continue; }
      inQuotes = false;
      atFieldStart = false;
      continue;
    }
    if (char === delimiter) { fields++; atFieldStart = true; continue; }
    if (char === '"' && atFieldStart) { inQuotes = true; continue; }
    if (char === "\n" || char === "\r") {
      records.push({ fields, empty: text.slice(recordStart, i).trim() === "" });
      if (records.length === RECORD_LIMIT) return records;
      if (char === "\r" && text[i + 1] === "\n") i++;
      recordStart = i + 1;
      fields = 1;
      atFieldStart = true;
      continue;
    }
    atFieldStart = false;
  }
  // A trailing newline ends the previous record; it does not open another one.
  if (recordStart < text.length || fields > 1) records.push({ fields, empty: text.slice(recordStart).trim() === "" });
  return records;
}

/** Parse up to 10 records (respect "quoted" fields incl. doubled quotes and newlines). A candidate qualifies when the
 *  header record has >= 1 of it and every later non-empty record has the same count. The qualifying candidate that
 *  splits the header into the most fields wins: a semicolon file with commas inside fields (`Tokyo,Japan`,
 *  `Amount,EUR`, `12,50` from comma-decimal locales) reads as semicolons. Ties → `preferred` (comma for .csv, tab
 *  for Excel's tab-delimited .txt), then "\t", ",", ";". None qualifies → `preferred`. The preview shows the choice. */
export function detectCsvDelimiter(text: string, preferred: CsvDelimiter = ","): CsvDelimiter {
  const separatorsOf = (delimiter: CsvDelimiter): number => {
    const [header, ...rest] = scanRecords(text, delimiter);
    if (!header || header.empty || header.fields < 2) return 0;
    if (rest.some(record => !record.empty && record.fields !== header.fields)) return 0;
    return header.fields - 1;
  };
  let chosen = preferred;
  let chosenSeparators = separatorsOf(preferred);
  for (const delimiter of DELIMITER_CANDIDATES) {
    const separators = delimiter === preferred ? 0 : separatorsOf(delimiter);
    if (separators > chosenSeparators) {
      chosen = delimiter;
      chosenSeparators = separators;
    }
  }
  return chosen;
}

function preferredEncoding(language: string): CsvEncoding | null {
  const tag = language.trim().toLowerCase().replace(/_/g, "-");
  if (tag === "zh-tw" || tag === "zh-hk" || tag.startsWith("zh-hant")) return "big5";
  if (tag.startsWith("ja")) return "shift_jis";
  if (tag === "zh-cn" || tag.startsWith("zh-hans") || tag === "zh") return "gb18030";
  if (tag.startsWith("ko")) return "euc-kr";
  return null;
}

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/** "utf-8" if `new TextDecoder("utf-8", { fatal: true })` succeeds (a UTF-8 BOM is fine, Work strips it).
 *  FF FE BOM, or NUL in at least 30% of the odd bytes (and at most 5% of the even ones) of the first 4 KiB → "utf-16le";
 *  FE FF BOM or the mirrored NUL pattern → "utf-16be" (checked first: NUL is valid UTF-8). Otherwise try, in order, the language-preferred encoding (zh-TW/zh-HK/zh-Hant* → big5,
 *  ja* → shift_jis, zh-CN/zh-Hans/zh → gb18030, ko* → euc-kr), then big5, shift_jis, gb18030, euc-kr, each with
 *  fatal: true; first that decodes wins; fallback "windows-1252". After the language-preferred encodings, bytes
 *  whose high bytes mostly stand alone are read as "windows-1252" before the other double-byte candidates. */
export function guessCsvEncoding(bytes: ArrayBuffer, languages: readonly string[]): CsvEncoding {
  // NUL is valid UTF-8, so UTF-16LE without a BOM ("N\0a\0m\0e\0") would pass
  // the UTF-8 check: text with NUL in most odd bytes and few even ones is UTF-16LE.
  const sample = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4096) & ~1);
  if (sample.length >= 4) {
    let oddNul = 0;
    let evenNul = 0;
    for (let i = 0; i < sample.length; i += 2) {
      if (sample[i] === 0) evenNul++;
      if (sample[i + 1] === 0) oddNul++;
    }
    const pairs = sample.length / 2;
    if (oddNul >= pairs * 0.3 && evenNul <= pairs * 0.05) return "utf-16le";
    if (evenNul >= pairs * 0.3 && oddNul <= pairs * 0.05) return "utf-16be";
  }
  try {
    UTF8_DECODER.decode(bytes);
    return "utf-8";
  } catch {
    // Not UTF-8; fall through to the legacy encodings.
  }
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
  if (head[0] === 0xff && head[1] === 0xfe) return "utf-16le";
  if (head[0] === 0xfe && head[1] === 0xff) return "utf-16be";
  const decodes = (encoding: CsvEncoding): boolean => {
    try {
      new TextDecoder(encoding, { fatal: true }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  };
  // Bytes alone cannot tell "année" in Windows-1252 from "表" (95 5C) in
  // Shift_JIS, so the user's own language decides first and the import preview
  // always shows non-ASCII lines for the user to confirm (csvSampleLines).
  for (const encoding of languages.flatMap(language => preferredEncoding(language) ?? [])) if (decodes(encoding)) return encoding;
  // Without a language hint, isolated high bytes (é between ASCII letters) are
  // Western single-byte text; double-byte text mostly pairs its high bytes.
  if (mostlyIsolatedHighBytes(new Uint8Array(bytes))) return "windows-1252";
  return ENCODING_CANDIDATES.find(decodes) ?? "windows-1252";
}

/** True when most bytes >= 0x80 stand alone rather than in high-high pairs. */
function mostlyIsolatedHighBytes(bytes: Uint8Array): boolean {
  let high = 0, isolated = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i]! < 0x80) continue;
    if (i + 1 < bytes.length && bytes[i + 1]! >= 0x80) { high += 2; i++; }
    else { high += 1; isolated += 1; }
  }
  return high > 0 && isolated * 2 > high;
}

/** Up to `max` lines that contain non-ASCII text, so a wrong encoding guess is visible before import. */
export function csvSampleLines(text: string, max = 5): string[] {
  const lines: string[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    if (!/[^\u0000-\u007f]/.test(line)) continue;
    lines.push(line.length > 120 ? `${line.slice(0, 119)}…` : line);
    if (lines.length === max) break;
  }
  return lines;
}

/** utf-8 → the same bytes (copy). Otherwise TextDecoder(encoding) → TextEncoder (UTF-8), dropping a UTF-16 BOM. */
export function toUtf8Bytes(bytes: ArrayBuffer, encoding: CsvEncoding): ArrayBuffer {
  if (encoding === "utf-8") return bytes.slice(0);
  const text = new TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/, "");
  const encoded = new TextEncoder().encode(text);
  return encoded.buffer as ArrayBuffer;
}

export const CSV_ENCODING_LABELS: Record<CsvEncoding, string> = {
  "utf-8": "Unicode (UTF-8)",
  "utf-16le": "Unicode (UTF-16 LE)",
  "utf-16be": "Unicode (UTF-16 BE)",
  "big5": "Traditional Chinese (Big5)",
  "shift_jis": "Japanese (Shift_JIS)",
  "gb18030": "Simplified Chinese (GB18030)",
  "euc-kr": "Korean (EUC-KR)",
  "windows-1252": "Western (Windows-1252)",
};

export const CSV_DELIMITER_LABELS: Record<CsvDelimiter, string> = {
  ",": "Comma",
  ";": "Semicolon",
  "\t": "Tab",
};
