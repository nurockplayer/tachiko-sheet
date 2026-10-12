import type { WorkbookView } from "../contracts.js";
import { seedTextOf } from "./field-display.js";
import { notesFieldFor, rowEntity, tableColumns } from "./projection-access.js";

/**
 * An unapplied Brief notes edit. It is applicable only while the committed
 * notes are exactly `base`, the text the user started from (or last explicitly
 * kept), and no different committed notes have been observed since. It never
 * silently applies over notes that changed.
 */
export interface NotesDraft {
  occurrence: string;
  entity: string;
  value: string;
  /** Committed notes text the draft is written against. */
  base: string;
  /** Different committed notes were observed; only an explicit keep clears it. */
  conflicted: boolean;
}

export function isNotesDraftBound(draft: NotesDraft | undefined, committed: string): boolean {
  return draft !== undefined && !draft.conflicted && draft.base === committed;
}

function sameTarget(a: NotesDraft, b: Pick<NotesDraft, "occurrence" | "entity">): boolean {
  return a.occurrence === b.occurrence && a.entity === b.entity;
}

/**
 * Records typing into the notes field. An existing draft keeps its base and
 * conflict, so a stale draft stays stale until the user keeps it; typing the
 * committed text back removes the draft.
 */
export function upsertNotesDraft(
  drafts: NotesDraft[],
  target: Pick<NotesDraft, "occurrence" | "entity">,
  value: string,
  committed: string,
): NotesDraft[] {
  const existing = drafts.find((draft) => sameTarget(draft, target));
  const remaining = drafts.filter((draft) => !sameTarget(draft, target));
  if (value === committed) return remaining;
  return [...remaining, { ...target, value, base: existing?.base ?? committed, conflicted: existing?.conflicted ?? false }];
}

/** Rebases a draft onto the committed notes the user has reviewed. */
export function keepNotesDraft(draft: NotesDraft, committed: string): NotesDraft {
  return { ...draft, base: committed, conflicted: false };
}

/** Drops the draft that was applied as `applied.value`. */
export function dropAppliedNotesDraft(drafts: NotesDraft[], applied: NotesDraft): NotesDraft[] {
  return drafts.filter((draft) => !sameTarget(draft, applied) || draft.value !== applied.value);
}

/**
 * Marks drafts whose notes in this view differ from their base. The mark is
 * sticky: notes changing back to the base do not silently re-enable Apply.
 * A draft whose notes now equal its text has nothing left to apply.
 */
export function markNotesConflicts(drafts: NotesDraft[], view: WorkbookView | null): NotesDraft[] {
  if (!view) return drafts;
  const columns = tableColumns(view.table);
  let changed = false;
  const next = drafts.flatMap((draft) => {
    if (draft.occurrence !== view.occurrence) return [draft];
    const row = view.table.rows.find((candidate) => rowEntity(candidate) === draft.entity);
    const field = row ? notesFieldFor(row, columns) : null;
    if (!field) return [draft];
    const committed = seedTextOf(field);
    if (committed === draft.value) {
      changed = true;
      return [];
    }
    if (draft.conflicted || committed === draft.base) return [draft];
    changed = true;
    return [{ ...draft, conflicted: true }];
  });
  return changed ? next : drafts;
}
