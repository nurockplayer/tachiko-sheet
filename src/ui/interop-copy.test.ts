import { describe, expect, it } from "vitest";
import { findingColumnTables, findingCategoryLabel, findingLocation, findingMessage } from "./interop-copy.js";

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

describe("native table download disclosures", () => {
  it("words the native export findings without engine vocabulary", () => {
    for (const message of [
      "Native scalar output: at most 32 collections, 32 columns, 128 rows per collection, 1,024 total rows, 8 MiB encoded bytes and 24 MiB expanded XLSX. The general incoming profile remains separate (4 sheets, 16 columns, 64 rows); its restricted Text-capacity exception is unchanged. Larger output is not promised reimportable.",
      "Formula cells export their current computed Number values; formula definitions are not written to the spreadsheet. Retain the Tachiko source to keep the formulas.",
      "Session Undo/Redo history is excluded.",
      "Sheet presentation, view sorting/filtering and per-cell formatting are excluded; Dates use yyyy-mm-dd.",
    ]) {
      const worded = findingMessage(message);
      expect(worded).not.toBe(message);
      expect(worded).not.toMatch(/collection|scalar|MiB|Tachiko source|Session/);
      expect(worded).not.toBe("");
    }
    expect(findingMessage("Formula cells export their current computed Number values; formula definitions are not written to the spreadsheet. Retain the Tachiko source to keep the formulas."))
      .toBe("Formula cells download as their current values, not as formulas. Save a copy or download the work file (.ro) to keep the formulas.");
  });

  it("finds the tables whose columns findings name, and words a rule that is not kept", () => {
    expect(findingColumnTables([
      { location: "collection a/field f1" }, { location: "collection b/header/field f2" }, { location: "c/f3" },
      { location: "collection d" }, { location: "workbook" }, { location: "collection e/entity r1" }, {},
    ])).toEqual(["a", "b", "c"]);
    expect(findingMessage("Field constraint (allowed range: 0 to 10000) has no native spreadsheet mapping; its values export unchanged and the spreadsheet does not validate them.", "native_tables_field_constraint_excluded"))
      .toBe("Its rule (allowed range: 0 to 10000) is not kept. The values download as they are, and the spreadsheet will not check them.");
  });

  it("words excluded tables and renamed headings without keys", () => {
    expect(findingMessage('CSV excludes collection "Orders" (orders_key); only the requested collection is exported.', "native_tables_csv_collection_excluded"))
      .toBe("CSV downloads only the selected table, so “Orders” is left out.");
    expect(findingMessage('Header "Total (€)" mapped to "Total (€) 2"; headers are never truncated.', "native_tables_header_name"))
      .toBe("The column heading “Total (€)” downloads as “Total (€) 2”.");
  });

  it("names the sheet a table downloads as, and keeps an unreadable message verbatim", () => {
    expect(findingMessage('Worksheet name "Invoices" mapped to "Invoices".', "native_tables_worksheet_name")).toBe("The table downloads as the sheet “Invoices”.");
    expect(findingMessage('Worksheet name "Q3: \\"plan\\"" mapped to "Q3 plan".', "native_tables_worksheet_name"))
      .toBe("The table “Q3: \"plan\"” downloads as the sheet “Q3 plan”, because spreadsheet sheet names are limited.");
    expect(findingMessage("Worksheet name changed.", "native_tables_worksheet_name")).toBe("Worksheet name changed.");
  });

  it("shows a table's name instead of its id, and nothing for the whole workbook", () => {
    const table = (id: string) => (id === "native_table_schema_0002_x" ? "Invoices" : id === "import_0001" ? "january-sales" : null);
    expect(findingLocation("native_table_schema_0002_x", table)).toBe("Invoices");
    expect(findingLocation("workbook", table)).toBeNull();
    expect(findingLocation(undefined, table)).toBeNull();
    expect(findingLocation("Sheet1!B2", table)).toBe("Sheet1!B2");
    const column = (collection: string, field: string) => collection === "native_table_schema_0002_x" && field === "f27" ? "Item" : null;
    expect(findingLocation("collection native_table_schema_0002_x/field f27/column", table, column)).toBe("Invoices, column “Item”");
    expect(findingLocation("collection native_table_schema_0002_x/header/field f9", table, column)).toBe("Invoices, a column");
    expect(findingLocation("collection native_table_schema_0002_x/entity e1", table)).toBe("Invoices, a row");
    // An imported table is named as the table list names it (its source name).
    expect(findingLocation("collection import_0001/sheet-name", table)).toBe("january-sales, sheet name");
    expect(findingLocation("collection gone_id", table)).toBe("A table");
    expect(findingLocation("native_table_schema_0002_x/f27", table, column, "native_tables_header_name")).toBe("Invoices, column “Item”");
    expect(findingLocation("expenses", table, column, "native_tables_saved_grouped_sum_excluded")).toBeNull();
    expect(findingLocation("expenses", table, column, "imported_sheet_note")).toBe("expenses");
  });
});
