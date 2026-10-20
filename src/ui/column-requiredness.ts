import type { NewTableColumn, WorkbookView } from "../contracts.js";

export const REQUIRED_HELP = "Required means a value must be present. Empty Text counts as present.";
export const REQUIRED_TYPE_NOTE = "These columns currently need a value in every row.";

export function supportsOptional(type: string): boolean {
  return type === "text" || type === "number";
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
  if (table.revision !== revision || table.rows.length !== table.collection.entity_count ||
      new Set(table.rows.map(row => row.id)).size !== table.collection.entity_count) return null;
  // Missing blank_fields means [] in the public protocol. Each row must still
  // cover the target exactly once, with either a blank ID or a present field.
  if (table.rows.some(row => Number((row.blank_fields ?? []).includes(field)) +
      row.fields.filter(value => value.target.field === field && value.target.entity === row.id && !value.blank).length !== 1)) return null;
  return table.rows.filter(row => row.blank_fields?.includes(field)).length;
}

export function requirednessRefusal(message: string, count: number | null, name: string): string {
  // Only use our projection count for Work's missing-value refusal, never for
  // unrelated failures such as a stale witness, save preflight or transport.
  if (/blank|absent|missing.*(?:value|field)|required.*(?:present|value)|presence|field .* does not exist/i.test(message)) {
    return count !== null && count > 0
      ? `${count} ${count === 1 ? "row in" : "rows in"} ${name} ${count === 1 ? "is" : "are"} blank. Fill ${count === 1 ? "it" : "them"} before requiring a value.`
      : `Fill the blank cells in ${name} before requiring a value.`;
  }
  return message;
}
