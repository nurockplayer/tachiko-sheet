import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import type { WorkbookView } from "../contracts.js";

export type TableRow = WorkbookView["table"]["rows"][number];
export type TableColumn = WorkbookView["table"]["columns"][number];

/** Entity identity used by test markers and FieldTargets for one projected row. */
export function rowEntity(row: TableRow): string {
  return row.fields[0]?.target.entity ?? row.id;
}

/**
 * Columns as projected by the core. When a projection carries no column list,
 * the first row's actual field order is used rather than an invented schema.
 */
export function tableColumns(table: WorkbookView["table"]): TableColumn[] {
  if (table.columns.length > 0) return table.columns;
  const first = table.rows[0];
  return (first?.fields ?? []).map((field) => ({
    id: field.target.field,
    key: field.target.field,
    field_type: "unknown",
  }));
}

export function fieldForColumn(row: TableRow, columnId: string): FieldProjection | null {
  return row.fields.find((field) => field.target.field === columnId) ?? null;
}

/** The notes column is the projected column whose key is "notes", not a guessed id. */
export function notesColumn(columns: TableColumn[]): TableColumn | null {
  return columns.find((column) => column.key === "notes") ?? null;
}

export function notesFieldFor(row: TableRow, columns: TableColumn[]): FieldProjection | null {
  const column = notesColumn(columns);
  return column ? fieldForColumn(row, column.id) : null;
}

export function cellKey(entity: string, field: string): string {
  return `${entity}\u0000${field}`;
}
