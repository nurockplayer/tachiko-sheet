import { describe, expect, it } from "vitest";
import { findingCategoryLabel, findingMessage } from "./interop-copy.js";

describe("import/export disclosure copy", () => {
  it("translates the exact producer presence loss separately from general CSV limits", () => {
    const original = "CSV cannot distinguish an absent optional Text value from present empty Text; both export as an empty field. Retain the Tachiko source to preserve presence.";
    expect(findingMessage(original)).toBe("CSV cannot preserve the difference between blank cells and empty text; both export as empty cells.");
    expect(findingMessage(original + " A changed condition.")).toBe(original + " A changed condition.");
    const general = findingMessage("CSV exports scalar lexical values only: typing and formatting are lost. Formula-leading Text or headers are refused; use typed XLSX.");
    expect(general).toContain("without column types or formatting");
    expect(general).toContain("refused; use XLSX to keep types");
    expect(general).not.toMatch(/blank|empty text/i);
  });
  it("keeps every CSV export loss visible in task language", () => {
    const original = "CSV exports selected-sheet scalar values only. Formula definitions, presentation formatting, and other sheets are not preserved; retain the source project.";
    const text = findingMessage(original);
    expect(text).toContain("only cell values from the selected sheet");
    expect(text).toContain("Formulas, formatting, and other sheets are not kept");
    expect(text).toContain("keep the source work");
    expect(findingCategoryLabel("lossy_on_export")).toBe("Export limitations");
    expect(findingCategoryLabel("unsupported_safe_disabled")).toBe("Unsupported — disabled");
  });

  it("includes the successor imported CSV presence loss without dropping existing losses", () => {
    const original = "CSV exports selected-sheet scalar values only. Blank and present empty Text both become empty CSV fields. Formula definitions, presentation formatting, and other sheets are not preserved; retain the source project.";
    expect(findingMessage(original, "csv_values_only")).toBe("CSV includes only cell values from the selected sheet. Blank cells and empty text both become empty CSV cells. Formulas, formatting, and other sheets are not kept; keep the source work.");
    expect(findingMessage(original + " A changed condition.", "csv_values_only")).toBe(original + " A changed condition.");
  });

  it("preserves unrecognized and changed producer warnings without guessing their meaning", () => {
    for (const message of [
      "This file contains an unsupported feature. Nothing was imported.",
      "Export is rebuilt from current stable identities and authoritative values. A new limitation applies.",
      "__proto__",
    ]) expect(findingMessage(message)).toBe(message);
  });
});


describe("current imported structure disclosures", () => {
  it("explains an unrepresentable layout while retaining its exact reason", () => {
    expect(findingMessage("The field mapping is foreign.", "imported_spreadsheet_unrepresentable"))
      .toBe("The original workbook layout cannot represent this table. The field mapping is foreign.");
    expect(findingMessage("Future reason", "future_code")).toBe("Future reason");
  });
  it("preserves requested, written and original headings in plain copy", () => {
    const text = 'Current header "New" exports as "New_2"; the source header was "Old".';
    expect(findingMessage(text, "imported_current_header")).toBe('The current column heading "New" will download as "New_2". The original heading was "Old".');
    expect(findingMessage("A changed warning", "imported_current_header")).toBe("A changed warning");
    expect(findingMessage(text, "future_code")).toBe(text);
    expect(findingMessage('Current header "a exports as b" exports as "c"; the source header was "d".', "imported_current_header"))
      .toBe('The current column heading "a exports as b" will download as "c". The original heading was "d".');
    expect(findingMessage('Current header unquoted exports as unquoted; the source header was unquoted.', "imported_current_header"))
      .toBe('Current header unquoted exports as unquoted; the source header was unquoted.');
  });
  it("discloses ordering, defaults, omissions and blanks without changing a finding", () => {
    const message = "Surviving source columns and rows retain source order and identity-bound presentation. Added columns and rows append in current canonical order with default presentation; removed columns and deleted rows are omitted. Blank optional values are empty cells.";
    expect(findingMessage(message, "imported_current_structure")).toBe("Existing columns and rows keep their original order and formatting. New columns and rows are added at the end with default formatting. Removed columns and rows are left out. Blank cells stay empty.");
    expect(findingMessage(message + " Changed.", "imported_current_structure")).toBe(message + " Changed.");
  });
});
