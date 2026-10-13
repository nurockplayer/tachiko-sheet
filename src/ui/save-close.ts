import { WORK_FILE_SAVE_UNAVAILABLE } from "../application/work-file.js";
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

/** Plain reason shown beside a disabled "Save a copy…" in the unsaved-work Close dialog. */
export function closeSaveUnavailableReason(
  state: Pick<SheetShellProps, "saveStatus" | "currentness"> & { busy: boolean; openedFromWorkFile?: boolean },
  hasDraft: boolean,
): string | null {
  if (state.openedFromWorkFile) return WORK_FILE_SAVE_UNAVAILABLE;
  if (hasDraft) return "Keep editing to finish or cancel the unfinished edits before saving a copy.";
  if (state.currentness === "unknown") return "This work could not be confirmed. Keep editing, then refresh before saving a copy.";
  if (state.currentness === "pending") return "These values are still being updated. Keep editing and wait for confirmation before saving a copy.";
  if (state.saveStatus === "saving" || state.busy) return "Another action is still finishing. Wait for it before saving a copy.";
  return null;
}
