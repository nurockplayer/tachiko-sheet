import { describe, expect, it } from "vitest";
import { isNotesDraftBound, notesDraftAfterApply, upsertNotesDraft, type NotesDraft } from "./notes-drafts.js";

const target = { occurrence: "o1", entity: "e1" };
const draft = (overrides: Partial<NotesDraft> = {}): NotesDraft => ({ ...target, value: "mine", base: "old", ...overrides });

describe("notes drafts", () => {
  it("is applicable only while the committed notes equal its base", () => {
    expect(isNotesDraftBound(draft(), "old")).toBe(true);
    expect(isNotesDraftBound(draft(), "someone else")).toBe(false);
    expect(isNotesDraftBound(undefined, "old")).toBe(false);
  });

  it("starts a draft against the committed notes", () => {
    expect(upsertNotesDraft([], target, "mine", "old")).toEqual([draft()]);
  });

  it("keeps a stale draft's base while typing (#158 P1)", () => {
    const next = upsertNotesDraft([draft()], target, "mine, more", "changed underneath");
    expect(next).toEqual([draft({ value: "mine, more" })]);
    expect(isNotesDraftBound(next[0], "changed underneath")).toBe(false);
  });

  it("drops the draft when it matches the committed notes and leaves other targets alone", () => {
    const other = draft({ entity: "e2" });
    expect(upsertNotesDraft([other, draft()], target, "old", "old")).toEqual([other]);
  });

  it("rebases typing made while an apply was pending onto the applied text", () => {
    const applied = draft();
    const newer = draft({ value: "mine, typed while pending" });
    expect(notesDraftAfterApply([applied], applied, "mine")).toEqual([]);
    expect(notesDraftAfterApply([newer], applied, "mine")).toEqual([draft({ value: "mine, typed while pending", base: "mine" })]);
    expect(notesDraftAfterApply([draft({ value: "mine" })], applied, "mine")).toEqual([]);
  });

  it("does not rebase a draft that was explicitly kept against other notes", () => {
    const kept = draft({ value: "kept", base: "newer" });
    expect(notesDraftAfterApply([kept], draft(), "mine")).toEqual([kept]);
  });
});
