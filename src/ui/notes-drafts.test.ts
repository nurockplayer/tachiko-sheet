import { describe, expect, it } from "vitest";
import type { WorkbookView } from "../contracts.js";
import { rebindNotesDrafts, type NotesDraft } from "./notes-drafts.js";

const view = (revision: string, notes: string) => ({
  occurrence: "o1",
  revision,
  table: {
    columns: [{ id: "f-notes", key: "notes" }],
    rows: [{ id: "e1", fields: [{ target: { entity: "e1", field: "f-notes" }, key: "notes", stored: { kind: "text", value: notes }, editable_scalar: "text" }] }],
  },
}) as unknown as WorkbookView;
const draft = (overrides: Partial<NotesDraft> = {}): NotesDraft => ({ occurrence: "o1", revision: "r1", entity: "e1", value: "mine", base: "old", ...overrides });

describe("notes draft rebinding", () => {
  it("rebinds when the notes are unchanged by the publication", () => {
    expect(rebindNotesDrafts([draft()], view("r2", "old"))[0]!.revision).toBe("r2");
  });
  it("keeps the draft unbound when the notes changed underneath", () => {
    const drafts = [draft()];
    expect(rebindNotesDrafts(drafts, view("r2", "someone else"))).toBe(drafts);
  });
  it("ignores other occurrences and already-bound drafts", () => {
    const drafts = [draft({ occurrence: "o2" }), draft({ revision: "r2" })];
    expect(rebindNotesDrafts(drafts, view("r2", "old"))).toBe(drafts);
    expect(rebindNotesDrafts(drafts, null)).toBe(drafts);
  });
});
