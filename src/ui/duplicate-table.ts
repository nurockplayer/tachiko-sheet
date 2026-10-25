import kitManifest from "../../public/core-kit/artifact-manifest.json";
import type { RowCommandOutcome } from "../contracts.js";
import { refusalsFor } from "./name-refusals.js";

// A rollback kit without this method must not offer the command; Work owns
// admission, so Sheet only starts from a name it can still refuse.
export const supportsDuplicateTable = kitManifest.capabilities?.includes("duplicateCollection") ?? false;

/** Starting text only: Work decides whether the name is admitted. */
export function suggestedDuplicateName(name: string): string {
  return `${name} copy`;
}

/**
 * Enter starts a duplicate only from a typed name. An IME confirmation key
 * belongs to the composition, so it neither duplicates nor falls through.
 */
export function duplicateNameEnterAction(event: { key: string; composing?: boolean; keyCode?: number }): "submit" | null {
  if (event.composing === true || event.keyCode === 229) return null;
  return event.key === "Enter" ? "submit" : null;
}

/** Only a confirmed copy becomes the active table, so only then does the Table panel take focus. */
export function duplicateLanding(result: RowCommandOutcome): { switchToTable: boolean } {
  return { switchToTable: result.kind === "confirmed" };
}

export interface DuplicateSettlement {
  close: boolean;
  /** The one refusal line to show inline; the dialog stays open. */
  error: string | null;
}

/**
 * A duplicate either publishes (closing the dialog) or refuses. Work's typed
 * name failure is shown with the same sentences as New table; any other
 * refusal keeps Work's/the application's message as it arrived.
 */
export function duplicateOutcomeSettlement(result: RowCommandOutcome): DuplicateSettlement {
  if (result.kind !== "refused") return { close: true, error: null };
  const refusals = result.nameFailures?.length ? refusalsFor(result.nameFailures) : null;
  return {
    close: false,
    error: refusals && refusals.table.length > 0 ? refusals.table.join(" ") : result.message,
  };
}
