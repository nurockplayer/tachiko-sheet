import type { InteropMetadata, NewTableColumn, RowCommandOutcome, ScalarEdit, SheetShellProps, ViewWitness, WorkbookView } from "../contracts.js";
import { newColumnInput } from "./column-requiredness.js";
import { canRenameColumns, IMPORTED_RENAME_UNAVAILABLE } from "./column-rename-availability.js";

export type ColumnDialogState = ViewWitness & { collection: string; rowEntities: string[] } & (
  | { kind: "add" }
  | { kind: "rename" | "remove"; field: string; name: string }
);
export interface ColumnDraft { name: string; fieldType: NewTableColumn["field_type"]; fill: string; required?: boolean; fillExisting?: boolean }
export function initialColumnDraft(state: ColumnDialogState): ColumnDraft {
  return { name: state.kind === "add" ? "" : state.name, fieldType: "text", fill: "", required: false, fillExisting: false };
}
/** Presence/choice only. Work owns parsing, name admission and dependency checks. */
export function fillChoiceRequired(type: NewTableColumn["field_type"], rowCount: number, fill: string): boolean {
  return rowCount > 0 && type !== "text" && fill === "";
}
export function columnFill(draft: ColumnDraft): ScalarEdit | null {
  switch (draft.fieldType) {
    case "number": return { kind: "number", input: draft.fill };
    case "date": return { kind: "date", value: draft.fill };
    case "boolean": return draft.fill === "yes" ? { kind: "boolean", value: true } : draft.fill === "no" ? { kind: "boolean", value: false } : null;
    case "text": return { kind: "text", value: draft.fill };
  }
}

/** Final dispatch guard uses the current table/metadata, even for an older dialog. */
export async function submitColumnIntent(state: ColumnDialogState, draft: ColumnDraft, context:
  Pick<SheetShellProps, "onAddColumn" | "onRenameColumn" | "onRemoveColumn"> & {
    table: WorkbookView["table"] | null; metadata: InteropMetadata | null; explicitDisplayNames?: boolean;
  }): Promise<RowCommandOutcome> {
  if (state.kind === "rename") {
    if (!canRenameColumns(context.table, context.metadata, context.explicitDisplayNames)) return { kind: "refused", message: IMPORTED_RENAME_UNAVAILABLE };
    if (context.onRenameColumn) return context.onRenameColumn(state, state.collection, state.field, draft.name);
  }
  if (state.kind === "remove" && context.onRemoveColumn) return context.onRemoveColumn(state, state.collection, state.field);
  const required = newColumnInput({ name: draft.name, field_type: draft.fieldType, required: draft.required }).required!;
  const needsFill = required || draft.fillExisting === true;
  const input = needsFill ? columnFill(draft) : null;
  if (state.kind === "add" && context.onAddColumn && (!needsFill || input || state.rowEntities.length === 0)) {
    return context.onAddColumn(state, state.collection, draft.name, draft.fieldType, needsFill ? state.rowEntities.map(entity => ({ entity, input: input! })) : undefined, required);
  }
  return { kind: "refused", message: "Choose a fill value before adding this column." };
}
export function columnRefusal(message: string, fieldType?: string): string {
  if (fieldType === "number") return "Enter a number for the existing rows, such as 12.5. Nothing was changed.";
  if (fieldType === "date") return "Enter a valid date in YYYY-MM-DD format. Nothing was changed.";
  if (/still referenced by a formula or saved definition/i.test(message)) return "This column is used by a formula or cross-table summary. Remove those references before removing the column. Nothing was changed.";
  if (/at least one column/i.test(message)) return "Keep at least one column in this table. Nothing was changed.";
  if (/duplicate_display_name|already.*(?:used|name)|distinct display names|names must be unique/i.test(message)) return "This name is already used. Choose a distinct column name. Nothing was changed.";
  if (/needs a name|empty_display_name|empty|blank|only.*spaces/i.test(message)) return "Enter a column name that isn't only spaces. Nothing was changed.";
  if (/stale.*revision|revision.*(?:mismatch|stale)/i.test(message)) return "This table changed before the request could be applied. Refresh and review it before trying again. Nothing was changed.";
  if (/names must fit within/i.test(message)) return "This column name is too long. Choose a shorter name. Nothing was changed.";
  if (/names cannot contain controls/i.test(message)) return "Remove control characters or line breaks from the column name. Nothing was changed.";
  if (/column is unavailable|initializers must name|every existing row needs/i.test(message)) return "The table changed or this column is no longer available. Refresh and review it before trying again. Nothing was changed.";
  if (/capacity is exhausted/i.test(message)) return "This table has reached its column limit. Nothing was changed.";
  return message.replace("The row change was not applied.", "The column change was not applied.");
}
