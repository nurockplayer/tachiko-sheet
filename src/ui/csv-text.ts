/** Separator and text-encoding helpers for CSV/TSV files saved by other spreadsheets. */

export type CsvDelimiter = "," | ";" | "\t";
export type CsvEncoding = "utf-8" | "utf-16le" | "big5" | "shift_jis" | "gb18030" | "euc-kr" | "windows-1252";

/** Tie-break order: a candidate must beat the previous one, so tab wins ties, then semicolon, then comma. */
const DELIMITER_CANDIDATES: readonly CsvDelimiter[] = ["\t", ";", ","];
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
 *  header record has >= 1 of it and every later non-empty record has the same count. Prefer the qualifying candidate
 *  with the most header separators; ties → "\t", then ";", then ",". None qualifies → ",". */
export function detectCsvDelimiter(text: string): CsvDelimiter {
  let chosen: CsvDelimiter | null = null;
  let chosenSeparators = 0;
  for (const delimiter of DELIMITER_CANDIDATES) {
    const [header, ...rest] = scanRecords(text, delimiter);
    if (!header || header.empty || header.fields < 2) continue;
    if (rest.some(record => !record.empty && record.fields !== header.fields)) continue;
    const separators = header.fields - 1;
    if (separators > chosenSeparators) {
      chosen = delimiter;
      chosenSeparators = separators;
    }
  }
  return chosen ?? ",";
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
 *  FF FE BOM → "utf-16le". Otherwise try, in order, the language-preferred encoding (zh-TW/zh-HK/zh-Hant* → big5,
 *  ja* → shift_jis, zh-CN/zh-Hans/zh → gb18030, ko* → euc-kr), then big5, shift_jis, gb18030, euc-kr, each with
 *  fatal: true; first that decodes wins; fallback "windows-1252". */
export function guessCsvEncoding(bytes: ArrayBuffer, languages: readonly string[]): CsvEncoding {
  try {
    UTF8_DECODER.decode(bytes);
    return "utf-8";
  } catch {
    // Not UTF-8; fall through to the legacy encodings.
  }
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
  if (head[0] === 0xff && head[1] === 0xfe) return "utf-16le";
  const preferred = languages.flatMap(language => preferredEncoding(language) ?? []);
  for (const encoding of [...preferred, ...ENCODING_CANDIDATES]) {
    try {
      new TextDecoder(encoding, { fatal: true }).decode(bytes);
      return encoding;
    } catch {
      // Try the next candidate.
    }
  }
  return "windows-1252";
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
  "utf-16le": "Unicode (UTF-16)",
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
