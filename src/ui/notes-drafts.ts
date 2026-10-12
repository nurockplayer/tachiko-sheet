/**
 * An unapplied Brief notes edit. It is applicable only while the committed
 * notes are still exactly `base`, the text the user started from (or last
 * explicitly kept). It never silently applies over notes that changed.
 */
export interface NotesDraft {
  occurrence: string;
  entity: string;
  value: string;
  /** Committed notes text the draft is written against. */
  base: string;
}

export function isNotesDraftBound(draft: NotesDraft | undefined, committed: string): boolean {
  return draft !== undefined && draft.base === committed;
}

function sameTarget(a: NotesDraft, b: Pick<NotesDraft, "occurrence" | "entity">): boolean {
  return a.occurrence === b.occurrence && a.entity === b.entity;
}

/**
 * Records typing into the notes field. An existing draft keeps its base, so a
 * draft whose notes changed underneath stays stale until the user keeps it;
 * typing the committed text back removes the draft.
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
  return [...remaining, { ...target, value, base: existing?.base ?? committed }];
}

/**
 * After `applied` (the draft that was submitted) is accepted as `value`, drop
 * it. If the user kept typing while the apply was pending, that newer draft is
 * now written against the applied text.
 */
export function notesDraftAfterApply(drafts: NotesDraft[], applied: NotesDraft, value: string): NotesDraft[] {
  return drafts.flatMap((draft) => {
    if (draft === applied) return [];
    if (!sameTarget(draft, applied) || draft.base !== applied.base) return [draft];
    return draft.value === value ? [] : [{ ...draft, base: value }];
  });
}
