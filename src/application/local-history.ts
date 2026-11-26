import type { PublicationProjection } from "../../public/core-kit/experimental-client.js";
import type { WorkbookView } from "../contracts.js";

export const KNOWN_HISTORY_LIMIT = 64;

type HistoryDirection = "undo" | "redo";
export type ViewHistoryChange = (direction: HistoryDirection) => void;
type HistoryStep = "work" | ViewHistoryChange;

export interface LocalHistorySnapshot {
  occurrence: string | null;
  revision: string | null;
  undo: readonly HistoryStep[];
  redo: readonly HistoryStep[];
}

export function emptyLocalHistory(view?: WorkbookView | null): LocalHistorySnapshot {
  return { occurrence: view?.occurrence ?? null, revision: view?.revision ?? null, undo: [], redo: [] };
}

export function recordViewHistory(current: LocalHistorySnapshot, change: ViewHistoryChange): LocalHistorySnapshot {
  return { ...current, undo: [...current.undo, change], redo: [] };
}

function moveHistoryStep(current: LocalHistorySnapshot, direction: HistoryDirection): LocalHistorySnapshot {
  const step = current[direction].at(-1);
  if (!step) throw new Error(`No local ${direction} step to move.`);
  const opposite = direction === "undo" ? "redo" : "undo";
  return { ...current, [direction]: current[direction].slice(0, -1), [opposite]: [...current[opposite], step] };
}

export function applyViewHistory(current: LocalHistorySnapshot, direction: HistoryDirection): LocalHistorySnapshot | null {
  const step = current[direction].at(-1);
  if (typeof step !== "function") return null;
  step(direction);
  return moveHistoryStep(current, direction);
}

function sameOccurrencePublication(
  current: LocalHistorySnapshot,
  view: WorkbookView,
  publication: PublicationProjection,
): boolean {
  return current.occurrence === view.occurrence && current.revision === publication.base_revision &&
    publication.resulting_revision === view.revision && view.revision !== publication.base_revision;
}

/** Discard the local timeline when its Work history can no longer be confirmed. */
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
  // Once Work evicts its oldest step, the timeline cannot cross that step.
  const atCapacity = current.undo.filter(step => step === "work").length === KNOWN_HISTORY_LIMIT;
  const undo = atCapacity ? current.undo.slice(current.undo.indexOf("work") + 1) : current.undo;
  return {
    occurrence: view.occurrence,
    revision: view.revision,
    undo: [...undo, "work"],
    redo: [],
  };
}

export function confirmHistoryCommand(
  current: LocalHistorySnapshot,
  view: WorkbookView,
  publication: PublicationProjection,
  direction: HistoryDirection,
): LocalHistorySnapshot {
  if (!sameOccurrencePublication(current, view, publication)) return emptyLocalHistory(view);
  return { ...moveHistoryStep(current, direction), revision: view.revision };
}
