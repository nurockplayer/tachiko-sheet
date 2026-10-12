import { describe, expect, it } from "vitest";
import type { WorkbookView } from "../contracts.js";
import { dropAppliedNotesDraft, isNotesDraftBound, keepNotesDraft, markNotesConflicts, upsertNotesDraft, type NotesDraft } from "./notes-drafts.js";

const target = { occurrence: "o1", entity: "e1" };
const draft = (overrides: Partial<NotesDraft> = {}): NotesDraft => ({ ...target, value: "mine", base: "old", conflicted: false, ...overrides });
const view = (notes: string, occurrence = "o1") => ({
  occurrence,
  revision: "r",
  table: {
    columns: [{ id: "f-notes", key: "notes" }],
    rows: [{ id: "e1", fields: [{ target: { entity: "e1", field: "f-notes" }, key: "notes", stored: { kind: "text", value: notes }, editable_scalar: "text" }] }],
  },
}) as unknown as WorkbookView;

describe("notes drafts", () => {
  it("is applicable only while unconflicted and the committed notes equal its base", () => {
    expect(isNotesDraftBound(draft(), "old")).toBe(true);
    expect(isNotesDraftBound(draft(), "someone else")).toBe(false);
    expect(isNotesDraftBound(draft({ conflicted: true }), "old")).toBe(false);
    expect(isNotesDraftBound(undefined, "old")).toBe(false);
  });

  it("starts a draft against the committed notes", () => {
    expect(upsertNotesDraft([], target, "mine", "old")).toEqual([draft()]);
  });

  it("keeps a stale draft's base and conflict while typing (#158 P1)", () => {
    const next = upsertNotesDraft([draft({ conflicted: true })], target, "mine, more", "changed underneath");
    expect(next).toEqual([draft({ value: "mine, more", conflicted: true })]);
    expect(isNotesDraftBound(next[0], "changed underneath")).toBe(false);
  });

  it("drops the draft when it matches the committed notes and leaves other targets alone", () => {
    const other = draft({ entity: "e2" });
    expect(upsertNotesDraft([other, draft()], target, "old", "old")).toEqual([other]);
  });

  it("marks a conflict when the notes change underneath, and it survives a change back", () => {
    const drafts = [draft()];
    expect(markNotesConflicts(drafts, view("old"))).toBe(drafts);
    const conflicted = markNotesConflicts(drafts, view("grid edit"));
    expect(conflicted).toEqual([draft({ conflicted: true })]);
    expect(markNotesConflicts(conflicted, view("old"))).toBe(conflicted);
    expect(isNotesDraftBound(conflicted[0], "old")).toBe(false);
  });

  it("drops a draft once the committed notes equal its text", () => {
    expect(markNotesConflicts([draft(), draft({ entity: "e2" })], view("mine"))).toEqual([draft({ entity: "e2" })]);
    expect(markNotesConflicts([draft({ conflicted: true })], view("mine"))).toEqual([]);
  });

  it("drops the applied draft even after it was replaced by a conflict mark", () => {
    const applied = draft();
    const other = draft({ entity: "e2" });
    expect(dropAppliedNotesDraft([draft({ conflicted: true }), other], applied)).toEqual([other]);
    expect(dropAppliedNotesDraft([draft({ value: "different" })], applied)).toEqual([draft({ value: "different" })]);
  });

  it("ignores other occurrences and a missing view", () => {
    const drafts = [draft()];
    expect(markNotesConflicts(drafts, view("grid edit", "o2"))).toBe(drafts);
    expect(markNotesConflicts(drafts, null)).toBe(drafts);
  });

  it("only an explicit keep rebases a conflicted draft", () => {
    const kept = keepNotesDraft(draft({ conflicted: true }), "grid edit");
    expect(kept).toEqual(draft({ base: "grid edit" }));
    expect(isNotesDraftBound(kept, "grid edit")).toBe(true);
  });
});
