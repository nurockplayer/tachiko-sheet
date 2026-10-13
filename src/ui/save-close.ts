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
