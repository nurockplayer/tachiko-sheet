import type { PublicationProjection } from "../../public/core-kit/experimental-client.js";
import type { WorkbookView } from "../contracts.js";

export const KNOWN_HISTORY_LIMIT = 64;

export interface LocalHistorySnapshot {
  occurrence: string | null;
  revision: string | null;
  undoCount: number;
  redoCount: number;
}

export function emptyLocalHistory(view?: WorkbookView | null): LocalHistorySnapshot {
  return { occurrence: view?.occurrence ?? null, revision: view?.revision ?? null, undoCount: 0, redoCount: 0 };
}

function sameOccurrencePublication(
  current: LocalHistorySnapshot,
  view: WorkbookView,
  publication: PublicationProjection,
): boolean {
  return current.occurrence === view.occurrence && current.revision === publication.base_revision &&
    publication.resulting_revision === view.revision && view.revision !== publication.base_revision;
}

/** Disposable admitted-tail knowledge only; this never stores semantic values or targets. */
export function observeLocalHistory(current: LocalHistorySnapshot, view: WorkbookView): LocalHistorySnapshot {
  if (current.occurrence === view.occurrence && current.revision === view.revision) return current;
  return emptyLocalHistory(view);
}

export function confirmScalarHistory(
  current: LocalHistorySnapshot,
  view: WorkbookView,
  publication: PublicationProjection,
  admitted: boolean,
): LocalHistorySnapshot {
  if (!sameOccurrencePublication(current, view, publication) || !admitted) return emptyLocalHistory(view);
  return {
    occurrence: view.occurrence,
    revision: view.revision,
    undoCount: Math.min(KNOWN_HISTORY_LIMIT, current.undoCount + 1),
    redoCount: 0,
  };
}

export function confirmHistoryCommand(
  current: LocalHistorySnapshot,
  view: WorkbookView,
  publication: PublicationProjection,
  direction: "undo" | "redo",
): LocalHistorySnapshot {
  if (!sameOccurrencePublication(current, view, publication)) return emptyLocalHistory(view);
  return direction === "undo"
    ? { occurrence: view.occurrence, revision: view.revision, undoCount: Math.max(0, current.undoCount - 1), redoCount: current.redoCount + 1 }
    : { occurrence: view.occurrence, revision: view.revision, undoCount: Math.min(KNOWN_HISTORY_LIMIT, current.undoCount + 1), redoCount: Math.max(0, current.redoCount - 1) };
}
