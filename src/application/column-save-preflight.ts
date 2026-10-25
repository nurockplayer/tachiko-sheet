import type { ViewWitness } from "../contracts.js";

export const COLUMN_SAVE_UNAVAILABLE = "Column changes aren't available for this work yet, because it couldn't then be saved. Nothing was changed.";
export const COLUMN_SAVE_STALE = "This work changed while checking whether it could be saved. Refresh and review it before changing columns. Nothing was changed.";
export const DUPLICATE_SAVE_UNAVAILABLE = "This table can't be duplicated yet, because the copy couldn't then be saved. Nothing was changed.";
export const DUPLICATE_SAVE_STALE = "This work changed while checking whether it could be saved. Refresh and review it before duplicating a table. Nothing was changed.";

/** Admission evidence only: the producer's current portable export decides support. */
export function columnSavePreflightDecision(
  requested: ViewWitness,
  current: ViewWitness | null,
  exportedRevision: string | null,
): { allowed: true } | { allowed: false; message: string } {
  if (exportedRevision === null) return { allowed: false, message: COLUMN_SAVE_UNAVAILABLE };
  if (!current || current.occurrence !== requested.occurrence || current.revision !== requested.revision || exportedRevision !== requested.revision) {
    return { allowed: false, message: COLUMN_SAVE_STALE };
  }
  return { allowed: true };
}

/** A duplicate is saved through the same portable route as authored schema. */
export function duplicateSavePreflightDecision(
  requested: ViewWitness,
  current: ViewWitness | null,
  exportedRevision: string | null,
): { allowed: true } | { allowed: false; message: string } {
  if (exportedRevision === null) return { allowed: false, message: DUPLICATE_SAVE_UNAVAILABLE };
  if (!current || current.occurrence !== requested.occurrence || current.revision !== requested.revision || exportedRevision !== requested.revision) {
    return { allowed: false, message: DUPLICATE_SAVE_STALE };
  }
  return { allowed: true };
}
