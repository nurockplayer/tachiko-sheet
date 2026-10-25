import type { SheetShellProps, ViewWitness } from "../contracts.js";

/** Read only existing save/currentness evidence; never create a save receipt. */
export function savedCloseIsConfirmed(
  savedView: ViewWitness,
  state: Pick<SheetShellProps, "view" | "saveStatus" | "dirty" | "currentness">,
  hasDraft: boolean,
): boolean {
  return state.saveStatus === "saved" && !state.dirty && !hasDraft && state.currentness === "current" &&
    state.view?.occurrence === savedView.occurrence && state.view.revision === savedView.revision;
}

/**
 * The Save a copy dialog names why the copy was not created. A producer
 * refusal is shown with Work's own code and message; the name hint belongs
 * only to a real duplicate-name conflict. Keeping the reason next to the
 * error is what stops the dialog from hiding a Work refusal behind "the name
 * is still here", which invited pointless retries.
 */
export function copyFailureReason(name: string, error: unknown): string {
  const failure = (error as { failure?: { code?: unknown; message?: unknown } } | null)?.failure;
  if (failure && (typeof failure.code === "string" || typeof failure.message === "string")) {
    const detail = typeof failure.message === "string" && failure.message.trim().length > 0
      ? failure.message.trim() : "Work did not describe the refusal.";
    const code = typeof failure.code === "string" && failure.code.length > 0 ? ` (${failure.code})` : "";
    return `The copy “${name}” was not created. Work refused it${code}: ${detail}`;
  }
  if (error instanceof DOMException && error.name === "ConstraintError") {
    return `The copy “${name}” was not created. The name is still here; adjust it and try again.`;
  }
  if (error instanceof Error && error.message.length > 0) {
    return `The copy “${name}” was not created. (Details: ${error.message})`;
  }
  return `The copy “${name}” was not created.`;
}

/** Plain reason shown beside a disabled "Save a copy…" in the unsaved-work Close dialog. */
export function closeSaveUnavailableReason(
  state: Pick<SheetShellProps, "saveStatus" | "currentness"> & { busy: boolean; workFileSaveUnavailableReason?: string | null },
  hasDraft: boolean,
): string | null {
  if (state.workFileSaveUnavailableReason) return state.workFileSaveUnavailableReason;
  if (hasDraft) return "Keep editing to finish or cancel the unfinished edits before saving a copy.";
  if (state.currentness === "unknown") return "This work could not be confirmed. Keep editing, then refresh before saving a copy.";
  if (state.currentness === "pending") return "These values are still being updated. Keep editing and wait for confirmation before saving a copy.";
  if (state.saveStatus === "saving" || state.busy) return "Another action is still finishing. Wait for it before saving a copy.";
  return null;
}
