import type { WorkbookView } from "../contracts.js";
import { seedTextOf } from "./field-display.js";
import { notesFieldFor, rowEntity, tableColumns } from "./projection-access.js";

/** An unapplied Brief notes edit, bound to the revision it was written against. */
export interface NotesDraft {
  occurrence: string;
  revision: string;
  entity: string;
  value: string;
  /** Committed notes text the draft started from. */
  base: string;
}

/**
 * After a publication in the same work, a draft whose notes are still exactly
 * the text it started from is rebound to the new revision. A draft whose notes
 * changed underneath stays unbound until the user explicitly keeps it.
 */
export function rebindNotesDrafts(drafts: NotesDraft[], view: WorkbookView | null): NotesDraft[] {
  if (!view) return drafts;
  const columns = tableColumns(view.table);
  let changed = false;
  const next = drafts.map((draft) => {
    if (draft.occurrence !== view.occurrence || draft.revision === view.revision) return draft;
    const row = view.table.rows.find((candidate) => rowEntity(candidate) === draft.entity);
    const field = row ? notesFieldFor(row, columns) : null;
    if (!field || seedTextOf(field) !== draft.base) return draft;
    changed = true;
    return { ...draft, revision: view.revision };
  });
  return changed ? next : drafts;
}
