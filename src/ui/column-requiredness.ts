import type { NewTableColumn, WorkbookView } from "../contracts.js";
import { rowSource } from "./row-source.js";

export const REQUIRED_HELP = "Required means a value must be present. Empty Text counts as present.";
export const REQUIRED_TYPE_NOTE = "These columns currently need a value in every row.";

/** Every scalar column may start blank (ADR-0045, Date and Yes/No since Work #598). */
export function supportsOptional(type: string): boolean {
  return type === "text" || type === "number" || type === "date" || type === "boolean";
}

/** Shape authoring intent explicitly; Work's omitted required flag means true. */
export function newColumnInput(column: NewTableColumn): NewTableColumn {
  return { name: column.name, field_type: column.field_type, required: !supportsOptional(column.field_type) || column.required === true };
}

export function canChangeRequiredness(table: WorkbookView["table"] | null, field: string): boolean {
  const column = table?.columns.find(column => column.id === field);
  return table?.native_table_profile === true && Boolean(column && supportsOptional(column.field_type));
}

/** Counts are presentation evidence only, never a local admission decision. */
export function completeBlankCount(table: WorkbookView["table"], field: string, revision: string): number | null {
  // Whole-table evidence: every projected row must be present and coherent.
  const rows = rowSource(table).allRowsForNow();
  if (table.revision !== revision || rows.length !== table.collection.entity_count ||
      new Set(rows.map(row => row.id)).size !== table.collection.entity_count) return null;
  // Missing blank_fields means [] in the public protocol. Each row must still
  // cover the target exactly once, with either a blank ID or a present field.
  if (rows.some(row => Number((row.blank_fields ?? []).includes(field)) +
      row.fields.filter(value => value.target.field === field && value.target.entity === row.id && !value.blank).length !== 1)) return null;
  return rows.filter(row => row.blank_fields?.includes(field)).length;
}

export function requirednessRefusal(message: string, refusalCode: string | undefined, count: number | null, name: string): string {
  // Work's typed `required_values_missing` carries its own blank count, which
  // the caller passes as `count`. The older `edit_rejected` path attributes the
  // refusal to blanks only when the complete current projection shows them.
  // Never infer it from message text: stale witnesses, save preflight or a
  // removed field keep their own message.
  if ((refusalCode !== "required_values_missing" && refusalCode !== "edit_rejected") || count === null || count < 1) return message;
  return `${count} ${count === 1 ? "row in" : "rows in"} ${name} ${count === 1 ? "is" : "are"} blank. Fill ${count === 1 ? "it" : "them"} before requiring a value.`;
}
