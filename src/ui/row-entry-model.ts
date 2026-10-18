import type { WorkbookView } from "../contracts.js";

type Column = WorkbookView["table"]["columns"][number];
export interface RowDraft { occurrence: string; collection: string; values: Record<string, string>; needsReview?: boolean }
// UI-only identity; never sent as an entity to Work.
export const DRAFT_ROW = "sheet:draft-row";

/** Presence only: Work remains the authority for scalar validity. */
export function firstMissingDraftColumn(columns: Column[], values: Record<string, string>): Column | undefined {
  return columns.find(column => column.field_type === "boolean"
    ? values[column.id] !== "true" && values[column.id] !== "false"
    : column.field_type !== "text" && (values[column.id] ?? "").trim() === "");
}

export function draftKeyAction(key: string, shift: boolean, last: boolean): "publish" | "next" | "previous" | null {
  if (key === "Enter") return shift ? "previous" : "publish";
  if (key === "Tab") return shift ? "previous" : last ? "publish" : "next";
  return null;
}

/** A type or value shared by several columns cannot identify one bad cell. */
export function draftRefusal(columns: Column[], values: Record<string, string>, fieldType: string | undefined, message: string, name: (column: Column) => string): { message: string; fields?: string[] } {
  const typed = columns.filter(column => column.field_type === fieldType);
  const matching = typed.filter(column => message.includes(`'${values[column.id] ?? ""}'`));
  const column = matching.length === 1 ? matching[0] : typed.length === 1 ? typed[0] : undefined;
  if (!column) return { message: "This row could not be added. Check its values and try again." };
  const requirement = fieldType === "number" ? "a number" : fieldType === "date" ? "a date in YYYY-MM-DD format" : fieldType === "boolean" ? "Yes or No" : "a valid value";
  return { message: `${name(column)} needs ${requirement}.`, fields: [column.id] };
}
