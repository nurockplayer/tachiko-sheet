import type { PublicationProjection } from "../../public/core-kit/experimental-client.js";
import type { NameFailure } from "../../public/core-kit/runtime/protocol.js";
import type { ConfirmedPublication, Currentness, FieldTarget, KeyedGroupedSumResult, SaveReceipt, SaveStatus, ScalarEdit, ViewWitness, WorkbookView } from "../contracts.js";
import { UnknownOperationOutcomeError, rowEntity } from "../contracts.js";
import { rowSource } from "../ui/row-source.js";
import { PublishedProjectionRecoveryError, SheetSessionError } from "../runtime/session.js";
import { confirmHistoryCommand, confirmScalarHistory, emptyLocalHistory, type LocalHistorySnapshot } from "../application/local-history.js";

type ResultSnapshot = { definitionIds: string[]; results: KeyedGroupedSumResult[] };
type TrackedCommand = { witness: ViewWitness; dispatch(): Promise<ConfirmedPublication> } & (
  | { kind: "scalar"; edit: ScalarEdit }
  | { kind: "rows"; retainedInput?: string }
  | { kind: "history"; direction: "undo" | "redo" }
);
export type MutationCommand = TrackedCommand
  | { kind: "cleanup"; witness: ViewWitness; dispatch(): Promise<WorkbookView> }
  | { kind: "summary"; witness: ViewWitness; dispatch(): Promise<{ publication: PublicationProjection }> };
export type MutationCompletion =
  | { kind: "published"; focusTarget: FieldTarget | null; addedEntities?: readonly string[] }
  | { kind: "known-publication-recovery" | "unknown-outcome" }
  | { kind: "refused"; message: string; fieldType?: "number" | "date"; refusalCode?: string; position?: number; nameFailures?: readonly NameFailure[] };
type RecoveryContext =
  | { kind: "scalar"; witness: ViewWitness; edit: ScalarEdit }
  | { kind: "history"; witness: ViewWitness; direction: "undo" | "redo" }
  | { kind: "rows"; witness: ViewWitness; retainedInput?: string }
  | { kind: "cleanup"; witness: ViewWitness }
  | { kind: "summary"; witness?: ViewWitness };
export interface MutationRecovery {
  kind: "known-publication-recovery" | "unknown-outcome";
  resetPreview: boolean;
  retainedInput?: string;
  message: string;
}

/** Application effects only. Canonical state, dispatch ordering and host writes
 * remain with the existing runtime/host; this seam owns their UI completion. */
interface NewTableCompletionPort {
  close(): Promise<void>;
  resetClosed(): void;
  retainDraft(): void;
  closeFailed(): never;
}
export interface MutationCompletionPort {
  state(): ResultSnapshot & { view: WorkbookView | null; history: LocalHistorySnapshot; currentness: Currentness; savedRevision: string | null };
  installView(view: WorkbookView | null): void;
  installHistory(history: LocalHistorySnapshot): void;
  clearResults(): void;
  readResults(view: WorkbookView): Promise<KeyedGroupedSumResult[]>;
  readView(): Promise<WorkbookView>;
  installResults(results: KeyedGroupedSumResult[]): void;
  restoreResults(snapshot: ResultSnapshot): void;
  upsertResult(result: KeyedGroupedSumResult): void;
  dropResult(definitionId: string): void;
  clearPreview(): void;
  markDirty(): void;
  markNotSaved(): void;
  endInitial(occurrence: string): void;
  markSalesChanged(occurrence: string): void;
  observeSales(view: WorkbookView): void;
  setCurrentness(currentness: Currentness): void;
  setOutcome(outcome: "idle" | "unknown"): void;
  setMessage(message: string | null): void;
  recover(recovery: MutationRecovery): void;
  acceptSave(occurrence: string, receipt: SaveReceipt): void;
  newTable: NewTableCompletionPort;
}
/** Entities the confirmed view added to the viewed table since dispatch, in the grid's identity. */
function addedEntityIds(before: WorkbookView | null, after: WorkbookView): readonly string[] | undefined {
  if (!before || before.occurrence !== after.occurrence
    || before.table.collection.key !== after.table.collection.key) return undefined;
  // Comparing two whole projections: the added rows are only known from both
  // complete entity sets.
  const previous = new Set(rowSource(before.table).allRowsForNow().map(rowEntity));
  return rowSource(after.table).allRowsForNow().map(rowEntity).filter(entity => !previous.has(entity));
}
function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? `${fallback} (Details: ${error.message})` : fallback;
}
const KNOWN_RECOVERY_MESSAGE = "The change was applied, but the current values could not be confirmed. Refresh to read the work again.";

export function createMutationCompletion(port: MutationCompletionPort) {
  function recover(kind: MutationRecovery["kind"], context: RecoveryContext): MutationCompletion {
    const command = context.kind;
    const occurrence = context.witness?.occurrence;
    const tracked = command === "scalar" || command === "rows" || command === "history";
    if (tracked) port.installHistory(emptyLocalHistory());
    if (kind === "known-publication-recovery" && occurrence) {
      port.endInitial(occurrence);
      if (tracked) port.markSalesChanged(occurrence);
    }
    // Scalar edits and a duplicate's typed table name are the user's input: a
    // recovery keeps them visible for review. Nothing is replayed.
    const submittedName = context.kind === "rows" ? context.retainedInput : undefined;
    const retainedInput = context.kind === "scalar"
      ? (kind === "unknown-outcome" ? JSON.stringify(context.edit) : undefined)
      : submittedName;
    // The dialog that held the duplicate name closes on recovery, so both
    // recovery kinds keep that name in the message the user reads instead.
    const message = kind === "known-publication-recovery"
      ? (submittedName === undefined ? KNOWN_RECOVERY_MESSAGE
        : `${KNOWN_RECOVERY_MESSAGE} The duplicate was requested as “${submittedName}”.`)
      : command === "scalar" ? `The change was dispatched but its outcome is unknown. Refresh to re-read the work. Input retained for review: ${retainedInput}`
      : command === "cleanup" ? "The cleanup was dispatched but its outcome is unknown. Refresh to re-read the work; it was not retried."
      : command === "summary" ? "The cross-table summary request was dispatched but its outcome is unknown. Refresh to re-read the work; it was not retried."
      : submittedName !== undefined ? `The duplicate request for “${submittedName}” was dispatched but its outcome is unknown. Refresh to re-read the work; it was not retried. Input retained for review: ${submittedName}`
      : `The ${context.kind === "history" ? context.direction : "row change"} request was dispatched but could not be confirmed. Refresh to re-read the work; it was not retried.`;
    port.recover({ kind, resetPreview: kind === "known-publication-recovery" || command === "cleanup", retainedInput, message });
    return { kind };
  }

  async function observePublication(next: WorkbookView, prior: ResultSnapshot | null, occurrence: string): Promise<void> {
    if (next.occurrence !== occurrence) throw new Error("The open work changed before its summaries could be confirmed.");
    port.installView(next);
    port.clearPreview();
    port.markDirty();
    if (port.state().savedRevision !== next.revision) port.markNotSaved();
    // Keep the prior same-occurrence snapshot pending until the entire set is
    // coherent. Never publish a partial new summary inventory.
    const results = await port.readResults(next);
    const ids = results.map(result => result.definitionId), unique = new Set(ids);
    if (results.some(result => result.revision !== next.revision) || unique.size !== ids.length ||
      (prior && prior.definitionIds.some(id => !unique.has(id)))) throw new Error("The complete summary results did not match the changed work.");
    const current = port.state().view;
    if (current?.occurrence !== next.occurrence || current.revision !== next.revision) throw new Error("The changed work could not be matched to its summaries.");
    port.installResults(results);
    port.observeSales(next);
    port.setCurrentness("current");
    port.setOutcome("idle");
  }

  function run(command: MutationCommand): Promise<MutationCompletion>;
  function run<T>(command: MutationCommand, complete: (result: MutationCompletion) => T, finish: () => void): Promise<T>;
  async function run<T>(
    command: MutationCommand,
    complete?: (result: MutationCompletion) => T,
    finish: () => void = () => {},
  ): Promise<T | MutationCompletion> {
    const completed = (result: MutationCompletion) => complete ? complete(result) : result;
    const before = port.state();
    const prior = (command.kind === "scalar" || command.kind === "summary") && before.currentness !== "current"
      ? null : { definitionIds: [...before.definitionIds], results: [...before.results] };
    let published = false;
    try {
      // Cleanup historically leaves its summaries for explicit Refresh. Its
      // currentness is also unchanged during dispatch; preserve that policy.
      if (command.kind !== "cleanup") {
        if (command.kind !== "summary") port.setMessage(null);
        port.setCurrentness("pending");
      }
      if (command.kind === "summary") {
        port.clearResults();
        const confirmed = await command.dispatch();
        published = true;
        port.endInitial(command.witness.occurrence);
        const next = await port.readView();
        const results = await port.readResults(next);
        port.installHistory(confirmScalarHistory(before.history, next, confirmed.publication, true));
        port.installView(next);
        port.installResults(results);
        port.clearPreview();
        port.markDirty();
        port.markNotSaved();
        port.setCurrentness("current");
      } else if (command.kind === "cleanup") {
        const next = await command.dispatch();
        published = true;
        port.clearResults();
        port.endInitial(command.witness.occurrence);
        port.installView(next);
        port.markDirty();
        port.markNotSaved();
        port.clearPreview();
      } else {
        const confirmed = await command.dispatch();
        published = true;
        const history = port.state().history;
        port.installHistory(command.kind === "history"
          ? confirmHistoryCommand(history, confirmed.view, confirmed.publication, command.direction)
          : confirmScalarHistory(history, confirmed.view, confirmed.publication, true));
        // Undo/Redo may legitimately remove or restore a saved definition.
        // readResults reads the authoritative complete post-history inventory.
        await observePublication(confirmed.view, command.kind === "history" ? null : prior, command.witness.occurrence);
        return completed({ kind: "published", focusTarget: command.kind === "history" && confirmed.publication.fields.length === 1 ? confirmed.publication.fields[0]! : null,
          // Only a row command creates rows this seam can attribute to a table.
          ...(command.kind === "rows" ? { addedEntities: addedEntityIds(before.view, confirmed.view) } : {}) });
      }
      port.setOutcome("idle");
      return completed({ kind: "published", focusTarget: null });
    } catch (error) {
      if (published || error instanceof PublishedProjectionRecoveryError) return completed(recover("known-publication-recovery", command));
      // Preserve history's existing fail-closed policy even for a trusted
      // refusal: its admitted local tail is discarded, with no command replay.
      if (error instanceof UnknownOperationOutcomeError || command.kind === "history") return completed(recover("unknown-outcome", command));
      if (command.kind === "scalar" && error instanceof SheetSessionError && (error.code === "not-open" || error.code === "stale-witness")) {
        port.setOutcome("idle"); port.setCurrentness("unknown");
        const message = "This draft belongs to an unconfirmed work view. Refresh to re-read the work; the draft was kept.";
        port.setMessage(message); return completed({ kind: "refused", message });
      }
      const current = port.state().view;
      if ((command.kind === "scalar" || command.kind === "summary") && prior && current?.occurrence === command.witness.occurrence && current.revision === command.witness.revision) port.restoreResults(prior);
      // J4 refusal set currentness before outcome in the base; the other
      // commands set outcome first. Keep that distinction too.
      if (command.kind === "summary") port.setCurrentness("current");
      port.setOutcome("idle");
      if (command.kind === "cleanup") port.clearPreview();
      else if (command.kind !== "summary") port.setCurrentness(command.kind === "rows" && error instanceof SheetSessionError ? "unknown" : "current");
      const failure = (error as { failure?: { code?: string; message?: string; position?: unknown; name_failures?: readonly NameFailure[] } })?.failure;
      // Work's formula refusal is shown verbatim. Other failures keep the
      // explanatory prefix so their cause is not mistaken for a Work verdict.
      const message = command.kind === "scalar" && command.edit.kind === "formula" &&
        typeof failure?.message === "string" && failure.message.length > 0
        ? failure.message
        : describe(error, command.kind === "scalar" ? "The change was not applied." : command.kind === "rows" ? "The row change was not applied." : command.kind === "cleanup" ? "The cleanup was not applied." : "The cross-table summary was not created.");
      // A formula refusal is shown in the formula bar beside the retained
      // draft; the global banner would repeat Work's words a second time.
      if (command.kind !== "rows" && !(command.kind === "scalar" && command.edit.kind === "formula")) port.setMessage(message);
      const fieldType = failure?.code === "invalid_number" ? "number" : failure?.code === "invalid_date" ? "date" : undefined;
      // Work may attach a 1-based character position to a formula refusal.
      // Sheet neither parses the source nor invents one when it is absent.
      const position = typeof failure?.position === "number" && Number.isInteger(failure.position) && failure.position > 0
        ? failure.position : undefined;
      return completed({
        kind: "refused", message,
        ...(command.kind === "rows" ? { fieldType, refusalCode: failure?.code, ...(failure?.name_failures ? { nameFailures: failure.name_failures } : {}) } : {}),
        ...(command.kind === "scalar" && position !== undefined ? { position } : {}),
      });
    } finally {
      // App's base finally/end ran in this continuation. A caller awaiting
      // this seam before end adds a microtask and can render the value with
      // stale busy/history availability. Map the result and finish here.
      finish();
    }
  }

  async function refreshSummary(witness: ViewWitness, definitionId: string, dispatch: () => Promise<KeyedGroupedSumResult>, finish: () => void = () => {}): Promise<boolean> {
    const admitted = port.state().view;
    if (!admitted) { finish(); return false; }
    try {
      port.setMessage(null); port.setCurrentness("pending");
      const result = await dispatch(), current = port.state().view;
      if (!current || current.occurrence !== admitted.occurrence || current.revision !== admitted.revision || current.occurrence !== witness.occurrence || current.revision !== witness.revision) return false;
      if (result.definitionId !== definitionId || result.revision !== admitted.revision) throw new Error("The refreshed result did not match this summary and the current work.");
      port.upsertResult(result); port.setCurrentness("current"); port.setOutcome("idle"); return true;
    } catch (error) {
      const current = port.state().view;
      if (!current || current.occurrence !== admitted.occurrence || current.revision !== admitted.revision) return false;
      if (error instanceof SheetSessionError && (error.code === "not-open" || error.code === "stale-witness")) {
        port.setCurrentness("unknown"); port.setOutcome("unknown");
        port.setMessage("The work could not be confirmed. Refresh the workbook to recheck all results."); return false;
      }
      port.dropResult(definitionId); port.setCurrentness("current"); port.setOutcome("idle"); port.setMessage(null); return false;
    } finally { finish(); }
  }
  function save(live: ViewWitness, snapshotRevision: string, receipt: SaveReceipt): boolean {
    const stillCurrent = saveCompletionIsCurrent(live, port.state().view, snapshotRevision, receipt.revision);
    if (stillCurrent) port.acceptSave(live.occurrence, receipt);
    else port.markNotSaved();
    port.setOutcome("idle");
    return stillCurrent;
  }
  function confirmCoordinatedPublication(view: WorkbookView, results: KeyedGroupedSumResult[]): void {
    port.installView(view);
    port.installResults(results);
    port.markDirty();
    port.markNotSaved();
  }
  return {
    run, recover, refreshSummary, save, confirmCoordinatedPublication,
    newTable: (dispatch: Parameters<typeof completeNewTable>[0], unconfirmed: Error, finish: () => void = () => {}, failure: (error: unknown) => unknown = error => error) => completeNewTable(dispatch, { ...port.newTable, markDirty: port.markDirty }, unconfirmed, finish, failure),
  };
}

export interface CompletionIntent { generation: number; occurrence: string | null }
export function completionMayUpdateUi(intent: CompletionIntent, current: CompletionIntent): boolean {
  return current.generation === intent.generation && current.occurrence === intent.occurrence && intent.occurrence !== null;
}
/** Roving state follows the projection even when newer DOM focus wins. */
export function survivingFocusedKey(current: string | null, previous: { rows: string[]; fields: string[] }, next: { rows: string[]; fields: string[] }): string | null {
  if (!current || !next.rows.length || !next.fields.length) return null;
  const nearest = (value: string, prior: string[], surviving: string[]) => {
    if (surviving.includes(value)) return value;
    const index = prior.indexOf(value);
    return prior.slice(index + 1).find(candidate => surviving.includes(candidate)) ?? prior.slice(0, index).reverse().find(candidate => surviving.includes(candidate)) ?? surviving[0]!;
  };
  const [entity, field] = current.split("\u0000");
  return `${nearest(entity!, previous.rows, next.rows)}\u0000${nearest(field!, previous.fields, next.fields)}`;
}

/** A host receipt is separate from semantic completion, and must still name
 * the exact live snapshot. No revision ordering or storage policy is invented. */
export function saveCompletionIsCurrent(live: ViewWitness, current: ViewWitness | null, snapshotRevision: string, receiptRevision: string): boolean {
  return current !== null && current.occurrence === live.occurrence && current.revision === snapshotRevision && receiptRevision === snapshotRevision;
}

async function completeNewTable(
  dispatch: () => Promise<{ kind: "confirmed" | "refused" | "blocked" | "startup-unavailable" | "acknowledged-recovery" | "unknown-recovery" }>,
  effects: NewTableCompletionPort & { markDirty(): void },
  unconfirmed: Error,
  finish: () => void,
  failure: (error: unknown) => unknown,
): Promise<boolean> {
  try {
    const result = await dispatch();
    if (result.kind === "confirmed") { effects.markDirty(); return true; }
    if (result.kind !== "acknowledged-recovery" && result.kind !== "unknown-recovery") return false;
    try { await effects.close(); } catch { effects.closeFailed(); }
    effects.resetClosed();
    effects.retainDraft();
    // Creation is a disposable empty resident, unlike an uncertain edit. Only
    // the next explicit Create may replay; the dialog retains the schema.
    throw unconfirmed;
  } catch (error) { throw failure(error); }
  finally { finish(); }
}

/** Ordered history focus candidates retain the user's newer choice first.
 * DOM usability and virtual-row mounting remain UI adapter responsibilities. */
export function firstUsableCompletionTarget<T>(candidates: readonly (T | null)[], usable: (target: T | null) => boolean): T | null {
  return candidates.find(target => usable(target)) ?? null;
}

/** A completed copy is saved only for its exact current revision with no retained draft. */
export function settledSaveStatus(
  previous: SaveStatus,
  savedRevision: string | null,
  liveRevision: string | null,
  hasUncommittedDraft: boolean,
): SaveStatus {
  if (previous === "failed") return previous;
  return savedRevision !== null && liveRevision !== null && savedRevision === liveRevision && !hasUncommittedDraft
    ? "saved"
    : "not-saved";
}

/** Refresh and confirmed observation share the same onboarding boundary. */
export function salesRevisionHasChanged(opening: ViewWitness | null, observed: ViewWitness): boolean {
  return opening !== null && opening.occurrence === observed.occurrence && opening.revision !== observed.revision;
}
