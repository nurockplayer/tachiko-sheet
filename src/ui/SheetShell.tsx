import { completionMayUpdateUi as completionIntentIsCurrent, survivingFocusedKey, firstUsableCompletionTarget } from "../app/mutation-completion.js";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import { appearanceDensity } from "../application/appearance-preference.js";
import { emptyLocalHistory } from "../application/local-history.js";
import { sameAppearanceChoice } from "../application/appearance-model.js";
import type {
  AppearanceDensity,
  AppearancePreferenceSnapshot,
  AppearanceProfileId,
} from "../application/appearance-preference.js";
import type {
  Currentness,
  FieldTarget,
  ImportSelection,
  KeyedGroupedSumBindingCatalog,
  KeyedGroupedSumBindingChoice,
  KeyedGroupedSumResult,
  ReportConfiguration,
  ReportPresentationTextField,
  SalesEntryOutcome,
  SalesCatalogLayoutMarker,
  SalesEntryTipMarker,
  SheetShellProps,
  SavedCopySummary,
  ViewWitness,
  WorkbookView,
} from "../contracts.js";
import type { InterfaceProfileV1 } from "../application/interface-profile-contract.js";
import { LOCAL_RUNTIME_RELOAD_REQUIRED_MESSAGE, reportPresentationTextLimitViolation, savedCopiesAreVisible } from "../contracts.js";
import { decodeTsv, encodeTsv, pasteRefusal, rectangle, routePaste, stepAddress, type CellAddress } from "./clipboard.js";
import { historyCommandForKey } from "./history-keyboard.js";
import { Modal } from "./Modal.js";
import { isComposingEvent } from "./composition-event.js";
import { NewTableDialog } from "./NewTableDialog.js";
import { DRAFT_ROW, draftKeyAction, draftReadiness, draftRefusal, firstMissingDraftColumn, hasDraftInput, type RowDraft } from "./row-entry-model.js";
import { BriefFacts } from "./BriefFacts.js";
import { AppearanceSelector } from "./AppearanceSelector.js";
import { booleanText, fieldDisplay, parseBooleanDraft, scalarEditOf, seedTextOf } from "./field-display.js";
import {
  cellKey,
  fieldForColumn,
  notesFieldFor,
  rowEntity,
  tableColumns,
  type TableColumn,
  type TableRow,
} from "./projection-access.js";
import { ReportCanvas } from "./ReportCanvas.js";
import { sourceNames } from "./source-names.js";
import { suggestedCopyName } from "./copy-name.js";
import { workFileOpenRefusal } from "./work-file-copy.js";
import { closeSaveUnavailableReason, savedCloseIsConfirmed } from "./save-close.js";
import { dropAppliedNotesDraft, isNotesDraftBound, keepNotesDraft as keptNotesDraft, markNotesConflicts, upsertNotesDraft, type NotesDraft } from "./notes-drafts.js";
import { chooseImportType, chosenImportTypes, importConfirmationMessage, importRefusalMessage, sourcePreviewText, suggestColumnType, type ImportTypeChoice } from "./import-suggestions.js";
import { GRID_WINDOW_THRESHOLD, gridWindowAround, gridWindowRange, gridWindowScrollHeight, gridWindowSegments, measuredRowPitch, scrollTopToReveal, type GridWindowRange } from "./grid-window.js";
import { ResultsPane, SalesTip } from "./ResultsPane.js";
import { type ResultChartMode } from "./results-model.js";
import { findingCategoryLabel, findingMessage } from "./interop-copy.js";
import { useHostCopy } from "./host-copy.js";
import { useHostFiles } from "../host/host-files.js";
import "./sheet-shell.css";

type EditableKind = "number" | "text" | "boolean" | "date";
type ActiveTab = "table" | "summary" | "report" | "brief" | "interop";

interface EditorState {
  entity: string;
  field: string;
  kind: EditableKind;
  value: string;
  original: string;
}

interface GridPosition {
  entity: string;
  field: string;
}

interface HistoryFocusRequest {
  operationId: number;
  occurrence: string | null;
  initiator: HTMLElement | null;
  publicationTarget: FieldTarget | null;
  userDestination: HTMLElement | null;
  settled: boolean;
}

interface ReportTextDraft {
  occurrence: string;
  definitionId: string;
  type: ReportConfiguration["type"];
  values: Partial<Record<ReportPresentationTextField, string>>;
}

/** Definitions without a visible result still need an explicit refresh path. */
export function missingKeyedGroupedSumDefinitionIds(
  definitionIds: readonly string[],
  results: readonly Pick<import("../contracts.js").KeyedGroupedSumResult, "definitionId">[],
): string[] {
  const resultIds = new Set(results.map((result) => result.definitionId));
  return definitionIds.filter((definitionId) => !resultIds.has(definitionId));
}

export function salesEntryFocusTarget(view: WorkbookView, marker: SalesEntryTipMarker | null): { entity: string; field: string } | null {
  if (!marker || marker.occurrence !== view.occurrence || marker.collection !== view.table.collection.key || marker.field !== "price") return null;
  return catalogPriceFocusTarget(view);
}

export function salesCatalogFocusTarget(view: WorkbookView, marker: SalesCatalogLayoutMarker | null): { entity: string; field: string } | null {
  if (!salesCatalogLayoutEligible(view, marker)) return null;
  return catalogPriceFocusTarget(view);
}

function catalogPriceFocusTarget(view: WorkbookView): { entity: string; field: string } | null {
  const columns = tableColumns(view.table);
  const priceColumns = columns.filter((column) => column.key === "price");
  const codeColumns = columns.filter((column) => column.key === "code");
  if (priceColumns.length !== 1 || codeColumns.length !== 1) return null;
  const priceColumn = priceColumns[0]!;
  const codeColumn = codeColumns[0]!;
  const penRows = view.table.rows.filter((row) => fieldDisplay(fieldForColumn(row, codeColumn.id)).text === "PEN");
  if (penRows.length !== 1) return null;
  const row = penRows[0]!;
  const priceField = fieldForColumn(row, priceColumn.id);
  return priceField ? { entity: rowEntity(row), field: priceField.target.field } : null;
}

export function salesCatalogLayoutEligible(view: WorkbookView, marker: SalesCatalogLayoutMarker | null): boolean {
  if (!marker || marker.occurrence !== view.occurrence || marker.collectionId !== view.table.collection.id) return false;
  const keys = tableColumns(view.table).map((column) => column.key);
  return keys.length === 3 && new Set(keys).size === 3 && ["code", "category", "price"].every((key) => keys.includes(key));
}

export function scrollCellIntoGridNearest(cell: HTMLElement, scrollport: HTMLElement): boolean {
  const before = cell.getBoundingClientRect();
  const port = scrollport.getBoundingClientRect();
  const visible = (rect: DOMRect) => rect.left >= port.left && rect.right <= port.right && rect.top >= port.top && rect.bottom <= port.bottom;
  if (before.left < port.left) scrollport.scrollLeft -= port.left - before.left;
  else if (before.right > port.right) scrollport.scrollLeft += before.right - port.right;
  if (before.top < port.top) scrollport.scrollTop -= port.top - before.top;
  else if (before.bottom > port.bottom) scrollport.scrollTop += before.bottom - port.bottom;
  return visible(cell.getBoundingClientRect());
}

export interface FocusRevealBounds {
  top: number;
  bottom: number;
}

export function focusRevealScrollDelta(target: FocusRevealBounds, visible: FocusRevealBounds, clearance = 4): number {
  const targetTop = target.top - clearance;
  const targetBottom = target.bottom + clearance;
  if (targetTop < visible.top) return targetTop - visible.top;
  if (targetBottom > visible.bottom) return targetBottom - visible.bottom;
  return 0;
}

export function focusRevealNextScrollTop(current: number, delta: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, current + delta));
}

export function focusRevealStillCurrent(input: {
  targetConnected: boolean;
  targetIsActive: boolean;
  compositionConnected: boolean;
  compositionIsCurrent: boolean;
}): boolean {
  return input.targetConnected && input.targetIsActive && input.compositionConnected && input.compositionIsCurrent;
}

/** Directory selection is a host-level capability; the attribute is not in the React types. */
const directoryInputAttributes: Record<string, string> = { webkitdirectory: "", directory: "" };

function formatHomeSavedAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${dateLabel}, ${timeLabel}`;
}

const savedNameWhitespaceLabels = new Map<string, string>([
  ["\u0009", "tab"],
  ["\u000a", "line feed"],
  ["\u000b", "vertical tab"],
  ["\u000c", "form feed"],
  ["\u000d", "carriage return"],
  [" ", "space"],
  ["\u0085", "next line"],
  ["\u00a0", "no-break space"],
  ["\u1680", "Ogham space mark"],
  ["\u2000", "en quad"],
  ["\u2001", "em quad"],
  ["\u2002", "en space"],
  ["\u2003", "em space"],
  ["\u2004", "three-per-em space"],
  ["\u2005", "four-per-em space"],
  ["\u2006", "six-per-em space"],
  ["\u2007", "figure space"],
  ["\u2008", "punctuation space"],
  ["\u2009", "thin space"],
  ["\u200a", "hair space"],
  ["\u2028", "line separator"],
  ["\u2029", "paragraph separator"],
  ["\u202f", "narrow no-break space"],
  ["\u205f", "medium mathematical space"],
  ["\u3000", "ideographic space"],
  ["\ufeff", "zero-width no-break space"],
]);

const savedNameInvisibleLabels = new Map<number, string>([
  [0x00ad, "soft hyphen"],
  [0x034f, "combining grapheme joiner"],
  [0x0600, "Arabic number sign"],
  [0x007f, "delete control"],
  [0x0080, "control character"],
  [0x200b, "zero-width space"],
  [0x200c, "zero-width non-joiner"],
  [0x200d, "zero-width joiner"],
  [0x202e, "right-to-left override"],
  [0xfe0f, "emoji variation selector"],
  [0xe0100, "supplementary variation selector"],
  [0xe0067, "tag character"],
  [0xe007f, "tag character"],
  [0x3164, "Hangul filler"],
]);

function isAcceptedNameInvisible(character: string): boolean {
  return /[\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(character);
}

/** Names stay exact; describe accepted whitespace, control, format, or default-ignorable codepoints that presentation can hide or collapse. */
export function describeSavedCopyNameWhitespace(name: string): string | null {
  const characters = Array.from(name);
  const runs: Array<{ character: string; start: number; count: number }> = [];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (!isAcceptedNameInvisible(character)) continue;
    const previous = runs.at(-1);
    if (previous?.character === character && previous.start + previous.count === index + 1) {
      previous.count += 1;
    } else {
      runs.push({ character, start: index + 1, count: 1 });
    }
  }

  const details = runs.flatMap((run) => {
    const before = characters[run.start - 2];
    const after = characters[run.start - 1 + run.count];
    const adjacentMixedWhitespace =
      (before !== undefined && before !== run.character && isAcceptedNameInvisible(before)) ||
      (after !== undefined && after !== run.character && isAcceptedNameInvisible(after));
    const boundaryWhitespace = run.start === 1 || run.start + run.count - 1 === characters.length;
    if (run.character === " " && run.count === 1 && !adjacentMixedWhitespace && !boundaryWhitespace) return [];

    const codePoint = run.character.codePointAt(0) as number;
    const whitespaceKind = savedNameWhitespaceLabels.get(run.character);
    if (whitespaceKind) {
      const plural = `${whitespaceKind}s`;
      const article = /^(?:en |em |Ogham |ideographic )/u.test(whitespaceKind) ? "an" : "a";
      return [run.count === 1
        ? `${article} ${whitespaceKind} at character ${run.start}`
        : `${run.count} consecutive ${plural} starting at character ${run.start}`];
    }

    const code = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    const category = /\p{Cc}/u.test(run.character)
      ? "control character"
      : /\p{Cf}/u.test(run.character)
        ? "format character"
        : "default-ignorable character";
    const kind = savedNameInvisibleLabels.get(codePoint) ?? category;
    const article = /^(?:emoji |Arabic )/u.test(kind) ? "an" : "a";
    const repeatedKind = `${kind}s`;
    return [run.count === 1
      ? `${article} ${kind} (${code}, ${category}) at character ${run.start}`
      : `${run.count} consecutive ${repeatedKind} (${code}, ${category}) starting at character ${run.start}`];
  });

  if (details.length === 0) return null;
  if (details.length === 1) return `Name contains ${details[0]}.`;
  return `Name contains ${details.slice(0, -1).join(", ")}, and ${details.at(-1)}.`;
}

/** Report pixels follow their source result, not the selected table. */
export function reportRenderResetKey(
  view: Pick<WorkbookView, "occurrence" | "revision"> | null,
  report: ReportConfiguration | null,
  results: readonly KeyedGroupedSumResult[],
  currentness: Currentness,
): string {
  if (!view || !report || currentness !== "current") return "unavailable";
  const source = results.find((candidate) => candidate.definitionId === report.definitionId);
  return JSON.stringify({
    occurrence: view.occurrence,
    revision: view.revision,
    report,
    source: source
      ? { revision: source.revision, groups: source.groups, diagnostics: source.diagnostics }
      : null,
  });
}

/** Publish queued appearance state only after the controller commits that same complete choice. */
export function shouldPublishAppearanceCompositionEnd(
  queued: AppearancePreferenceSnapshot["pendingSelection"],
  snapshot: AppearancePreferenceSnapshot,
): boolean {
  return queued !== null && snapshot.pendingSelection === null &&
    sameAppearanceChoice(snapshot.selection, queued);
}

/** Available grid viewport inside the active panel, before the panel itself must scroll. */
function availableGridScrollHeight(gridTop: number, panelBottom: number): number {
  return Math.max(0, Math.floor(panelBottom - gridTop));
}

function sharedButtonFromTarget(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLButtonElement>(".ts-app .ts-button, .ts-app .ts-home-copy-action");
}

type SharedButtonPointerOwner = { button: HTMLButtonElement; pointerId: number };

function sharedButtonIsEligible(button: HTMLButtonElement): boolean {
  return !button.disabled && button.getAttribute("aria-disabled") !== "true" && button.getAttribute("aria-busy") !== "true";
}

function holdSharedButton(target: EventTarget | null): HTMLButtonElement | null {
  const button = sharedButtonFromTarget(target);
  if (!button || !sharedButtonIsEligible(button)) return null;
  button.setAttribute("data-ts-held", "");
  return button;
}

function clearOwnedSharedPointer(ownerRef: { current: SharedButtonPointerOwner | null }, pointerId?: number): void {
  const owner = ownerRef.current;
  if (!owner || (pointerId !== undefined && owner.pointerId !== pointerId)) return;
  owner.button.removeAttribute("data-ts-held");
  ownerRef.current = null;
}

function historyFocusDestinationIsUsable(element: HTMLElement | null, shell: HTMLElement | null): element is HTMLElement {
  if (!element || !shell?.contains(element) || !element.isConnected || element.getClientRects().length === 0) return false;
  if (element.closest("[hidden], [inert]") || element.getAttribute("aria-disabled") === "true") return false;
  if (element.matches(":disabled")) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function releaseSharedButton(target: EventTarget | null, ownerRef: { current: SharedButtonPointerOwner | null }): void {
  const button = sharedButtonFromTarget(target);
  button?.removeAttribute("data-ts-held");
  if (button && ownerRef.current?.button === button) clearOwnedSharedPointer(ownerRef);
}

function releaseSharedKeyboardButton(target: EventTarget | null, ownerRef: { current: SharedButtonPointerOwner | null }): void {
  const button = sharedButtonFromTarget(target);
  if (button && ownerRef.current?.button === button) return;
  button?.removeAttribute("data-ts-held");
}

function clearHeldSharedButtons(ownerRef: { current: SharedButtonPointerOwner | null }): void {
  clearOwnedSharedPointer(ownerRef);
  document.querySelectorAll<HTMLButtonElement>(".ts-app .ts-button[data-ts-held], .ts-app .ts-home-copy-action[data-ts-held]").forEach((button) => {
    button.removeAttribute("data-ts-held");
  });
}

export function SheetShell(props: SheetShellProps) {
  const hostCopy = useHostCopy();
  const hostFiles = useHostFiles();
  const {
    view,
    busy,
    dirty,
    currentness,
    outcome,
    saveStatus,
    message,
    copies,
    copiesStatus = "ready",
    onRetryCopies = async () => {},
    onOpenFiles,
    workFileSaveUnavailableReason = null,
    onOpenWorkFile = async () => { throw new Error("Opening work files is unavailable."); },
    workFileUnavailableReason = null,
    workFileOmissions = [],
    onNewTable,
    onInsertRow,
    onPasteCells,
    onRemoveRows,
    onOpenExample,
    onOpenSaved,
    onSelectCollection = async () => {},
    onCommit,
    localHistory = emptyLocalHistory(),
    onHistory = async () => null,
    onCreateCopy,
    boundCopyName = null,
    onSave,
    onDeleteCopy,
    onClose,
    onRefresh,
    interop = null,
    importedSourceName = null,
    onInspectImport = async () => { throw new Error("Spreadsheet import is unavailable."); },
    onImportCandidate = async () => false,
    onCancelImport = () => undefined,
    onPreviewTrim = async () => null,
    onPreviewDeduplicate = async () => null,
    onCommitCleanup = async () => false,
    onCancelCleanup = () => undefined,
    onPrepareDownload = async () => false,
    onDownload = async () => false,
    j4Results = [],
    j4DefinitionIds = [],
    onPrepareJ4Bindings = async () => ({ collections: [] }),
    onCreateJ4 = async () => false,
    onRefreshJ4 = async () => false,
    onOpenJ4Canary = async () => { throw new Error("The sales example is unavailable."); },
    salesEntryTip = null,
    salesCatalogLayout = null,
    salesInitialNotSaved = false,
    salesExampleChanged = false,
    onDismissSalesEntryTip = () => undefined,
    report = null,
    onCreateReport = () => undefined,
    onUpdateReport = () => undefined,
    onExportReportPng = () => false,
    onRemoveReport = () => false,
  } = props;
  const heldPointerOwnerRef = useRef<SharedButtonPointerOwner | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const [appearanceSnapshot, setAppearanceSnapshot] = useState(() =>
    props.appearancePreference.getSnapshot(),
  );
  const compositionEndTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (compositionEndTimer.current !== null) window.clearTimeout(compositionEndTimer.current);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const compact = window.matchMedia("(max-width: 1023px)");
    const sync = () => setCompactHomeLayout(compact.matches);
    sync();
    compact.addEventListener("change", sync);
    return () => compact.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      historyFocusRequestRef.current = null;
    };
  }, []);

  function selectAppearanceProfile(profileId: AppearanceProfileId): AppearancePreferenceSnapshot {
    const current = props.appearancePreference.getSnapshot();
    const choice = current.pendingSelection ?? current.selection;
    const snapshot = props.appearancePreference.selectBuiltIn(profileId, appearanceDensity(choice));
    if (!current.composing) setAppearanceSnapshot(snapshot);
    return snapshot;
  }

  function selectAppearanceDensity(density: AppearanceDensity): AppearancePreferenceSnapshot {
    const current = props.appearancePreference.getSnapshot();
    const snapshot = props.appearancePreference.selectDensity(density);
    if (!current.composing) setAppearanceSnapshot(snapshot);
    return snapshot;
  }

  function selectImportedAppearanceProfile(profile: InterfaceProfileV1): AppearancePreferenceSnapshot {
    const current = props.appearancePreference.getSnapshot();
    const snapshot = props.appearancePreference.selectImported(profile);
    if (!current.composing) setAppearanceSnapshot(snapshot);
    return snapshot;
  }

  function beginAppearanceComposition(): void {
    if (compositionEndTimer.current !== null) {
      window.clearTimeout(compositionEndTimer.current);
      compositionEndTimer.current = null;
    }
    props.appearancePreference.beginComposition();
  }

  function scheduleAppearanceCompositionEnd(): void {
    if (compositionEndTimer.current !== null) window.clearTimeout(compositionEndTimer.current);
    compositionEndTimer.current = window.setTimeout(() => {
      compositionEndTimer.current = null;
      const queued = props.appearancePreference.getSnapshot().pendingSelection;
      const snapshot = props.appearancePreference.endComposition();
      if (shouldPublishAppearanceCompositionEnd(queued, snapshot)) {
        setAppearanceSnapshot(snapshot);
      }
    }, 0);
  }

  function renderAppearanceSelector(context: "home" | "workbook"): ReactNode {
    return (
      <AppearanceSelector
        context={context}
        preference={appearanceSnapshot}
        onSelectProfile={selectAppearanceProfile}
        onSelectDensity={selectAppearanceDensity}
        onSelectImported={selectImportedAppearanceProfile}
      />
    );
  }

  const [tab, setTab] = useState<ActiveTab>("table");
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [resultsHidden, setResultsHidden] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [notesDrafts, setNotesDrafts] = useState<NotesDraft[]>([]);
  const [commitPending, setCommitPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [salesEntryOutcome, setSalesEntryOutcome] = useState<SalesEntryOutcome | null>(null);
  const [compactHomeLayout, setCompactHomeLayout] = useState(false);
  const [newTableOpen, setNewTableOpen] = useState(false);
  const [newTableDraftActive, setNewTableDraftActive] = useState(false);
  const [rowDraft, setRowDraft] = useState<RowDraft | null>(null);
  const [rowError, setRowError] = useState<{ message: string; fields?: string[]; missing?: boolean } | null>(null);
  const rowDraftActive = rowDraft !== null && (rowDraft.needsReview === true || hasDraftInput(rowDraft.values));
  const rowCommandPendingRef = useRef(false);
  const newTableTriggerRef = useRef<HTMLButtonElement>(null);
  const [deleteSelection, setDeleteSelection] = useState<SavedCopySummary | null>(null);
  const deleteName = deleteSelection?.name ?? null;
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deletePendingFocusRef = useRef<HTMLHeadingElement | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyForClose, setCopyForClose] = useState(false);
  const [closeSaveAttempted, setCloseSaveAttempted] = useState(false);
  const closeSaveIntentRef = useRef<symbol | null>(null);
  const [savedClose, setSavedClose] = useState<(ViewWitness & { intent: symbol; name: string; phase: "clear-draft" | "confirm" }) | null>(null);
  const [copyName, setCopyName] = useState("");
  const savedCopyNamesInSessionRef = useRef(new Set<string>());
  const [copyPending, setCopyPending] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyParentFailureMessage, setCopyParentFailureMessage] = useState<string | null>(null);
  const [captureCopyParentFailure, setCaptureCopyParentFailure] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [clipboardMessage, setClipboardMessage] = useState<string | null>(null);
  const [cellSelection, setCellSelection] = useState<{ identity: string; revision: string; anchor: GridPosition; end: GridPosition } | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [gridRange, setGridRange] = useState<GridWindowRange>({ start: 0, end: 80 });
  const gridRowHeightRef = useRef(32);
  // Mirrors the ref so a measured pitch change re-renders spacer heights.
  const [gridRowHeight, setGridRowHeight] = useState(32);
  const gridHeaderHeightRef = useRef(32);
  const [gridHeaderHeight, setGridHeaderHeight] = useState(32);
  const gridScrollFrameRef = useRef<number | null>(null);
  // A focus target waiting for its windowed row to mount, with the user-intent
  // generation at request time; any newer input cancels it.
  const pendingCellFocusRef = useRef<{ entity: string; field: string; generation: number } | null>(null);
  // Bumped by any pointer or key input outside the cell editor. A late
  // completion may move focus only if the user has not acted since.
  const focusIntentRef = useRef(0);
  const newTableFocusIntentRef = useRef<number | null>(null);
  const liveOccurrenceRef = useRef<string | null>(null);
  const appFocusingRef = useRef(false);
  // Declared before the windowing effects so a replacement occurrence never
  // consumes a focus request queued for the previous one.
  useLayoutEffect(() => {
    liveOccurrenceRef.current = view?.occurrence ?? null;
    pendingCellFocusRef.current = null;
    invalidateCloseSaveIntent();
  }, [view?.occurrence]);
  const [historyFocusRequest, setHistoryFocusRequest] = useState<HistoryFocusRequest | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPending, setImportPending] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<"csv" | "xlsx" | "ro" | null>(null);
  const [importChoice, setImportChoice] = useState<ImportTypeChoice | null>(null);
  const importSuggestions = useMemo<string[][]>(
    () => interop?.importInspection?.source.sheets.map((sheet) => sheet.columns.map((_, column) => suggestColumnType(sheet.rows, column))) ?? [],
    [interop?.importInspection],
  );
  const importTypes = chosenImportTypes(importChoice, importSuggestions);
  const [j4Catalog, setJ4Catalog] = useState<KeyedGroupedSumBindingCatalog | null>(null);
  const [j4Binding, setJ4Binding] = useState<KeyedGroupedSumBindingChoice | null>(null);
  const [j4Pending, setJ4Pending] = useState(false);
  const [reportRenderReady, setReportRenderReady] = useState(false);
  const [reportRenderReadyKey, setReportRenderReadyKey] = useState("unavailable");
  const [reportTextDraft, setReportTextDraft] = useState<ReportTextDraft | null>(null);

  const workFileReasonId = useId();
  const saveUnavailableId = useId();
  const [downloadOmissions, setDownloadOmissions] = useState<string[]>([]);
  const fileInputId = useId();
  const spreadsheetInputId = useId();
  const copyNameId = useId();
  const copyErrorId = useId();
  const exportUnavailableId = useId();
  const closeSaveUnavailableId = useId();
  const copyNameDescriptionBaseId = useId();
  const lockNoteId = useId();
  const notesId = useId();
  const tabId = (name: ActiveTab) => `ts-tab-${name}`;
  const panelId = (name: ActiveTab) => `ts-panel-${name}`;

  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const historyFocusRequestRef = useRef<HistoryFocusRequest | null>(null);
  const historyOperationIdRef = useRef(0);
  const mountedRef = useRef(false);
  const editorInputRef = useRef<HTMLInputElement | null>(null);
  const selectEditorValueOnFocusRef = useRef(true);
  // Intent captured when a rejected commit asked to refocus its retained
  // editor; rechecked when the refocus is finally applied.
  const focusRejectedEditorRef = useRef<{ generation: number; occurrence: string | null } | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const resultsHideButtonRef = useRef<HTMLButtonElement | null>(null);
  const resultsShowButtonRef = useRef<HTMLButtonElement | null>(null);
  const resultsFocusRevealFrameRef = useRef<number | null>(null);
  const resultsWasHiddenRef = useRef(false);
  const priorChartModesRef = useRef(new Map<string, ResultChartMode>());
  const focusedSalesOccurrenceRef = useRef<string | null>(null);
  const spreadsheetInputRef = useRef<HTMLInputElement | null>(null);
  const lastNotesOccurrenceRef = useRef<string | null>(null);
  const lastCellRef = useRef<HTMLTableCellElement | null>(null);
  const resultsOccurrenceRef = useRef<string | null>(null);
  const saveCopyButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeSaveButtonRef = useRef<HTMLButtonElement | null>(null);
  const keepEditingButtonRef = useRef<HTMLButtonElement | null>(null);
  const recoveryCloseTriggerRef = useRef<HTMLButtonElement | null>(null);
  const recoveryRefreshRef = useRef<HTMLButtonElement | null>(null);
  const desktopRefreshRef = useRef<HTMLButtonElement | null>(null);
  const commandOverflowSummaryRef = useRef<HTMLElement | null>(null);
  const importPendingFocusRef = useRef<HTMLHeadingElement | null>(null);
  const importRetryButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyNameInputRef = useRef<HTMLInputElement | null>(null);
  const copyParentMessageAtAttemptRef = useRef<string | null>(message);
  const downloadTriggerRef = useRef<HTMLButtonElement | null>(null);
  const downloadPendingFocusRef = useRef<HTMLHeadingElement | null>(null);
  const reportCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDraftChangeRef = useRef(props.onDraftChange);
  const onReportDraftChangeRef = useRef(props.onReportDraftChange);
  const focusEditorInput = useCallback((node: HTMLInputElement | null) => {
    editorInputRef.current = node;
    if (!node || node.ownerDocument.activeElement === node) return;
    node.focus();
    if (selectEditorValueOnFocusRef.current) node.select();
    else node.setSelectionRange(node.value.length, node.value.length);
  }, []);
  const viewKey = view ? `${view.occurrence}\u0000${view.revision}` : null;
  const collectionIdentity = view ? `${view.occurrence}\u0000${view.table.collection.key}` : null;
  const focusedProjectionRef = useRef<{ identity: string; rows: string[]; fields: string[] } | null>(null);
  const reportRenderKey = reportRenderResetKey(view, report, j4Results, currentness);
  const missingJ4DefinitionIds = missingKeyedGroupedSumDefinitionIds(j4DefinitionIds, j4Results);
  const resultsNeedAttention = j4Results.some((result) => result.diagnostics.length > 0) ||
    (currentness === "current" && missingJ4DefinitionIds.length > 0);
  // A Refresh recovery can temporarily remove the projection without proving
  // that its resident work was replaced. Keep the local-only draft attached
  // to its report until a non-null different occurrence, removal, or Close.
  const reportDraftRetained = Boolean(
    reportTextDraft && report &&
    reportTextDraft.definitionId === report.definitionId &&
    reportTextDraft.type === report.type &&
    (!view || reportTextDraft.occurrence === view.occurrence),
  );
  const activeReportTextDraft = reportDraftRetained && view ? reportTextDraft : null;
  const hasInvalidReportDraft = Boolean(reportDraftRetained && reportTextDraft && Object.keys(reportTextDraft.values).length > 0);
  const reportCanvasReady = reportRenderReady && reportRenderReadyKey === reportRenderKey;
  const onReportRenderState = useCallback((ready: boolean) => {
    setReportRenderReady(ready);
    setReportRenderReadyKey(ready ? reportRenderKey : "unavailable");
  }, [reportRenderKey]);

  useEffect(() => {
    onDraftChangeRef.current = props.onDraftChange;
  }, [props.onDraftChange]);

  useEffect(() => {
    onReportDraftChangeRef.current = props.onReportDraftChange;
  }, [props.onReportDraftChange]);

  useEffect(() => () => {
    if (resultsFocusRevealFrameRef.current !== null) {
      window.cancelAnimationFrame(resultsFocusRevealFrameRef.current);
      resultsFocusRevealFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    setEditor(null);
    const occurrence = view?.occurrence ?? null;
    if (occurrence !== null && lastNotesOccurrenceRef.current !== null && lastNotesOccurrenceRef.current !== occurrence) {
      setNotesDrafts([]);
    }
    if (occurrence !== null) lastNotesOccurrenceRef.current = occurrence;
    setCommitPending(false);
    setLocalError(null);
    setJ4Catalog(null);
    setJ4Binding(null);
    setJ4Pending(false);
    if (!viewKey) {
      setCopyOpen(false);
      setCloseOpen(false);
      setTab("table");
    }
  }, [viewKey]);

  useEffect(() => {
    setReportTextDraft((current) => {
      if (!current || !report) return null;
      if (current.definitionId !== report.definitionId || current.type !== report.type) return null;
      return !view || current.occurrence === view.occurrence ? current : null;
    });
  }, [view?.occurrence, report?.definitionId, report?.type]);

  useLayoutEffect(() => {
    if (commitPending || !focusRejectedEditorRef.current) return;
    const input = editorInputRef.current;
    if (!editor || !input) {
      focusRejectedEditorRef.current = null;
      return;
    }
    if (props.busy || currentness === "unknown" || input.disabled) return;
    const intent = focusRejectedEditorRef.current;
    focusRejectedEditorRef.current = null;
    if (completionMayUpdateUi(intent)) withAppFocus(() => input.focus());
  }, [commitPending, currentness, editor, props.busy]);

  useEffect(() => {
    if (!view) {
      setSelectedEntity(null);
      return;
    }
    const entities = view.table.rows.map(rowEntity);
    setSelectedEntity((previous) => (previous && entities.includes(previous) ? previous : entities[0] ?? null));
  }, [view]);

  const table = view?.table ?? null;
  const columns = useMemo(() => (table ? tableColumns(table) : []), [table]);
  const hasDraftRow = Boolean(table?.native_table_profile && onInsertRow);
  const boundRowDraft = rowDraft?.occurrence === view?.occurrence && rowDraft?.collection === table?.collection.id ? rowDraft : null;
  const gridOrder = useMemo(() => {
    if (!table) return [] as GridPosition[];
    const tableCols = tableColumns(table);
    const order = table.rows.flatMap((row) => {
      const entity = rowEntity(row);
      return tableCols.map((column) => ({
        entity,
        field: column.id,
      }));
    });
    if (hasDraftRow) order.push(...tableCols.map(column => ({ entity: DRAFT_ROW, field: column.id })));
    return order;
  }, [table, hasDraftRow]);
  const gridWindowed = (table?.rows.length ?? 0) > GRID_WINDOW_THRESHOLD;
  const names = useMemo(() => sourceNames(interop?.metadata ?? null, importedSourceName), [interop?.metadata, importedSourceName]);
  const rowIndexByEntity = useMemo(() => {
    const indices = new Map<string, number>();
    table?.rows.forEach((row, index) => indices.set(rowEntity(row), index));
    return indices;
  }, [table]);

  function address(position: GridPosition): CellAddress {
    return { row: rowIndexByEntity.get(position.entity) ?? -1, column: columns.findIndex(column => column.id === position.field) };
  }
  const clipboardIdentityRef = useRef(collectionIdentity);
  clipboardIdentityRef.current = collectionIdentity;
  const boundSelection = cellSelection?.identity === collectionIdentity && cellSelection?.revision === view?.revision ? cellSelection : null;
  const selectionRectangle = boundSelection ? rectangle(address(boundSelection.anchor), address(boundSelection.end)) : null;
  useEffect(() => { setCellSelection(null); setClipboardMessage(null); }, [collectionIdentity]);

  function extendSelection(anchor: GridPosition, end: GridPosition): void {
    if (!view || !collectionIdentity || anchor.entity === DRAFT_ROW || end.entity === DRAFT_ROW) return;
    setCellSelection({ identity: collectionIdentity, revision: view.revision, anchor, end });
    focusCell(end.entity, end.field);
  }

  function clipboardPosition(target: EventTarget | null): GridPosition | null {
    if (!(target instanceof Element) || target.closest('input, textarea, [contenteditable="true"]')) return null;
    const cell = target.closest<HTMLElement>('td[data-work-field]');
    return cell?.dataset.workEntity && cell.dataset.workField ? { entity: cell.dataset.workEntity, field: cell.dataset.workField } : null;
  }

  function copyGrid(event: React.ClipboardEvent<HTMLTableElement>): void {
    const position = clipboardPosition(event.target);
    if (!position || !table || currentness !== "current" || props.appearancePreference.getSnapshot().composing) return;
    event.preventDefault();
    const point = address(position);
    const area = position.entity === DRAFT_ROW ? null : selectionRectangle ?? rectangle(point, point);
    const rows = area ? table.rows.slice(area.top, area.bottom + 1).map(row => columns.slice(area.left, area.right + 1).map(column => fieldDisplay(fieldForColumn(row, column.id)).text))
      : [[boundRowDraft?.values[position.field] ?? ""]];
    try {
      if (!event.clipboardData) throw new Error("No clipboard data");
      event.clipboardData.setData("text/plain", encodeTsv(rows));
      setClipboardMessage(`Copied ${rows.length} row${rows.length === 1 ? "" : "s"}.`);
    } catch { setClipboardMessage("Copy could not access the clipboard. Select the cells and try Copy again."); }
  }

  function pasteGrid(event: React.ClipboardEvent<HTMLTableElement>): void {
    const position = clipboardPosition(event.target);
    // Input/textarea paste stays with the native text editor and caret.
    if (!position || !view || !witness || !table) return;
    event.preventDefault();
    if (props.appearancePreference.getSnapshot().composing) return;
    let decoded: string[][];
    try {
      if (!event.clipboardData || !Array.from(event.clipboardData.types).includes("text/plain")) {
        setClipboardMessage("The clipboard has no plain text to paste. Copy cells or text and try again."); return;
      }
      decoded = decodeTsv(event.clipboardData.getData("text/plain"));
    } catch (error) { setClipboardMessage(explain(error, "The clipboard could not be read. Nothing was pasted.")); return; }
    const draft = position.entity === DRAFT_ROW;
    const at = address(position);
    const start = draft ? { row: table.rows.length, column: at.column } : selectionRectangle ? { row: selectionRectangle.top, column: selectionRectangle.left } : at;
    const route = routePaste(decoded, { native: Boolean(table.native_table_profile), draft,
      blocked: controlsLocked || rowCommandPendingRef.current || currentness !== "current" || cellDraftActive || anyNotesDraft || hasInvalidReportDraft || rowDraft?.needsReview === true || modalInteractionOpen,
      pendingDraft: rowDraftActive, start, rowCount: table.rows.length, columnTypes: columns.map(column => column.field_type),
      editable: (r, c) => {
        const row = table.rows[r], column = columns[c];
        const field = row && column ? fieldForColumn(row, column.id) : null;
        return Boolean(field?.editable_scalar && !field.formula);
      },
    });
    if (route.kind === "refused") { setClipboardMessage(route.message); return; }
    if (route.kind === "draft") {
      const values = { ...boundRowDraft?.values };
      route.rows[0]!.forEach((value, index) => { values[columns[start.column + index]!.id] = value; });
      setRowDraft({ occurrence: view.occurrence, collection: table.collection.id, values });
      setRowError(null); setLocalError(null);
      setClipboardMessage("Pasted into the new row. Press Enter or choose Add row to add it.");
      return;
    }
    if (!onPasteCells) { setClipboardMessage("Pasting is not available in this view."); return; }
    const anchor = table.rows[start.row];
    if (!anchor || !columns[start.column]) { setClipboardMessage("Select a current cell before pasting."); return; }
    const intent = completionIntent();
    if (editor && editor.value === editor.original) setEditor(null);
    rowCommandPendingRef.current = true;
    setCommitPending(true); setLocalError(null); setClipboardMessage(null);
    void onPasteCells(witness, table.collection.key, rowEntity(anchor), columns[start.column]!.id, route.rows).then(result => {
      if (liveOccurrenceRef.current !== intent.occurrence || clipboardIdentityRef.current !== collectionIdentity) return;
      setClipboardMessage(result.kind === "confirmed" ? `Updated ${route.rows.length} row${route.rows.length === 1 ? "" : "s"}. Save to keep these changes.`
        : result.kind === "refused" ? pasteRefusal(result.message, result.fieldType)
        : "The paste outcome needs review. Refresh to check it; the paste has not been retried.");
    }, () => {
      if (liveOccurrenceRef.current === intent.occurrence && clipboardIdentityRef.current === collectionIdentity) setClipboardMessage("The paste could not be confirmed. Refresh to check it before pasting again.");
    }).finally(() => { rowCommandPendingRef.current = false; setCommitPending(false); });
  }

  // Reconcile roving state from every installed projection, independently of
  // mutation completion or DOM focus intent. Retain the prior order through a
  // temporarily absent recovery view so the same occurrence can recover it.
  useLayoutEffect(() => {
    if (!table || !collectionIdentity) return;
    const previous = focusedProjectionRef.current;
    const rows = [...table.rows.map(rowEntity), ...(hasDraftRow ? [DRAFT_ROW] : [])];
    const fields = columns.map(column => column.id);
    focusedProjectionRef.current = { identity: collectionIdentity, rows, fields };
    if (previous?.identity !== collectionIdentity) {
      setFocusedKey(null);
      lastCellRef.current = null;
      return;
    }
    setFocusedKey(current => {
      // Preserve the established data-row fallback when a published row is
      // removed. The draft becomes the fallback only for an empty table.
      const dataRows = table.rows.map(rowEntity);
      if (hasDraftRow && dataRows.length === 0 && current && !current.startsWith(`${DRAFT_ROW}\u0000`) && fields[0]) return cellKey(DRAFT_ROW, fields[0]);
      const nextRows = current?.startsWith(`${DRAFT_ROW}\u0000`) || dataRows.length === 0 ? rows : dataRows;
      return survivingFocusedKey(current, previous, { rows: nextRows, fields });
    });
  }, [collectionIdentity, table, columns, hasDraftRow]);

  useLayoutEffect(() => {
    if (gridWindowed) syncGridWindow();
  }, [gridWindowed, collectionIdentity, tab, table?.rows.length]);

  useLayoutEffect(() => {
    if (!gridWindowed) return;
    const scroller = gridScrollRef.current;
    const pitch = measuredRowPitch(
      [...(scroller?.querySelectorAll<HTMLElement>("tbody tr.ts-row") ?? [])].map((row) => row.offsetHeight),
    );
    const head = scroller?.querySelector<HTMLElement>("thead");
    if (head && head.offsetHeight > 0 && head.offsetHeight !== gridHeaderHeightRef.current) {
      gridHeaderHeightRef.current = head.offsetHeight;
      setGridHeaderHeight(head.offsetHeight);
    }
    if (pitch !== null && Math.abs(pitch - gridRowHeightRef.current) > 0.5) {
      gridRowHeightRef.current = pitch;
      setGridRowHeight(pitch);
      syncGridWindow();
    }
    // A pending focus target only lives while the Table panel shows its row.
    if (pendingCellFocusRef.current && (tab !== "table" || !rowIndexByEntity.has(pendingCellFocusRef.current.entity))) {
      pendingCellFocusRef.current = null;
    }
    const pending = pendingCellFocusRef.current;
    if (pending && pending.generation !== focusIntentRef.current) {
      pendingCellFocusRef.current = null;
      return;
    }
    const node = pending ? cellRefs.current.get(cellKey(pending.entity, pending.field)) : null;
    if (node) {
      pendingCellFocusRef.current = null;
      withAppFocus(() => node.focus());
    }
  });

  useLayoutEffect(() => {
    const scroller = gridScrollRef.current;
    const row = scroller?.querySelector<HTMLElement>(".ts-entry-row");
    const footer = scroller?.querySelector<HTMLElement>(".ts-entry-footer");
    if (!scroller || !row || !footer || !row.contains(document.activeElement)) return;
    const port = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const delta = focusRevealScrollDelta(
      { top: rowRect.top, bottom: footerRect.bottom },
      { top: port.top + scroller.clientTop, bottom: port.top + scroller.clientTop + scroller.clientHeight },
    );
    if (delta !== 0) scroller.scrollTop += delta;
  }, [focusedKey, editor?.entity, rowDraftActive, rowError, tab]);

  useEffect(() => () => {
    if (gridScrollFrameRef.current !== null) window.cancelAnimationFrame(gridScrollFrameRef.current);
  }, []);

  useEffect(() => {
    const onUserIntent = (event: Event) => {
      // Typing in the live editor is not a new choice; a click on the
      // disabled editor while its commit is pending is.
      const editorInput = editorInputRef.current;
      if (appFocusingRef.current || (event.target === editorInput && editorInput && !editorInput.disabled)) return;
      focusIntentRef.current += 1;
    };
    // focusin also covers focus moved by assistive technology or script.
    const events = ["pointerdown", "keydown", "focusin"] as const;
    for (const type of events) document.addEventListener(type, onUserIntent, true);
    return () => {
      for (const type of events) document.removeEventListener(type, onUserIntent, true);
    };
  }, []);

  // The scrollport's height follows the window and panel layout; a taller
  // viewport must render more rows, not reveal blank spacer.
  useEffect(() => {
    const scroller = gridScrollRef.current;
    if (!gridWindowed || !scroller || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => onGridScroll());
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [gridWindowed, tab, collectionIdentity]);

  const selectedRow = useMemo(() => {
    if (!table) return null;
    const rows = table.rows;
    return rows.find((row) => rowEntity(row) === selectedEntity) ?? rows[0] ?? null;
  }, [table, selectedEntity]);
  const notesField = useMemo(() => {
    if (!selectedRow) return null;
    return notesFieldFor(selectedRow, columns);
  }, [selectedRow, columns]);

  const notesCommitted = notesField ? seedTextOf(notesField) : "";
  const activeNotesDraft = notesDrafts.find(
    (draft) =>
      view &&
      selectedRow &&
      draft.occurrence === view.occurrence &&
      draft.entity === rowEntity(selectedRow),
  );
  const notesDraftBound = isNotesDraftBound(activeNotesDraft, notesCommitted);
  const notesValue = activeNotesDraft?.value ?? notesCommitted;
  const notesDirty = activeNotesDraft !== undefined && activeNotesDraft.value !== notesCommitted;
  const anyNotesDraft = notesDrafts.length > 0;
  const notesEditable = Boolean(notesField && notesField.editable_scalar === "text");
  const notesStale = notesDirty && !notesDraftBound;

  useEffect(() => {
    setNotesDrafts((drafts) => markNotesConflicts(drafts, view));
  }, [view]);

  function keepNotesDraft(): void {
    if (!activeNotesDraft) return;
    const kept = keptNotesDraft(activeNotesDraft, notesCommitted);
    setNotesDrafts((drafts) => drafts.map((draft) => (draft === activeNotesDraft ? kept : draft)));
  }

  useEffect(() => {
    if (captureCopyParentFailure) {
      if (message === null) {
        copyParentMessageAtAttemptRef.current = null;
      } else if (message !== copyParentMessageAtAttemptRef.current) {
        setCopyParentFailureMessage(message);
        setCaptureCopyParentFailure(false);
      }
      return;
    }
    if (copyParentFailureMessage !== null && message !== copyParentFailureMessage) {
      setCopyParentFailureMessage(null);
    }
  }, [captureCopyParentFailure, copyParentFailureMessage, message]);

  const controlsLocked = busy || commitPending || currentness === "unknown";
  const saveUnavailableReason = closeSaveUnavailableReason({ saveStatus, currentness, busy: controlsLocked, workFileSaveUnavailableReason: view?.openedFromWorkFile ? workFileSaveUnavailableReason : null }, false);
  const modalInteractionOpen = deleteName !== null || newTableOpen || copyOpen || closeOpen || downloadFormat !== null || Boolean(interop?.importInspection);
  const historyDraftLocked = editor !== null || anyNotesDraft || rowDraftActive;
  const historyInteractionLocked = historyDraftLocked || modalInteractionOpen;
  useLayoutEffect(() => {
    const request = historyFocusRequest;
    if (!request || historyFocusRequestRef.current !== request) return;
    if ((view && view.occurrence !== request.occurrence) || (!view && currentness !== "unknown")) {
      historyFocusRequestRef.current = null;
      setHistoryFocusRequest(null);
      return;
    }
    if (!request.settled || busy || commitPending) return;

    const shell = shellRef.current;
    let destination: HTMLElement | null = null;
    if (historyFocusDestinationIsUsable(request.userDestination, shell)) {
      destination = request.userDestination;
    } else if (request.publicationTarget && view) {
      const target = request.publicationTarget;
      const matches = gridOrder.filter((entry) => entry.entity === target.entity && entry.field === target.field);
      const cell = matches.length === 1 ? cellRefs.current.get(cellKey(target.entity, target.field)) ?? null : null;
      if (historyFocusDestinationIsUsable(cell, shell)) destination = cell;
      const index = rowIndexByEntity.get(target.entity);
      if (!cell && matches.length === 1 && gridWindowed && tab === "table" && index !== undefined) {
        // The published cell is outside the rendered window: reveal it and
        // let the pending-focus pass focus it once it is mounted.
        pendingCellFocusRef.current = { entity: target.entity, field: target.field, generation: focusIntentRef.current };
        revealGridRow(index);
        historyFocusRequestRef.current = null;
        setHistoryFocusRequest(null);
        return;
      }
    }
    destination = firstUsableCompletionTarget([
      destination,
      request.initiator,
      currentness === "unknown" ? recoveryRefreshRef.current : null,
      commandOverflowSummaryRef.current,
      desktopRefreshRef.current,
    ], (target) => historyFocusDestinationIsUsable(target, shell));
    if (destination && document.activeElement !== destination) destination.focus();
    historyFocusRequestRef.current = null;
    setHistoryFocusRequest(null);
  }, [busy, commitPending, currentness, gridOrder, gridWindowed, historyFocusRequest, rowIndexByEntity, view]);

  useLayoutEffect(() => {
    const occurrence = view?.occurrence ?? null;
    if (resultsOccurrenceRef.current !== occurrence) {
      if (resultsOccurrenceRef.current !== null) setResultsHidden(false);
      resultsOccurrenceRef.current = occurrence;
    }
  }, [view?.occurrence]);

  useLayoutEffect(() => {
    if (resultsWasHiddenRef.current && !resultsHidden) resultsHideButtonRef.current?.focus();
    resultsWasHiddenRef.current = resultsHidden;
  }, [resultsHidden]);

  function dismissSalesTip(): void {
    const occurrence = view?.occurrence;
    const revision = view?.revision;
    onDismissSalesEntryTip();
    window.requestAnimationFrame(() => {
      const prior = lastCellRef.current;
      if (prior?.isConnected && prior.dataset.workOccurrence === occurrence && prior.dataset.workRevision === revision) {
        prior.focus();
        return;
      }
      const first = gridOrder[0];
      if (!first) return;
      const cell = cellRefs.current.get(cellKey(first.entity, first.field));
      if (cell?.isConnected && cell.dataset.workOccurrence === occurrence && cell.dataset.workRevision === revision) cell.focus();
    });
  }

  useLayoutEffect(() => {
    if (!view || !salesCatalogLayoutEligible(view, salesCatalogLayout) || focusedSalesOccurrenceRef.current === view.occurrence) return;
    const target = salesCatalogFocusTarget(view, salesCatalogLayout);
    if (!target) return;
    const cell = cellRefs.current.get(cellKey(target.entity, target.field));
    if (!cell || cell.dataset.workOccurrence !== view.occurrence || cell.dataset.workRevision !== view.revision) return;
    focusedSalesOccurrenceRef.current = view.occurrence;
    setSelectedEntity(target.entity);
    cell.focus({ preventScroll: true });
    const gridScroll = gridScrollRef.current;
    if (gridScroll) scrollCellIntoGridNearest(cell, gridScroll);
  }, [salesCatalogLayout, view, gridOrder]);

  useEffect(() => {
    function onHistoryKeyDown(event: KeyboardEvent): void {
      const shell = shellRef.current;
      if (!shell || !shell.isConnected || !view || currentness !== "current" || event.defaultPrevented) return;
      const ownerDocument = shell.ownerDocument;
      const focusedElement = ownerDocument.activeElement;
      const target = event.target;
      const neutralFocus = focusedElement === ownerDocument.body || focusedElement === ownerDocument.documentElement;
      const neutralTarget = target === ownerDocument || target === ownerDocument.body || target === ownerDocument.documentElement;
      const targetInShell = target instanceof Node && shell.contains(target);
      const focusInShell = focusedElement instanceof Node && shell.contains(focusedElement);
      if (!((targetInShell && (focusInShell || neutralFocus)) || (neutralTarget && neutralFocus))) return;
      if (localHistory.occurrence !== view.occurrence || localHistory.revision !== view.revision) return;
      if (rowDraftActive && !modalInteractionOpen && historyCommandForKey(event, target, props.appearancePreference.getSnapshot().composing || controlsLocked, focusedElement)) {
        event.preventDefault();
        setLocalError("Add or discard the new row first.");
        return;
      }
      const direction = historyCommandForKey(
        event,
        target,
        historyInteractionLocked || props.appearancePreference.getSnapshot().composing || controlsLocked,
        focusedElement,
      );
      if (!direction || (direction === "undo" ? localHistory.undoCount < 1 : localHistory.redoCount < 1)) return;
      event.preventDefault();
      void requestHistory(direction, focusedElement instanceof HTMLElement ? focusedElement : null);
    }
    window.addEventListener("keydown", onHistoryKeyDown);
    return () => window.removeEventListener("keydown", onHistoryKeyDown);
  }, [controlsLocked, currentness, historyInteractionLocked, localHistory, modalInteractionOpen, onHistory, props.appearancePreference, rowDraftActive, view]);
  const cellDraftActive = editor !== null && editor.entity !== DRAFT_ROW && editor.value !== editor.original;
  const workFileDownloadLocked = controlsLocked || currentness !== "current" || cellDraftActive || rowDraftActive || anyNotesDraft || hasInvalidReportDraft || workFileUnavailableReason !== null;
  const draftActive =
    cellDraftActive || rowDraftActive || anyNotesDraft || (copyOpen && copyName.trim() !== "") ||
    (newTableOpen && newTableDraftActive);
  const errorMessage = props.startupUnavailable ? null : localError ?? copyError ??
    (salesEntryOutcome?.kind === "refused" ? null : message && message.length > 0 ? message : null);
  const importErrorMessage = interop?.importInspection
    ? (importError && message && message.length > 0 ? importConfirmationMessage(message) : importError)
    : importError;
  const closeSaveError = closeSaveAttempted && (saveStatus === "failed" || localError !== null)
    ? errorMessage ?? "The copy could not be saved on this device." : null;
  const closeSaveErrorIsInline = closeOpen && !copyOpen && !savedClose && closeSaveError !== null;
  const copyErrorIsInline = copyOpen && localError === null && (
    copyError !== null || (copyParentFailureMessage !== null && message === copyParentFailureMessage)
  );
  const importErrorIsInline = Boolean(
    importError && localError === null && copyError === null &&
      errorMessage !== null && (errorMessage === importErrorMessage || Boolean(interop?.importInspection) && errorMessage === message),
  );
  const downloadErrorIsInline = Boolean(
    tab === "interop" && interop?.downloadStatus === "failed" &&
      interop.downloadError !== null && errorMessage === message && message === interop.downloadError,
  );

  useLayoutEffect(() => {
    if (!importPending && importError && interop?.importInspection) {
      // A short Import dialog scrolls as one outer frame. Return focus to its
      // enabled retry action after rejection so the error and retry controls
      // are both visible after the pending heading handoff.
      importRetryButtonRef.current?.focus();
    }
  }, [importPending, importError, interop?.importInspection]);

  useLayoutEffect(() => {
    const grid = gridScrollRef.current;
    const appRoot = grid?.closest<HTMLElement>(".ts-app");
    const panel = grid?.closest<HTMLElement>(".ts-panel");
    if (!grid || !appRoot || !panel || !view || tab !== "table") return;

    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const gridTop = grid.getBoundingClientRect().top;
      const available = availableGridScrollHeight(gridTop, panel.getBoundingClientRect().bottom);
      grid.style.setProperty(
        "--ts-grid-available-height",
        `${available}px`,
      );
      if (salesCatalogLayoutEligible(view, salesCatalogLayout)) {
        grid.style.setProperty("--ts-sales-grid-max-height", `${Math.max(168, Math.min(window.innerHeight * 0.55, available * 0.55))}px`);
      } else grid.style.removeProperty("--ts-sales-grid-max-height");
    };
    const scheduleMeasure = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    };

    measure();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    if (resizeObserver) {
      resizeObserver.observe(panel);
      appRoot.querySelectorAll<HTMLElement>(
        ".ts-workbook-head, .ts-work-context, .ts-workspace-footer, .ts-hint, .ts-notice, .ts-error",
      ).forEach((element) => resizeObserver.observe(element));
    }
    const profileObserver = new MutationObserver(scheduleMeasure);
    profileObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "data-ts-profile-color-scheme",
        "data-ts-profile-typography",
        "data-ts-profile-density",
        "data-ts-profile-chrome",
      ],
    });
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", scheduleMeasure);
    visualViewport?.addEventListener("resize", scheduleMeasure);

    return () => {
      window.removeEventListener("resize", scheduleMeasure);
      visualViewport?.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
      profileObserver.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      grid.style.removeProperty("--ts-grid-available-height");
      grid.style.removeProperty("--ts-sales-grid-max-height");
    };
  }, [view, tab, currentness, errorMessage, busy, commitPending, salesCatalogLayout]);

  useEffect(() => {
    onDraftChangeRef.current(draftActive);
  }, [draftActive]);

  useEffect(() => {
    if (!savedClose || busy || copyPending) return;
    if (savedClose.intent !== closeSaveIntentRef.current) {
      setSavedClose(null);
      return;
    }
    // Closing the name dialog clears its disposable draft. Let that existing
    // notification update the parent's save/dirty indicators before confirming.
    if (savedClose.phase === "clear-draft") {
      setSavedClose({ ...savedClose, phase: "confirm" });
      return;
    }
    setSavedClose(null);
    if (savedCloseIsConfirmed(savedClose, { view, saveStatus, dirty, currentness }, draftActive || hasInvalidReportDraft)) {
      setCopyForClose(false);
      void closeWork();
    } else {
      setCopyOpen(true);
      setCopyName(savedClose.name);
      setCopyError("Saving the current changes could not be confirmed. Keep this work open and try again.");
    }
  }, [savedClose, busy, copyPending, saveStatus, dirty, draftActive, hasInvalidReportDraft, currentness, view]);

  useEffect(() => {
    const onPointerTermination = (event: PointerEvent) => clearOwnedSharedPointer(heldPointerOwnerRef, event.pointerId);
    const onWindowBlur = () => clearHeldSharedButtons(heldPointerOwnerRef);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("pointerup", onPointerTermination, true);
    document.addEventListener("pointercancel", onPointerTermination, true);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("pointerup", onPointerTermination, true);
      document.removeEventListener("pointercancel", onPointerTermination, true);
      clearHeldSharedButtons(heldPointerOwnerRef);
    };
  }, []);

  useEffect(() => {
    onReportDraftChangeRef.current(hasInvalidReportDraft);
  }, [hasInvalidReportDraft]);

  useEffect(
    () => () => {
      onDraftChangeRef.current(false);
      onReportDraftChangeRef.current(false);
    },
    [],
  );

  const witness: ViewWitness | null = useMemo(
    () => (view ? { occurrence: view.occurrence, revision: view.revision } : null),
    [view?.occurrence, view?.revision],
  );

  const runCommit = useCallback(
    async (
      target: FieldProjection["target"],
      edit: Parameters<SheetShellProps["onCommit"]>[2],
      onRejected?: () => void,
    ): Promise<boolean> => {
      if (!witness) return false;
      setCommitPending(true);
      try {
        const accepted = await onCommit(witness, target, edit);
        if (!accepted) {
          onRejected?.();
          setLocalError("The work did not accept this value. The draft was kept so you can correct it.");
        }
        return accepted;
      } catch (error) {
        onRejected?.();
        setLocalError(explain(error, "The work could not apply this change. The draft was kept."));
        return false;
      } finally {
        setCommitPending(false);
      }
    },
    [onCommit, witness],
  );

  function beginEdit(entity: string, field: FieldProjection | null, seed?: string): void {
    if (!field || !field.editable_scalar || controlsLocked) return;
    if (editor && editor.entity !== DRAFT_ROW && editor.value !== editor.original && (editor.entity !== entity || editor.field !== field.target.field)) {
      setLocalError("Apply or cancel the value you are editing before you edit another cell.");
      focusCell(editor.entity, editor.field);
      return;
    }
    const original = seedTextOf(field);
    selectEditorValueOnFocusRef.current = seed === undefined;
    focusRejectedEditorRef.current = null;
    setLocalError(null);
    setSelectedEntity(entity);
    setEditor({
      entity,
      field: field.target.field,
      kind: field.editable_scalar,
      value: seed === undefined ? original : seed,
      original,
    });
  }

  function changeRowDraft(field: string, value: string): void {
    if (!view || !table || controlsLocked || rowCommandPendingRef.current) return;
    setRowError(null);
    setRowDraft(current => ({
      occurrence: view.occurrence, collection: table.collection.id,
      needsReview: current?.occurrence === view.occurrence && current.collection === table.collection.id ? current.needsReview : undefined,
      values: { ...(current?.occurrence === view.occurrence && current.collection === table.collection.id ? current.values : {}), [field]: value },
    }));
  }

  function beginDraftEdit(column: TableColumn, seed?: string): void {
    if (!hasDraftRow || controlsLocked || currentness !== "current" || rowCommandPendingRef.current || refuseWhileCellDraft("editing the new row")) return;
    const kind = column.field_type;
    if (kind !== "text" && kind !== "number" && kind !== "date" && kind !== "boolean") return;
    const original = boundRowDraft?.values[column.id] ?? "";
    selectEditorValueOnFocusRef.current = seed === undefined;
    focusRejectedEditorRef.current = null;
    setEditor({ entity: DRAFT_ROW, field: column.id, kind, original, value: seed ?? original });
    if (seed !== undefined) changeRowDraft(column.id, seed);
  }

  function cancelEdit(): void {
    if (controlsLocked || rowCommandPendingRef.current) return;
    const cancelled = editor;
    if (cancelled?.entity === DRAFT_ROW) changeRowDraft(cancelled.field, cancelled.original);
    setEditor(null);
    setLocalError(null);
    if (cancelled) focusCell(cancelled.entity, cancelled.field);
  }

  function focusCell(entity: string, field: string): void {
    const node = cellRefs.current.get(cellKey(entity, field));
    if (node) {
      node.focus();
      return;
    }
    // A windowed row outside the rendered range: render it, then focus it.
    const index = rowIndexByEntity.get(entity);
    if (!gridWindowed || tab !== "table" || index === undefined) return;
    pendingCellFocusRef.current = { entity, field, generation: focusIntentRef.current };
    revealGridRow(index);
  }

  function syncGridWindow(): void {
    const scroller = gridScrollRef.current;
    if (!scroller || !table) return;
    const next = gridWindowRange(scroller.scrollTop, scroller.clientHeight, gridRowHeightRef.current, table.rows.length);
    setGridRange((current) => current.start === next.start && current.end === next.end ? current : next);
  }

  function onGridScroll(): void {
    if (!gridWindowed || gridScrollFrameRef.current !== null) return;
    gridScrollFrameRef.current = window.requestAnimationFrame(() => {
      gridScrollFrameRef.current = null;
      syncGridWindow();
    });
  }

  function revealGridRow(index: number): void {
    const scroller = gridScrollRef.current;
    if (scroller) {
      const top = scrollTopToReveal(index, gridRowHeightRef.current, gridHeaderHeightRef.current, scroller.scrollTop, scroller.clientHeight);
      if (top !== null) scroller.scrollTop = top;
    }
    const rowCount = table?.rows.length ?? 0;
    setGridRange((current) => gridWindowAround(index, current, rowCount));
  }

  async function requestHistory(direction: "undo" | "redo", initiator: HTMLElement | null): Promise<void> {
    if (historyInteractionLocked || controlsLocked || historyFocusRequestRef.current) return;
    const request: HistoryFocusRequest = {
      operationId: ++historyOperationIdRef.current,
      occurrence: view?.occurrence ?? null,
      initiator,
      publicationTarget: null,
      userDestination: null,
      settled: false,
    };
    historyFocusRequestRef.current = request;
    setHistoryFocusRequest(request);
    let publicationTarget: FieldTarget | null = null;
    try {
      publicationTarget = await onHistory(direction);
    } catch {
      // App owns outcome classification and recovery. Focus only restores after
      // that operation reaches its final, rendered state.
    }
    const currentRequest = historyFocusRequestRef.current;
    if (!mountedRef.current || !currentRequest || currentRequest.operationId !== request.operationId) return;
    const settledRequest = { ...currentRequest, publicationTarget, settled: true };
    historyFocusRequestRef.current = settledRequest;
    setHistoryFocusRequest(settledRequest);
  }

  function moveFocus(event: ReactKeyboardEvent<HTMLElement>, position: GridPosition, step: number): boolean {
    const index = gridOrder.findIndex((item) => item.entity === position.entity && item.field === position.field);
    if (index < 0) return false;
    const next = index + step;
    if (next < 0 || next >= gridOrder.length) return false;
    const target = gridOrder[next];
    if (!target) return false;
    event.preventDefault();
    setSelectedEntity(target.entity);
    focusCell(target.entity, target.field);
    return true;
  }

  async function commitEditor(): Promise<boolean> {
    if (!editor || commitPending || controlsLocked || rowCommandPendingRef.current) return false;
    if (editor.entity === DRAFT_ROW) {
      setEditor(null);
      return true;
    }
    const field = currentEditorField(editor);
    if (!field) {
      setEditor(null);
      return false;
    }
    // Accepting an unchanged editor is navigation, not a Work mutation. Work
    // truthfully refuses no-op edits, which must not strand Enter/Tab here.
    if (editor.value === editor.original) {
      setEditor(null);
      setLocalError(null);
      return true;
    }
    let edit: Parameters<SheetShellProps["onCommit"]>[2];
    if (editor.kind === "boolean") {
      const parsed = parseBooleanDraft(editor.value);
      if (parsed === null) {
        setLocalError("Enter true or false for this boolean cell. The draft was kept.");
        return false;
      }
      edit = { kind: "boolean", value: parsed };
    } else {
      edit = scalarEditOf(editor.kind, editor.value);
    }
    const intent = completionIntent();
    const accepted = await runCommit(field.target, edit, () => {
      focusRejectedEditorRef.current = intent;
    });
    if (accepted) {
      setEditor(null);
      setLocalError(null);
      // The publication may settle after the user has already chosen another
      // cell or control; never pull focus back from that newer choice.
      if (completionMayUpdateUi(intent)) withAppFocus(() => focusCell(editor.entity, editor.field));
    }
    return accepted;
  }

  /** Focus moved by a completion itself is not a new user choice. */
  function withAppFocus(move: () => void): void {
    appFocusingRef.current = true;
    try {
      move();
    } finally {
      appFocusingRef.current = false;
    }
  }

  function completionIntent(): { generation: number; occurrence: string | null } {
    return { generation: focusIntentRef.current, occurrence: liveOccurrenceRef.current };
  }

  // Selection and DOM focus require unchanged intent. Roving state must
  // still name a surviving cell when the previously focused row disappears.
  function completionMayUpdateUi(intent: { generation: number; occurrence: string | null }): boolean {
    return completionIntentIsCurrent(intent, completionIntent());
  }

  useLayoutEffect(() => {
    const generation = newTableFocusIntentRef.current;
    if (generation === null || newTableOpen || !view) return;
    newTableFocusIntentRef.current = null;
    const intent = { generation, occurrence: view.occurrence };
    requestAnimationFrame(() => {
      if (!completionMayUpdateUi(intent)) return;
      withAppFocus(() => {
        const firstCell = gridScrollRef.current?.querySelector<HTMLElement>("td[data-testid^='cell:']");
        const firstEntry = shellRef.current?.querySelector<HTMLElement>(".ts-entry-row [data-entry-field]");
        (firstCell ?? firstEntry)?.focus();
      });
    });
  }, [newTableOpen, view]);

  function onCellKeyDown(
    event: ReactKeyboardEvent<HTMLTableCellElement>,
    entity: string,
    field: FieldProjection | null,
    position: GridPosition,
  ): void {
    if (isComposingEvent(event) || props.appearancePreference.getSnapshot().composing) return;
    const draft = entity === DRAFT_ROW;
    if (!draft && event.key === "Escape") { event.preventDefault(); setCellSelection(null); return; }
    if (!draft && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      const next = stepAddress(address(position), event.key, table?.rows.length ?? 0, columns.length);
      const row = table?.rows[next.row], column = columns[next.column];
      if (row && column) { event.preventDefault(); extendSelection(boundSelection?.anchor ?? position, { entity: rowEntity(row), field: column.id }); }
      return;
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Enter", "F2"].includes(event.key)) setCellSelection(null);
    const editable = (draft || Boolean(field?.editable_scalar)) && !controlsLocked;
    if (draft && (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey && position.field === columns.at(-1)?.id))) {
      const mayPublish = Boolean(view && witness && onInsertRow) && !rowInsertBlocked();
      const action = draftKeyAction(event.key, event.shiftKey, position.field === columns.at(-1)?.id, draftReadiness(columns, boundRowDraft?.values ?? {}), mayPublish);
      if (action === "leave") {
        if (mayPublish) showMissingRowHint();
        // Keep the native Tab destination even when publication is blocked.
        return;
      }
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) { event.preventDefault(); return; }
      event.preventDefault();
      if (action === "previous") moveFocus(event, position, -columns.length);
      else if (action === "edit") beginDraftEdit(columns.find(column => column.id === position.field)!);
      else void addRow(event.key === "Enter");
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      if (!editable) return;
      event.preventDefault();
      if (draft) beginDraftEdit(columns.find(column => column.id === position.field)!);
      else beginEdit(entity, field);
      return;
    }
    if (event.key === "Tab") {
      moveFocus(event, position, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      moveFocus(event, position, event.key === "ArrowUp" ? -columns.length : columns.length);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      moveFocus(event, position, event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (
      editable &&
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (draft) beginDraftEdit(columns.find(column => column.id === position.field)!, event.key);
      else beginEdit(entity, field, event.key);
    }
  }

  function onEditorKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (isComposingEvent(event) || props.appearancePreference.getSnapshot().composing) return;
    // Keep editor input and caret keys from being reinterpreted by the cell grid.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && editor) {
      event.preventDefault();
      const position = { entity: editor.entity, field: editor.field };
      const mayPublish = Boolean(view && witness && onInsertRow) && !rowInsertBlocked();
      const action = draftKeyAction(event.key, event.shiftKey, editor.field === columns.at(-1)?.id, draftReadiness(columns, boundRowDraft?.values ?? {}), mayPublish);
      if (editor.entity === DRAFT_ROW) {
        if (action === "leave") {
          if (mayPublish) showMissingRowHint();
          const row = event.currentTarget.closest("tr");
          setEditor(null);
          if (row) focusAfterDraftRow(row);
          return;
        }
        if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
        if (action === "edit") {
          // Empty Enter accepts this editor but cannot author an empty row.
          setEditor(null);
          withAppFocus(() => focusCell(DRAFT_ROW, editor.field));
          return;
        }
        if (action === "publish") {
          setEditor(null);
          void addRow(event.key === "Enter");
          return;
        }
      }
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const step = (event.shiftKey ? -1 : 1) * (event.key === "Enter" ? columns.length : 1);
      const intent = completionIntent();
      void commitEditor().then((accepted) => {
        if (accepted && completionMayUpdateUi(intent)) withAppFocus(() => {
          if (!moveFocus(event, position, step)) focusCell(position.entity, position.field);
        });
      });
    }
  }

  function focusAfterDraftRow(row: HTMLTableRowElement): void {
    const candidates = shellRef.current?.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]") ?? [];
    const next = Array.from(candidates).find(node =>
      !row.contains(node) && (row.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
      node.tabIndex >= 0 && !node.matches(":disabled") && !node.closest("[inert]") && node.getClientRects().length > 0,
    );
    if (next) withAppFocus(() => next.focus());
  }

  function showMissingRowHint(): TableColumn | undefined {
    const values = boundRowDraft?.values ?? {};
    if (!hasDraftInput(values) || !table) return undefined;
    const missing = firstMissingDraftColumn(columns, values);
    if (missing) setRowError({ message: `Add ${names.column(table.collection.id, missing.id) ?? missing.display_name} to add this row.`, fields: [missing.id], missing: true });
    return missing;
  }

  // An unapplied cell value is never published implicitly. Anything else that
  // installs a new revision (or may clear the view) would drop it, so refuse
  // and return to the Table panel, whose editor autofocus retains the draft.
  function refuseWhileCellDraft(action: string): boolean {
    if (!cellDraftActive) return false;
    setLocalError(`Apply or cancel the value you are editing before ${action}.`);
    setTab("table");
    // Already on Table, the editor does not remount; return focus explicitly.
    window.requestAnimationFrame(() => editorInputRef.current?.focus());
    return true;
  }

  async function applyNotes(): Promise<void> {
    if (!notesField || !notesEditable || !notesDirty || !notesDraftBound || controlsLocked) return;
    if (refuseWhileCellDraft("applying notes")) return;
    const applied = activeNotesDraft;
    const accepted = await runCommit(notesField.target, { kind: "text", value: notesValue });
    if (accepted && applied) {
      setNotesDrafts((drafts) => dropAppliedNotesDraft(drafts, applied));
      setLocalError(null);
    }
  }

  function onNotesKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (isComposingEvent(event)) return;
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      void applyNotes();
    }
  }

  async function openSaved(name: string): Promise<void> {
    setSalesEntryOutcome(null);
    setLocalError(null);
    try {
      await onOpenSaved(name);
    } catch (error) {
      setLocalError(explain(error, `Could not open the saved copy “${name}”.`));
    }
  }

  async function selectCollection(next: string): Promise<void> {
    if (!witness || next === view?.table.collection.key) return;
    if (cellDraftActive || rowDraftActive) {
      setLocalError(rowDraftActive ? "Add or discard the new row first." : "Apply or cancel the unfinished input before switching tables.");
      if (editor) focusCell(editor.entity, editor.field);
      return;
    }
    if (editor && editor.value === editor.original) setEditor(null);
    setLocalError(null);
    try {
      await onSelectCollection(witness, next);
    } catch (error) {
      setLocalError(explain(error, "Could not switch to that table."));
    }
  }

  async function openExample(): Promise<void> {
    setSalesEntryOutcome(null);
    setLocalError(null);
    try {
      await onOpenExample();
    } catch (error) {
      setLocalError(explain(error, "Could not open the example work."));
    }
  }

  async function openJ4Canary(): Promise<void> {
    setSalesEntryOutcome(null);
    setLocalError(null);
    try {
      setSalesEntryOutcome(await onOpenJ4Canary());
    } catch (error) {
      setSalesEntryOutcome(null);
      setLocalError(explain(error, "Could not open the sales example."));
    }
  }

  async function openFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setSalesEntryOutcome(null);
    setLocalError(null);
    try {
      await onOpenFiles(files);
    } catch (error) {
      setLocalError(explain(error, "The selected folder could not be opened."));
    }
  }

  async function openWorkFile(file: File | null): Promise<void> {
    if (!file) return;
    setLocalError(null);
    try { await onOpenWorkFile(file); }
    catch (error) { setLocalError(workFileOpenRefusal(error)); }
  }

  useEffect(() => {
    if (import.meta.env.MODE !== "acceptance") return;
    // Acceptance exercises resident-work refusals through the same handler
    // as Home's picker, without exposing a second product Open control.
    const attempt = (event: Event) => {
      const detail = (event as CustomEvent<{ file: File; handled: boolean; complete: () => void }>).detail;
      detail.handled = true;
      void openWorkFile(detail.file).finally(detail.complete);
    };
    const attemptSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ name: string; handled: boolean; complete: () => void }>).detail;
      detail.handled = true;
      void openSaved(detail.name).finally(detail.complete);
    };
    window.addEventListener("tachiko-acceptance-open-work-file", attempt);
    window.addEventListener("tachiko-acceptance-open-saved-copy", attemptSaved);
    return () => {
      window.removeEventListener("tachiko-acceptance-open-work-file", attempt);
      window.removeEventListener("tachiko-acceptance-open-saved-copy", attemptSaved);
    };
  });

  function workFileInput(locked: boolean): ReactNode {
    const unavailable = workFileUnavailableReason !== null;
    return <label className={`ts-button ts-home-file-action${locked || unavailable ? " ts-home-file-action--disabled" : ""}`} aria-disabled={locked || unavailable}>
      <span>Open work file…</span>
      <input data-testid="open-work-file" aria-label="Open work file" type="file" accept=".ro" disabled={locked || unavailable} aria-describedby={unavailable ? workFileReasonId : undefined} onChange={(event) => { const input = event.currentTarget; void openWorkFile(input.files?.[0] ?? null).finally(() => { input.value = ""; }); }} />
    </label>;
  }

  async function inspectSpreadsheet(file: File | null): Promise<void> {
    if (!file) return;
    setLocalError(null);
    setImportError(null);
    try { await onInspectImport(file); }
    catch (error) { setImportError(importRefusalMessage(error)); }
  }

  async function importCandidate(): Promise<void> {
    const inspection = interop?.importInspection;
    if (!inspection || importPending) return;
    setImportError(null);
    // Keep focus inside the modal before React disables the activated Import
    // button for this non-abortable dispatched operation.
    importPendingFocusRef.current?.focus();
    setImportPending(true);
    const selection: ImportSelection = {
      column_types: importTypes as ImportSelection["column_types"],
      extra_columns: inspection.source.sheets.map(() => []),
    };
    try {
      const accepted = await onImportCandidate(selection);
      if (!accepted) setImportError("The import was not applied. Your source selection is still available.");
    } catch (error) {
      setImportError(importConfirmationMessage(explain(error, "The import was not applied. Your source selection is still available.")));
    } finally {
      setImportPending(false);
    }
  }

  function cancelImport(): void {
    if (importPending) return;
    setImportError(null);
    onCancelImport();
    // Wait for React to remove the dialog; focusing before that commit would
    // lose focus with the unmounted modal control.
    window.setTimeout(() => spreadsheetInputRef.current?.focus(), 0);
  }

  async function prepareDownload(format: "csv" | "xlsx" | "ro", trigger: HTMLButtonElement): Promise<void> {
    downloadTriggerRef.current = trigger;
    setLocalError(null);
    if (await onPrepareDownload(format)) {
      setDownloadOmissions(format === "ro" ? [...workFileOmissions] : []);
      setDownloadFormat(format);
    }
  }

  function cancelDownload(): void {
    setDownloadFormat(null);
    window.requestAnimationFrame(() => {
      if (downloadTriggerRef.current?.isConnected) downloadTriggerRef.current.focus();
      else desktopRefreshRef.current?.focus();
    });
  }

  async function refresh(): Promise<void> {
    setSalesEntryOutcome(null);
    if (currentness !== "unknown" && refuseWhileCellDraft("refreshing")) return;
    setLocalError(null);
    try {
      await onRefresh();
    } catch (error) {
      setLocalError(explain(error, "The work could not be refreshed."));
    }
  }

  function invalidateCloseSaveIntent(): void {
    closeSaveIntentRef.current = null;
    setSavedClose(null);
  }

  function openCopyDialog(forClose = false): void {
    if (view?.openedFromWorkFile && workFileSaveUnavailableReason) return;
    invalidateCloseSaveIntent();
    if (forClose) closeSaveIntentRef.current = Symbol("close after copy save");
    setCopyError(null);
    setLocalError(null);
    setCopyName(suggestedCopyName(names.title ?? view?.title ?? null, copies.map((copy) => copy.name), savedCopyNamesInSessionRef.current));
    setCopyForClose(forClose);
    setCaptureCopyParentFailure(false);
    setCopyOpen(true);
  }

  function closeCopyDialog(): void {
    if (copyPending) return;
    invalidateCloseSaveIntent();
    setCopyOpen(false);
    setCopyError(null);
    setCopyName("");
    setCaptureCopyParentFailure(false);
    if (copyForClose) {
      setCopyForClose(false);
      requestAnimationFrame(() => closeSaveButtonRef.current?.focus());
    } else {
      saveCopyButtonRef.current?.focus();
    }
  }

  async function saveWork(forClose = false): Promise<void> {
    if (!view || controlsLocked || currentness !== "current" || saveStatus === "saving" || modalInteractionOpen && !forClose) return;
    if (!boundCopyName) { openCopyDialog(forClose); return; }
    if (!onSave || cellDraftActive || rowDraftActive || anyNotesDraft || hasInvalidReportDraft) {
      setLocalError(rowDraftActive ? "Add or discard the new row first." : "Finish or clear the unfinished changes before saving.");
      return;
    }
    const witness = { occurrence: view.occurrence, revision: view.revision };
    const intent = forClose ? Symbol("close after save") : null;
    if (intent) closeSaveIntentRef.current = intent;
    setCloseSaveAttempted(forClose);
    setLocalError(null);
    try {
      if (await onSave() && intent && closeSaveIntentRef.current === intent) {
        setSavedClose({ ...witness, intent, name: boundCopyName, phase: "confirm" });
      }
    } catch (error) { setLocalError(explain(error, "The copy could not be saved on this device.")); }
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!view || event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey ||
          !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void saveWork();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  function cancelDelete(): void {
    if (deletePending) return;
    setDeleteSelection(null); setDeleteError(null);
    requestAnimationFrame(() => {
      const trigger = deleteTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
      else focusHomeAfterDelete();
    });
  }

  function focusHomeAfterDelete(): void {
    const shell = shellRef.current;
    const target = shell?.querySelector<HTMLElement>('.ts-home-copy-action:not(:disabled)') ??
      shell?.querySelector<HTMLElement>('.ts-home-new-command:not(:disabled)') ??
      shell?.querySelector<HTMLElement>('.ts-home-brand h1');
    target?.focus();
  }

  async function deleteCopy(): Promise<void> {
    if (!deleteSelection || !onDeleteCopy || deletePending || controlsLocked) return;
    deletePendingFocusRef.current?.focus();
    setDeletePending(true); setDeleteError(null);
    try {
      await onDeleteCopy(deleteSelection);
      setDeleteSelection(null);
      requestAnimationFrame(focusHomeAfterDelete);
    } catch (error) { setDeleteError(explain(error, "The copy could not be deleted.")); }
    finally { setDeletePending(false); }
  }

  async function createCopy(): Promise<void> {
    const name = copyName.trim();
    if (name === "" || copyPending || controlsLocked) return;
    if (rowDraftActive) {
      setCopyError("Add or discard the new row first.");
      return;
    }
    if (hasInvalidReportDraft) {
      setCopyError("Correct the invalid report presentation text before creating a copy.");
      return;
    }
    copyNameInputRef.current?.focus();
    setCopyError(null);
    copyParentMessageAtAttemptRef.current = message;
    setCaptureCopyParentFailure(true);
    setCopyPending(true);
    setLocalError(null);
    const intent = copyForClose ? closeSaveIntentRef.current : null;
    const closingView = intent && view ? { occurrence: view.occurrence, revision: view.revision, intent } : null;
    try {
      const created = await onCreateCopy(name);
      if (created) {
        savedCopyNamesInSessionRef.current.add(name);
        setCaptureCopyParentFailure(false);
        setCopyParentFailureMessage(null);
        setCopyOpen(false);
        setCopyError(null);
        setCopyName("");
        if (closingView && closeSaveIntentRef.current === closingView.intent) setSavedClose({ ...closingView, name, phase: "clear-draft" });
        else saveCopyButtonRef.current?.focus();
      } else {
        setCopyError(`The copy “${name}” was not created. The name is still here; adjust it and try again.`);
      }
    } catch (error) {
      setCopyError(explain(error, `The copy “${name}” was not created. The name is still here.`));
    } finally {
      setCopyPending(false);
    }
  }

  async function requestClose(): Promise<void> {
    if (busy || commitPending) return;
    invalidateCloseSaveIntent();
    setSalesEntryOutcome(null);
    if (dirty || draftActive || hasInvalidReportDraft || currentness === "unknown") {
      setCloseSaveAttempted(false);
      setCloseOpen(true);
      return;
    }
    await closeWork();
  }

  async function closeWork(): Promise<void> {
    if (saveStatus === "saving") return;
    invalidateCloseSaveIntent();
    setSalesEntryOutcome(null);
    setCloseOpen(false);
    setLocalError(null);
    try {
      await onClose();
    } catch (error) {
      setLocalError(explain(error, "The work could not be closed."));
    }
  }

  function keepEditing(): void {
    invalidateCloseSaveIntent();
    setCloseSaveAttempted(false);
    setCloseOpen(false);
    requestAnimationFrame(() => {
      if (!view) {
        const recoveryTrigger = recoveryCloseTriggerRef.current;
        if (recoveryTrigger?.isConnected) {
          recoveryTrigger.focus();
          return;
        }
      }
      const prior = lastCellRef.current;
      if (prior?.isConnected && prior.closest('table[aria-label="Table"]')) {
        prior.focus();
        return;
      }
      const first = gridOrder[0];
      if (first) {
        const cell = cellRefs.current.get(cellKey(first.entity, first.field));
        if (cell?.isConnected) {
          cell.focus();
          return;
        }
      }
      document.getElementById(tabId(tab))?.focus();
    });
  }

  function currentEditorField(state: EditorState): FieldProjection | null {
    if (!table) return null;
    const row = table.rows.find((candidate) => rowEntity(candidate) === state.entity);
    if (!row) return null;
    return fieldForColumn(row, state.field);
  }

  useEffect(() => {
    if ((view && rowDraft && (rowDraft.occurrence !== view.occurrence || rowDraft.collection !== view.table.collection.id)) || (!view && currentness === "current")) {
      setRowDraft(null);
      setRowError(null);
    }
  }, [view?.occurrence, view?.table.collection.id, currentness, rowDraft]);

  function discardRowDraft(): void {
    if (controlsLocked || cellDraftActive || rowCommandPendingRef.current) return;
    if (editor?.entity === DRAFT_ROW) setEditor(null);
    setRowDraft(null);
    setRowError(null);
    setLocalError(null);
    if (columns[0]) focusDraftAfterRender(columns[0].id, completionIntent());
  }

  function focusDraftAfterRender(field: string, intent: ReturnType<typeof completionIntent>): void {
    requestAnimationFrame(() => {
      if (completionMayUpdateUi(intent)) withAppFocus(() => focusCell(DRAFT_ROW, field));
    });
  }

  // Tab and publication must agree about whether a request can be dispatched.
  function rowInsertBlocked(): boolean {
    return controlsLocked || rowCommandPendingRef.current || currentness !== "current" || cellDraftActive || rowDraft?.needsReview === true || props.appearancePreference.getSnapshot().composing;
  }

  async function addRow(redirectMissing = false): Promise<void> {
    if (!view || !witness || !onInsertRow || rowInsertBlocked()) return;
    const draft = rowDraft?.occurrence === view.occurrence && rowDraft.collection === table?.collection.id
      ? rowDraft : { occurrence: view.occurrence, collection: view.table.collection.id, values: {} };
    if (!hasDraftInput(draft.values)) return;
    const missing = showMissingRowHint();
    if (missing) {
      setEditor(null);
      if (redirectMissing) focusDraftAfterRender(missing.id, completionIntent());
      return;
    }
    const initializers = [];
    for (const column of columns) {
      const raw = Object.hasOwn(draft.values, column.id) ? draft.values[column.id] ?? "" : "";
      if (column.field_type === "boolean") {
        const parsed = parseBooleanDraft(raw);
        if (parsed === null) {
          setRowError({ message: "Choose Yes or No before adding this row.", fields: [column.id] });
          return;
        }
        initializers.push({ field: column.id, input: { kind: "boolean" as const, value: parsed } });
      } else if (column.field_type === "text" || column.field_type === "number" || column.field_type === "date") {
        initializers.push({ field: column.id, input: scalarEditOf(column.field_type, raw) });
      } else return;
    }
    if (editor?.entity === DRAFT_ROW || (editor && editor.value === editor.original)) setEditor(null);
    rowCommandPendingRef.current = true;
    const intent = completionIntent();
    setCommitPending(true);
    setRowError(null);
    setLocalError(null);
    try {
      const result = await onInsertRow(witness, view.table.collection.key, initializers);
      if (result.kind === "confirmed") {
        // Inputs are locked during dispatch. Clear only this submitted draft.
        setRowDraft((current) => current === rowDraft ? null : current);
        if (columns[0]) focusDraftAfterRender(columns[0].id, intent);
      } else if (result.kind === "refused") {
        const refusal = draftRefusal(columns, draft.values, result.fieldType, result.message, column => names.column(view.table.collection.id, column.id) ?? column.display_name);
        setRowError(refusal);
        if (refusal.fields?.[0]) focusDraftAfterRender(refusal.fields[0], intent);
      } else {
        setRowDraft({ ...draft, needsReview: true });
        setRowError({ message: "The row request needs review. Refresh to check its outcome; it has not been retried." });
      }
    } catch {
      setRowDraft({ ...draft, needsReview: true });
      setRowError({ message: "The row request could not be confirmed. Refresh to check its outcome before adding another row." });
    } finally {
      rowCommandPendingRef.current = false;
      setCommitPending(false);
    }
  }

  async function deleteRow(): Promise<void> {
    if (!view || !witness || !selectedEntity || selectedEntity === DRAFT_ROW || !onRemoveRows || controlsLocked || rowDraftActive || cellDraftActive || anyNotesDraft || rowCommandPendingRef.current) return;
    if (editor && editor.value === editor.original) setEditor(null);
    rowCommandPendingRef.current = true;
    const intent = completionIntent();
    setCommitPending(true);
    setRowError(null);
    try {
      const result = await onRemoveRows(witness, view.table.collection.key, [selectedEntity]);
      if (result.kind === "refused") setRowError({ message: result.message });
      if (result.kind === "confirmed" && completionMayUpdateUi(intent)) {
        requestAnimationFrame(() => {
          if (!completionMayUpdateUi(intent)) return;
          withAppFocus(() => {
            const target = gridScrollRef.current?.querySelector<HTMLElement>("td[tabindex='0']")
              ?? shellRef.current?.querySelector<HTMLElement>(".ts-entry-row [data-entry-field]");
            target?.focus();
          });
        });
      }
    } catch (error) { setRowError({ message: explain(error, "The row request could not be confirmed. Refresh before trying again.") }); }
    finally { rowCommandPendingRef.current = false; setCommitPending(false); }
  }

  function renderHome(): ReactNode {
    const recoveryLocked = currentness === "unknown";
    const startupLocked = props.startupUnavailable === true;
    const fileActionsLocked = controlsLocked || recoveryLocked || startupLocked;
    const hasSavedCopies = copiesStatus === "ready" && copies.length > 0;
    const orderedCopies = [...copies].sort((left, right) => {
      const bySavedAt = Date.parse(right.savedAt) - Date.parse(left.savedAt);
      return Number.isNaN(bySavedAt) || bySavedAt === 0
        ? left.name.localeCompare(right.name)
        : bySavedAt;
    });
    const savedCopies = (
      <section className="ts-home-panel ts-home-saved" aria-label="Saved copies">
        <div className="ts-home-panel-heading">
          <h2 className="ts-home-panel-title">Saved copies</h2>
          <p className="ts-home-panel-subtitle">{hostCopy.savedCopiesLocation}</p>
        </div>
        {copiesStatus === "checking" ? <p className="ts-home-copy-state" role="status">Checking saved copies…</p> : null}
        {copiesStatus === "unavailable" ? (
          <div className="ts-home-copy-unavailable">
            <div className="ts-home-copy-state ts-home-copy-state--unavailable" role="status">
              <span className="ts-home-copy-unavailable-icon" aria-hidden="true">!</span>
              <div>
                <strong>Saved copies couldn’t be read.</strong>
                <span>{hostCopy.savedCopiesRetry}</span>
              </div>
            </div>
            <button type="button" className="ts-button" onClick={() => void onRetryCopies()} disabled={busy || startupLocked || recoveryLocked}>Try again</button>
          </div>
        ) : null}
        {copiesStatus === "ready" && copies.length === 0 ? (
          <div className="ts-home-copy-empty">
            <strong>No saved copies yet</strong>
            <span>When you save a copy of your work, it appears here.</span>
          </div>
        ) : null}
        {savedCopiesAreVisible(copiesStatus, copies.length) ? (
          <ul className="ts-home-copy-list">
            {orderedCopies.map((copy, index) => {
              const whitespaceDescription = describeSavedCopyNameWhitespace(copy.name);
              const whitespaceDescriptionId = `${copyNameDescriptionBaseId}-${index}`;
              const describedBy = [
                ...(busy ? [lockNoteId] : []),
                ...(whitespaceDescription ? [whitespaceDescriptionId] : []),
              ].join(" ") || undefined;
              return (
                <li key={copy.name} className="ts-home-copy-row" onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                  const actions = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
                  const target = event.key === "ArrowRight" ? actions[actions.length - 1] : actions[0];
                  if (target && !target.disabled) { event.preventDefault(); target.focus(); }
                }}>
                  <button
                    type="button"
                    className="ts-home-copy-action"
                    onClick={() => void openSaved(copy.name)}
                    disabled={controlsLocked || recoveryLocked || startupLocked}
                    aria-label={`Open saved ${copy.name}`}
                    aria-describedby={describedBy}
                  >
                    <span className="ts-home-copy-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><rect x="3" y="3.5" width="14" height="13" rx="1.5" /><path d="M3.5 8h13M8 8v8" /></svg></span>
                    <span className="ts-home-copy-text">
                      <span className="ts-home-copy-name">{copy.name}</span>
                      <span className="ts-home-copy-time">Saved {formatHomeSavedAt(copy.savedAt)}</span>
                    </span>
                    <svg className="ts-home-copy-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5.5 5.5-5.5 5.5" /></svg>
                  </button>
                  {onDeleteCopy ? <button type="button" className="ts-button ts-button--ghost ts-home-copy-delete" tabIndex={-1}
                    aria-label={`Delete saved ${copy.name}`} disabled={controlsLocked || recoveryLocked || startupLocked}
                    onClick={event => { deleteTriggerRef.current = event.currentTarget; setDeleteSelection(copy); setDeleteError(null); }}>Delete</button> : null}
                  {whitespaceDescription ? <span className="ts-visually-hidden" id={whitespaceDescriptionId}>{whitespaceDescription}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    );
    const example = (
      <section className={`ts-home-panel ts-home-example${salesEntryOutcome?.kind === "refused" ? " ts-home-example--refused" : ""}`} aria-label="Sales and catalog example">
        <span className="ts-home-eyebrow">Example</span>
        <h2 className="ts-home-example-title">Sales and catalog</h2>
        <p className="ts-home-example-copy">A price list and a few orders add up to sales by product. Change a price and watch the sales chart update.</p>
        <p className="ts-home-example-flow" aria-label="Catalog prices times Sales quantities gives Sales by product">
          <svg className="ts-home-flow-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2.5 6.5h11M6.5 6.5v6"/></svg>
          <span className="ts-home-flow-table">catalog</span><span className="ts-home-flow-field">prices</span>
          <span className="ts-home-flow-times" aria-hidden="true">×</span>
          <svg className="ts-home-flow-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2.5 6.5h11M6.5 6.5v6"/></svg>
          <span className="ts-home-flow-table">sales</span><span className="ts-home-flow-field">quantities</span>
          <span className="ts-home-flow-arrow" aria-hidden="true">→</span>
          <svg className="ts-home-flow-icon ts-home-flow-icon--chart" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13.5h12M4 11V7M8 11V3M12 11V5"/></svg>
          <span className="ts-home-flow-result">Sales by product</span>
        </p>
        {salesEntryOutcome?.kind === "refused" ? (
          <div className="ts-home-example-error" role="alert">
            <strong>Couldn’t open the sales example.</strong>
            <span>Nothing was changed. You can try again.</span>
          </div>
        ) : null}
        <div className="ts-home-example-action">
          <button type="button" className="ts-button ts-button--primary" onClick={() => void openJ4Canary()} disabled={fileActionsLocked} aria-describedby={busy ? lockNoteId : undefined}>
            {busy ? "Opening…" : salesEntryOutcome?.kind === "refused" ? "Try again" : "Open sales example"}
          </button>
          {!fileActionsLocked ? <span className="ts-home-example-persistence">Opens as new work. Nothing is saved until you choose Save a copy.</span> : null}
        </div>
        {busy ? <span className="ts-visually-hidden" id={lockNoteId} role="note">An operation is in progress; controls are disabled until it finishes.</span> : null}
      </section>
    );
    const otherWays = (
      <section className="ts-home-other" aria-label="Other ways to start">
        <h2 className="ts-home-other-title">Other ways to start</h2>
        <div className="ts-home-other-list">
          {onNewTable && !recoveryLocked && !startupLocked ? <div className="ts-home-other-row">
            <span className="ts-home-other-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M3 3h14v14H3zM3 7h14M7 3v14M12 3v14" /></svg></span>
            <span className="ts-home-other-copy"><strong>New table</strong><span>Start an empty table with your own columns.</span></span>
            <button type="button" className="ts-button" disabled={fileActionsLocked} onClick={(event) => { newTableTriggerRef.current = event.currentTarget; setNewTableOpen(true); }}>New table…</button>
          </div> : null}
          <div className="ts-home-other-row">
            <span className="ts-home-other-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M5 2.5h7l3 3v12H5z" /><path d="M12 2.5v3h3M7.5 10h5M7.5 13h5" /></svg></span>
            <span className="ts-home-other-copy"><strong>Open a Tachiko work file</strong><span>Open tables, values, formulas and summaries from a .ro file. The file stays unchanged.</span></span>
            {workFileInput(fileActionsLocked)}
          </div>
          {workFileUnavailableReason ? <p className="ts-hint" id={workFileReasonId}>{workFileUnavailableReason}</p> : null}
          <div className="ts-home-other-row">
            <span className="ts-home-other-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M5 2.5h7l3 3v12H5z" /><path d="M12 2.5v3h3M7.5 10h5M7.5 13h5" /></svg></span>
            <span className="ts-home-other-copy"><strong>Import a CSV or Excel file</strong><span>You check the columns and their types before anything is added. Large imports: one headered sheet, 1–16 Text or finite Number columns, up to 8,406 rows and 25,218 cells. File-size, style and feature limits also apply.</span></span>
            <label className={`ts-button ts-home-file-action${fileActionsLocked ? " ts-home-file-action--disabled" : ""}`} aria-disabled={fileActionsLocked}>
              <span>Choose file…</span>
              <input ref={spreadsheetInputRef} id={spreadsheetInputId} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={fileActionsLocked} onChange={(event) => { const input = event.currentTarget; void inspectSpreadsheet(input.files?.[0] ?? null).finally(() => { input.value = ""; }); }} />
            </label>
          </div>
          {importError && !interop?.importInspection ? <p className="ts-dialog-error" role="alert">{importError}</p> : null}
          <div className="ts-home-other-row">
            <span className="ts-home-other-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M2.5 5.5h6l1.5 2h7.5v9h-15z" /><path d="M2.5 7.5h15" /></svg></span>
            <span className="ts-home-other-copy"><strong>Open a project folder</strong><span>Open a Tachiko project folder from this computer. Its files stay unchanged.</span></span>
            <label className={`ts-button ts-home-file-action${fileActionsLocked ? " ts-home-file-action--disabled" : ""}`} aria-disabled={fileActionsLocked}>
              <span>Choose folder…</span>
              <input id={fileInputId} data-testid="open-project" type="file" multiple disabled={fileActionsLocked} aria-describedby={busy ? lockNoteId : undefined} onChange={(event) => { const input = event.currentTarget; void openFiles(input.files).finally(() => { input.value = ""; }); }} {...directoryInputAttributes} />
            </label>
          </div>
          <div className="ts-home-other-row">
            <span className="ts-home-other-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M6.5 4.5h10M6.5 10h10M6.5 15.5h10" /><circle cx="3" cy="4.5" r=".75" /><circle cx="3" cy="10" r=".75" /><circle cx="3" cy="15.5" r=".75" /></svg></span>
            <span className="ts-home-other-copy"><strong>Release plan example</strong><span>A small team plan with a calculated priority column.</span></span>
            <button type="button" className="ts-button" onClick={() => void openExample()} disabled={fileActionsLocked} aria-label="Open release plan example">Open</button>
          </div>
        </div>
      </section>
    );
    const mobileReturning = hasSavedCopies && compactHomeLayout;
    return (
      <main className={`ts-home${hasSavedCopies ? " ts-home--has-copies" : ""}${recoveryLocked ? " ts-home--recovery" : ""}${startupLocked ? " ts-home--startup-unavailable" : ""}`}>
        <header className="ts-home-head">
          <div className="ts-home-brand"><img src="/tachiko-sheet-mark.svg" alt="" aria-hidden="true" /><h1 className="ts-brand" tabIndex={-1}>Tachiko Sheet</h1></div>
            {onNewTable && !recoveryLocked && !startupLocked ? <button type="button" className="ts-button ts-home-new-command" aria-label="New table" disabled={fileActionsLocked} onClick={(event) => { newTableTriggerRef.current = event.currentTarget; setNewTableOpen(true); }}><span className="ts-home-new-label">New table</span><span className="ts-home-new-symbol" aria-hidden="true">+</span></button> : null}
          {renderAppearanceSelector("home")}
        </header>
        <div className="ts-home-content">
          {startupLocked ? (
            <section className="ts-home-startup-alert" aria-label="Startup unavailable" role="alert">
              <span className="ts-home-alert-icon" aria-hidden="true">!</span>
              <div className="ts-home-alert-copy"><strong>{hostCopy.startupFailedTitle}</strong><span>Examples, files and saved copies can’t be opened until it starts. {hostCopy.startupFailedRetry}</span></div>
              <button type="button" className="ts-button" onClick={() => window.location.reload()}>Reload page</button>
            </section>
          ) : null}
          {currentness === "unknown" ? (
            <section className="ts-card ts-home-recovery-card" aria-label="Recovery">
              <h2 className="ts-h2">Refresh required</h2>
              <p className="ts-subtle">The open work could not be confirmed. Refresh to read it again.</p>
              <div className="ts-status-strip" aria-label="Recovery status">
                <span className="ts-chip" data-testid="currentness" data-currentness={currentness}>
                  {currentnessLabel(currentness)}
                </span>
                {dirty ? (
                  <span className="ts-chip ts-chip--edited" data-testid="persistence-status">
                    Not saved yet
                  </span>
                ) : null}
                {outcome !== "idle" ? (
                  <span className={`ts-chip ts-chip--${outcome}`} data-testid="operation-outcome">
                    {outcomeLabel(outcome)}
                  </span>
                ) : null}
              </div>
              <div className="ts-home-recovery-actions">
                <button type="button" className="ts-button" ref={recoveryRefreshRef} onClick={() => void refresh()} disabled={busy || commitPending}>
                  Refresh
                </button>
                <button type="button" className="ts-button ts-button--ghost" ref={recoveryCloseTriggerRef} onClick={() => void requestClose()} disabled={busy || commitPending}>
                  Close and abandon recovery
                </button>
              </div>
              <p className="ts-home-recovery-note">Other ways to start are paused until the work is refreshed or closed.</p>
            </section>
          ) : null}
          <section className="ts-home-intro" aria-labelledby="home-purpose-title">
            <h2 className="ts-home-purpose" id="home-purpose-title">Change a value, and the summaries and charts that use it update.</h2>
            <p>Tachiko Sheet connects your tables to the summaries and charts built on them. Start with the sales example, bring in a CSV or Excel file, or open a copy you saved.</p>
          </section>
          <div className="ts-home-grid">
            {mobileReturning ? savedCopies : example}
            {mobileReturning ? example : null}
            {mobileReturning ? null : savedCopies}
            {otherWays}
          </div>
        </div>
      </main>
    );
  }

  function renderToolbar(): ReactNode {
    return (
      <header className="ts-workbook-head">
        <div className="ts-document-identity">
          <img className="ts-document-mark" src="/tachiko-sheet-mark.svg" alt="" aria-hidden="true" />
          <div className="ts-title-block">
            <span className="ts-wordmark">Tachiko Sheet</span>
            <h1 className="ts-title">{view ? names.title ?? view.title : ""}</h1>
          </div>
        </div>
        {renderAppearanceSelector("workbook")}
        <div className="ts-header-commands">
          {renderWorkbookActions()}
        </div>
      </header>
    );
  }

  function renderWorkbookActions(): ReactNode {
    const closeButton = (className = "ts-button") => (
      <button
        type="button"
        className={className}
        onClick={() => void requestClose()}
        disabled={busy}
        aria-describedby={busy ? lockNoteId : undefined}
      >
        Close project
      </button>
    );
    return (
      <div className="ts-actions ts-header-actions" role="group" aria-label="Document commands">
        <button
          type="button"
          className="ts-button ts-history-command"
          onClick={(event) => void requestHistory("undo", event.currentTarget)}
          title={rowDraftActive ? "Add or discard the new row first." : undefined} disabled={controlsLocked || historyInteractionLocked || localHistory.undoCount < 1 || localHistory.occurrence !== view?.occurrence || localHistory.revision !== view?.revision}
          aria-describedby={controlsLocked ? lockNoteId : undefined}
        >
          Undo
        </button>
        <button
          type="button"
          className="ts-button ts-history-command"
          onClick={(event) => void requestHistory("redo", event.currentTarget)}
          title={rowDraftActive ? "Add or discard the new row first." : undefined} disabled={controlsLocked || historyInteractionLocked || localHistory.redoCount < 1 || localHistory.occurrence !== view?.occurrence || localHistory.revision !== view?.revision}
          aria-describedby={controlsLocked ? lockNoteId : undefined}
        >
          Redo
        </button>
        <button
          type="button"
          className="ts-button ts-refresh-command"
          ref={desktopRefreshRef}
          onClick={() => void refresh()}
          disabled={busy || commitPending}
          aria-describedby={controlsLocked ? lockNoteId : undefined}
        >
          Refresh
        </button>
        <div className={`ts-save-status ts-save-status--${saveStatus}`} role="status">
          <span className={`ts-save-indicator ts-chip--${saveStatus}`} data-testid="save-status">
            {saveLabel(saveStatus)}
          </span>
          <span className="ts-save-scope">{hostCopy.copiesScope}</span>
        </div>
        <button
          type="button"
          className="ts-button ts-button--primary"
          onClick={() => void saveWork()}
          disabled={controlsLocked || saveStatus === "saving" || Boolean(view?.openedFromWorkFile && workFileSaveUnavailableReason)}
          aria-describedby={view?.openedFromWorkFile && workFileSaveUnavailableReason ? saveUnavailableId : controlsLocked ? lockNoteId : undefined}
        >
          Save
        </button>
        <button type="button" ref={saveCopyButtonRef} className="ts-button ts-save-copy-secondary" onClick={() => openCopyDialog()}
          aria-describedby={view?.openedFromWorkFile && workFileSaveUnavailableReason ? saveUnavailableId : controlsLocked ? lockNoteId : undefined}
          disabled={controlsLocked || saveStatus === "saving" || Boolean(view?.openedFromWorkFile && workFileSaveUnavailableReason)}>
          Save a copy
        </button>
        {view?.openedFromWorkFile && workFileSaveUnavailableReason ? <span className="ts-hint" id={saveUnavailableId}>{saveUnavailableReason}</span> : null}
        {closeButton("ts-button ts-close-project-desktop")}
        <details className="ts-command-overflow">
          <summary ref={commandOverflowSummaryRef} aria-label="More document commands">…</summary>
          <div className="ts-command-menu">
            <button type="button" className="ts-button ts-button--ghost" onClick={(event) => void requestHistory("undo", event.currentTarget)} title={rowDraftActive ? "Add or discard the new row first." : undefined} disabled={controlsLocked || historyInteractionLocked || localHistory.undoCount < 1}>Undo</button>
            <button type="button" className="ts-button ts-button--ghost" onClick={(event) => void requestHistory("redo", event.currentTarget)} title={rowDraftActive ? "Add or discard the new row first." : undefined} disabled={controlsLocked || historyInteractionLocked || localHistory.redoCount < 1}>Redo</button>
            {closeButton("ts-button ts-button--ghost")}
          </div>
        </details>
      </div>
    );
  }

  function renderStatusStrip(): ReactNode {
    return (
        <div className="ts-status-strip">
          <span className="ts-status-pair">
            <span className="ts-status-label">Work:</span>
            <span
              className={`ts-chip ${salesInitialNotSaved ? "ts-chip--unchanged" : dirty ? "ts-chip--edited" : "ts-chip--unchanged"}`}
              data-testid="work-state"
              data-work-state={dirty ? "edited" : "unchanged"}
            >
              {salesInitialNotSaved ? "Not saved yet" : workStateLabel(dirty)}
            </span>
          </span>
          <span className="ts-status-pair">
            <span className="ts-status-label">Values:</span>
            <span className={`ts-chip ts-chip--${currentness}`} data-testid="currentness" data-currentness={currentness}>
            {currentnessLabel(currentness, resultsNeedAttention)}
            </span>
          </span>
          {currentness === "pending" && j4Results.length > 0 && !salesTipVisibleForCurrentOccurrence() ? <span className="ts-notice" role="status">Updating… — showing previous results.</span> : null}
          {outcome !== "idle" ? (
            <span className={`ts-chip ts-chip--${outcome}`} data-testid="operation-outcome">
              {outcomeLabel(outcome)}
            </span>
          ) : null}
          <span className="ts-workbook-row-count">
            {table ? `${table.rows.length} rows · ${columns.length} columns` : ""}
          </span>
        </div>
    );
  }

  function renderTablePanel(): ReactNode {
    if (!table) return null;
    const hasResults = j4DefinitionIds.length > 0;
    const visibleSalesTip = hasResults && !resultsHidden && salesEntryTip?.occurrence === view?.occurrence
      ? salesEntryTip
      : null;
    const resultsNeedAttention = j4DefinitionIds.some((id) => {
      const result = j4Results.find((candidate) => candidate.definitionId === id);
      return !result || result.diagnostics.length > 0;
    });
    const gridTable = (
      <table className={`ts-grid${salesCatalogLayoutEligible(view!, salesCatalogLayout) ? " ts-grid--sales-catalog" : ""}`} role="grid" aria-label="Table" onCopy={copyGrid} onPaste={pasteGrid} aria-busy={busy} aria-rowcount={gridWindowed ? table.rows.length + 1 + Number(hasDraftRow) : undefined}>
        <thead>
          <tr aria-rowindex={gridWindowed ? 1 : undefined}>
            <th scope="col" className="ts-gutter-head">Row</th>
            {columns.map((column) => <th key={column.id} scope="col" className="ts-col-head">{names.column(table.collection.id, column.id) ?? column.display_name}</th>)}
          </tr>
        </thead>
        <tbody>
          {gridWindowed ? gridWindowSegments(gridRange, pinnedGridRows(), table.rows.length).map((segment) => segment.kind === "spacer"
            ? <tr key={segment.key} className="ts-grid-spacer" aria-hidden="true"><td colSpan={columns.length + 1} style={{ height: segment.rows * gridRowHeight, padding: 0, border: 0 }} /></tr>
            : table.rows[segment.index] ? renderRow(table.rows[segment.index]!, segment.index) : null)
            : table.rows.map((row, index) => renderRow(row, index))}
        </tbody>
        {hasDraftRow ? <tfoot role="rowgroup" className="ts-entry-footer">
          <tr className="ts-entry-row" aria-label="New row" aria-rowindex={gridWindowed ? table.rows.length + 2 : undefined}>
            <th scope="row" className="ts-row-head" aria-label="New row">+</th>
            {columns.map(column => renderCell(null, DRAFT_ROW, column))}
          </tr>
          <tr role="presentation" className="ts-entry-feedback"><td role="presentation" colSpan={columns.length + 1}>
            <div className="ts-entry-actions">
              <button type="button" className="ts-button" disabled={controlsLocked || cellDraftActive || currentness !== "current" || rowDraft?.needsReview === true} onClick={() => void addRow()}>Add row</button>
              <button type="button" className="ts-button ts-button--ghost" disabled={controlsLocked || cellDraftActive} onClick={discardRowDraft}>Discard</button>
              {rowDraftActive ? <span className="ts-hint">{rowDraft?.needsReview ? "Review the row, then discard this draft before adding another." : "Press Enter to add this row."}</span> : null}
              {rowError ? <span className="ts-row-error" id="ts-row-error" role="alert">{rowError.message}</span> : null}
            </div>
          </td></tr>
        </tfoot> : null}
      </table>
    );
    return (
      <div role="tabpanel" id={panelId("table")} aria-labelledby={tabId("table")} className={`ts-panel ts-table-panel${hasResults ? " ts-table-panel--results" : ""}`}>
        {currentness === "current" || visibleSalesTip ? null : <p className="ts-notice">{freshnessNotice(currentness)}</p>}
        <div className={`ts-table-composition${hasResults && !resultsHidden ? " ts-table-composition--results" : ""}${salesCatalogLayoutEligible(view!, salesCatalogLayout) ? " ts-table-composition--sales-catalog" : ""}`} data-focus-reveal-view-key={`${view!.occurrence}\u0000${view!.revision}`}>
          <div className="ts-work-region">
            {visibleSalesTip ? <SalesTip
              marker={visibleSalesTip}
              reportTitle={report?.title ?? "Results"}
              changed={salesExampleChanged}
              currentness={currentness}
              hasAttention={resultsNeedAttention}
              dismiss={dismissSalesTip}
            /> : null}
            <div className="ts-grid-scroll" ref={gridScrollRef} onScroll={gridWindowed ? onGridScroll : undefined}>
              {/* React removes old keyed rows/spacers before adding their replacements.
                  Reserve the full extent outside the table so WebKit cannot clamp
                  scrollTop against a temporarily shorter table during that commit.
                  A table min-height would instead stretch the rendered row heights. */}
              {gridWindowed
                ? <div className="ts-grid-extent" style={{ minHeight: gridWindowScrollHeight(table.rows.length, gridRowHeight, gridHeaderHeight) }}>{gridTable}</div>
                : gridTable}
            </div>
        <p className="ts-hint ts-clipboard-status" role="status" aria-live="polite" aria-atomic="true">{clipboardMessage}</p>
        {table.native_table_profile ? <p className="ts-hint ts-table-row-note">{saveStatus === "saved" ? "A copy of this work is saved on this device." : "Nothing is saved until you choose Save a copy."}</p> : null}
        {onInsertRow && onRemoveRows ? table.native_table_profile ? <div className="ts-actions ts-row-actions ts-table-row-actions">
          <button type="button" className="ts-button" disabled={controlsLocked || currentness !== "current" || !selectedEntity || !rowIndexByEntity.has(selectedEntity) || cellDraftActive || rowDraftActive || anyNotesDraft} title={rowDraftActive ? "Add or discard the new row first." : undefined} onClick={() => void deleteRow()}>Delete row</button>
          <span className="ts-hint ts-table-row-note">Focus a row to delete it. Undo restores a deleted row.</span>
        </div> : <p className="ts-hint ts-table-row-note">Adding and deleting rows is available only in native tables. This table does not support it.</p> : null}
        {!hasDraftRow && rowError ? <p className="ts-dialog-error ts-row-error" id="ts-row-error" role="alert">{rowError.message}</p> : null}
          </div>
          {hasResults ? resultsHidden ? <button ref={resultsShowButtonRef} type="button" className="ts-button ts-results-show" onClick={() => setResultsHidden(false)}>Show results</button> : <>
            <ResultsPane
              view={view!}
              currentness={currentness}
              results={j4Results}
              definitionIds={j4DefinitionIds}
              report={report}
              busy={controlsLocked}
              priorChartModes={priorChartModesRef.current}
              onChartMode={(occurrence, definitionId, mode) => {
                const key = `${occurrence}\u0000${definitionId}`;
                if (priorChartModesRef.current.get(key) !== mode) priorChartModesRef.current.set(key, mode);
              }}
              onRefresh={onRefreshJ4}
              onOpenSummary={() => selectTab("summary")}
              onOpenReport={() => selectTab("report")}
              onHide={() => { setResultsHidden(true); window.requestAnimationFrame(() => resultsShowButtonRef.current?.focus()); }}
              hideButtonRef={resultsHideButtonRef}
              chartFontKey={appearanceSnapshot.selection.kind === "built-in"
                ? `${appearanceSnapshot.selection.profileId}:${appearanceSnapshot.selection.density}`
                : `${appearanceSnapshot.selection.profile.name}:${appearanceSnapshot.selection.profile.density}:${JSON.stringify(appearanceSnapshot.selection.profile.typography)}`}
            />
          </> : null}
        </div>
      </div>
    );
  }

  function salesTipVisibleForCurrentOccurrence(): boolean {
    return Boolean(view && j4DefinitionIds.length > 0 && !resultsHidden && salesEntryTip?.occurrence === view.occurrence);
  }

  function renderRow(row: TableRow, index: number): ReactNode {
    const entity = rowEntity(row);
    const isSelectedRow = entity === selectedEntity;
    return <tr key={row.id || entity} className={isSelectedRow ? "ts-row ts-row--selected" : "ts-row"} aria-rowindex={gridWindowed ? index + 2 : undefined}>
      <th scope="row" className="ts-row-head">{index + 1}</th>
      {columns.map((column) => renderCell(row, entity, column))}
    </tr>;
  }

  /** Rows kept mounted outside the window: editor, selection/focus and the default tab stop. */
  function pinnedGridRows(): number[] {
    const pinned: number[] = [];
    for (const entity of [editor?.entity, selectedEntity, focusedKey?.split("\u0000")[0], pendingCellFocusRef.current?.entity]) {
      const index = entity ? rowIndexByEntity.get(entity) : undefined;
      if (index !== undefined) pinned.push(index);
    }
    if (!focusedKey) pinned.push(0);
    return pinned;
  }

  function renderCell(row: TableRow | null, entity: string, column: TableColumn): ReactNode {
    if (!view) return null;
    const draft = entity === DRAFT_ROW;
    const field = row ? fieldForColumn(row, column.id) : null;
    const raw = boundRowDraft?.values[column.id] ?? "";
    const draftBoolean = column.field_type === "boolean" ? parseBooleanDraft(raw) : null;
    const display = draft ? { text: draftBoolean !== null ? booleanText(draftBoolean) : raw, tone: "plain", title: null } : fieldDisplay(field);
    const key = cellKey(entity, column.id);
    const editing = editor !== null && editor.entity === entity && editor.field === column.id;
    const editable = (draft ? !cellDraftActive && currentness === "current" : Boolean(field?.editable_scalar)) && !controlsLocked;
    const classes = ["ts-cell", `ts-cell--${display.tone}`];
    const coordinate = address({ entity, field: column.id });
    const rangeSelected = !draft && selectionRectangle && coordinate.row >= selectionRectangle.top && coordinate.row <= selectionRectangle.bottom && coordinate.column >= selectionRectangle.left && coordinate.column <= selectionRectangle.right;
    if (rangeSelected) classes.push("ts-cell--range-selected");
    if (editing) classes.push("ts-cell--editing");
    if (focusedKey === key) classes.push("ts-cell--focused");
    return (
      <td
        key={column.id}
        ref={(node) => {
          if (node) cellRefs.current.set(key, node);
          else cellRefs.current.delete(key);
        }}
        className={classes.join(" ")}
        data-testid={`cell:${entity}:${column.id}`}
        data-entry-field={draft ? column.id : undefined}
        aria-label={draft ? `New row ${names.column(table!.collection.id, column.id) ?? column.display_name} (${column.field_type === "boolean" ? "Yes/No" : column.field_type === "number" ? "Number" : column.field_type === "date" ? "Date" : "Text"})` : undefined}
        aria-invalid={draft && !rowError?.missing && rowError?.fields?.includes(column.id) ? true : undefined}
        aria-describedby={draft && rowError?.fields?.includes(column.id) ? editing ? "ts-row-error" : `ts-draft-message-${column.id}` : undefined}
        data-work-occurrence={view.occurrence}
        data-work-revision={view.revision}
        data-work-entity={entity}
        data-work-field={column.id}
        data-work-currentness={currentness}
        tabIndex={focusedKey === key || (!focusedKey && isFirstCell(entity, column)) ? 0 : -1}
        aria-selected={Boolean(rangeSelected) || (!selectionRectangle && focusedKey === key)}
        aria-readonly={!editable}
        title={display.title ?? undefined}
        onMouseDown={(event) => { if (event.shiftKey && !draft && !editor) event.preventDefault(); }}
        onClick={(event) => {
          if ((event.target as Element).closest("input")) return;
          setSelectedEntity(entity);
          if (event.shiftKey && !draft && focusedKey) {
            const [priorEntity, priorField] = focusedKey.split("\u0000");
            if (priorEntity && priorField && priorEntity !== DRAFT_ROW) extendSelection(boundSelection?.anchor ?? { entity: priorEntity, field: priorField }, { entity, field: column.id });
          } else { setCellSelection(null); focusCell(entity, column.id); }
        }}
        onDoubleClick={() => draft ? beginDraftEdit(column) : beginEdit(entity, field)}
        onFocus={() => {
          setSelectedEntity(entity);
          setFocusedKey(key);
          lastCellRef.current = cellRefs.current.get(key) ?? null;
        }}
        onKeyDown={(event) => onCellKeyDown(event, entity, field, { entity, field: column.id })}
      >
        {editing && editor ? (
          <input
            className="ts-cell-input"
            aria-label="Edit cell"
            aria-describedby={draft && rowError?.fields?.includes(column.id) ? "ts-row-error" : undefined}
            placeholder={draft ? column.field_type === "boolean" ? "true / false" : column.field_type === "date" ? "YYYY-MM-DD" : undefined : undefined}
            aria-busy={commitPending}
            data-testid="cell-editor"
            disabled={controlsLocked}
            value={editor.value}
            ref={focusEditorInput}
            onDoubleClick={(event) => event.stopPropagation()}
            onBlur={() => { if (draft && !rowCommandPendingRef.current) setEditor(current => current?.entity === DRAFT_ROW && current.field === column.id ? null : current); }}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (draft) changeRowDraft(column.id, value);
              setLocalError(null);
              setEditor((previous) => (previous ? { ...previous, value } : previous));
            }}
            onKeyDown={onEditorKeyDown}
          />
        ) : (
          <span className="ts-cell-value">{display.text}</span>
        )}
        {draft && !editing && rowError?.fields?.includes(column.id) ? <span id={`ts-draft-message-${column.id}`} className={`ts-draft-cell-message ${rowError.missing ? "ts-hint" : "ts-row-error"}`}>{rowError.message}</span> : null}
      </td>
    );
  }

  function isFirstCell(entity: string, column: TableColumn): boolean {
    if (!table) return false;
    const firstRow = table.rows[0];
    if (!firstRow) return entity === DRAFT_ROW && columns[0]?.id === column.id;
    return rowEntity(firstRow) === entity && columns[0]?.id === column.id;
  }

  function renderBriefPanel(): ReactNode {
    if (!view || !selectedRow) return null;
    const entity = rowEntity(selectedRow);
    const tableCols = tableColumns(view.table);
    const rowNumber = table ? table.rows.indexOf(selectedRow) + 1 : null;
    return (
      <div role="tabpanel" id={panelId("brief")} aria-labelledby={tabId("brief")} className="ts-panel ts-brief-panel">
        {currentness === "current" ? null : <p className="ts-notice">{freshnessNotice(currentness)}</p>}
        <h1 className="ts-content-heading">Brief</h1>
        <p className="ts-content-meta">Row {rowNumber} · same record as Table</p>
        <div className="ts-brief-layout">
          <section className="ts-brief-facts" aria-labelledby="brief-facts-heading">
            <h2 className="ts-content-heading" id="brief-facts-heading">Linked facts</h2>
            <BriefFacts
              entity={entity}
              occurrence={view.occurrence}
              revision={view.revision}
              currentness={currentness}
              row={selectedRow}
              columns={tableCols}
            />
          </section>
          <section className="ts-brief-notes" aria-label="Decision notes">
            <h2 className="ts-content-heading">Decision notes</h2>
            <p className="ts-subtle">
              Apply notes to the open work. Saving a copy is a separate action.
            </p>
            <label className="ts-field-label" htmlFor={notesId}>
              Decision notes
            </label>
            <textarea
              id={notesId}
              className="ts-notes"
              data-testid="notes-input"
              rows={5}
              value={notesValue}
              disabled={!notesEditable}
              // Read-only while a commit is pending, so an Apply's outcome
              // never races newer typing.
              readOnly={commitPending}
              aria-describedby={notesEditable ? undefined : `${notesId}-hint`}
              onChange={(event) => {
                setLocalError(null);
                if (view && selectedRow) {
                  const target = { occurrence: view.occurrence, entity: rowEntity(selectedRow) };
                  const value = event.currentTarget.value;
                  setNotesDrafts((drafts) => upsertNotesDraft(drafts, target, value, notesCommitted));
                }
              }}
              onKeyDown={onNotesKeyDown}
            />
            {notesEditable ? null : (
              <p className="ts-hint" id={`${notesId}-hint`}>
                {notesField
                  ? "This notes field is not editable in the current work."
                  : "This work has no notes column to write to."}
              </p>
            )}
            <div className="ts-row-actions">
              <button
                type="button"
                className="ts-button ts-button--primary"
                onClick={() => void applyNotes()}
                disabled={!notesEditable || controlsLocked || !notesDirty || !notesDraftBound}
                title={notesDirty ? undefined : "Change the notes before applying."}
              >
                Apply notes
              </button>
              {notesStale ? (
                <>
                  <span className="ts-hint" role="status">These notes were changed after you started editing. Check them, then keep your draft to apply it.</span>
                  <button type="button" className="ts-button" onClick={keepNotesDraft} disabled={controlsLocked}>Keep my draft</button>
                </>
              ) : <span className="ts-hint">{notesDirty ? "Unapplied notes draft" : "No unapplied notes"}</span>}
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderInteropPanel(): ReactNode {
    if (!view || !table) return null;
    const allFields = table.rows.flatMap((row) => row.fields.filter((field) => field.editable_scalar === "text").map((field) => field.target));
    const entities = table.rows.map(rowEntity);
    const keyFields = columns.map((column) => column.id);
    const preview = interop?.cleanupPreview ?? null;
    return <div role="tabpanel" id={panelId("interop")} aria-labelledby={tabId("interop")} className="ts-panel ts-interop">
      <h2 className="ts-content-heading">Import &amp; export</h2>
      <section className="ts-interop-section" aria-label="Import & export changes and warnings">
        <h3 className="ts-content-heading">Changes and warnings</h3>
        {interop?.ledger.length ? <ul className="ts-ledger">{interop.ledger.map((finding, index) => <li key={`${finding.code}-${index}`}><strong>{findingCategoryLabel(finding.category)}</strong>: {findingMessage(finding.message)}</li>)}</ul> : <p className="ts-empty">No import or export details are available for this work.</p>}
      </section>
      <section className="ts-interop-section" aria-label="Cleanup preview">
        <h3 className="ts-content-heading">Cleanup</h3>
        <p className="ts-subtle">Review the proposed cleanup. Nothing changes until you apply this preview.</p>
        <div className="ts-row-actions">
          <button type="button" className="ts-button" disabled={controlsLocked || allFields.length === 0} onClick={() => witness && void onPreviewTrim(witness, allFields)}>Preview trimming spaces</button>
          <button type="button" className="ts-button" disabled={controlsLocked || entities.length < 2 || keyFields.length === 0} onClick={() => witness && void onPreviewDeduplicate(witness, entities, keyFields)}>Preview removing duplicate rows</button>
        </div>
        {preview ? (
          <div className="ts-preview" data-testid="cleanup-preview">
            <p>{preview.changes.length} cell changes and {preview.removed_entities.length} rows would change.</p>
            {preview.changes.length ? (
              <table className="ts-interop-targets" aria-label="Cleanup targets">
                <thead><tr><th scope="col">Target</th></tr></thead>
                <tbody>{preview.changes.map((change, index) => {
                  const row = table.rows.findIndex((candidate) => rowEntity(candidate) === change.target.entity);
                  const column = columns.find((candidate) => candidate.id === change.target.field);
                  return <tr key={`${change.target.entity}-${change.target.field}-${index}`}>
                    <td>{`Row ${row + 1}, ${column?.display_name ?? change.target.field}`}</td>
                  </tr>;
                })}</tbody>
              </table>
            ) : null}
            <div className="ts-row-actions">
              <button type="button" className="ts-button" onClick={onCancelCleanup}>Cancel preview</button>
              <button type="button" className="ts-button ts-button--primary" disabled={controlsLocked || !witness} onClick={() => witness && !refuseWhileCellDraft("applying a cleanup preview") && void onCommitCleanup(witness, preview.preview_id)}>Apply preview</button>
            </div>
          </div>
        ) : null}
      </section>
      <section className="ts-interop-section" aria-label="Download spreadsheet">
        <h3 className="ts-content-heading">Download</h3>
        <p className="ts-subtle">Prepare a file from your current work. Review what it includes and any changes or warnings before downloading.</p>
        <div className="ts-row-actions">
          <button type="button" className="ts-button" disabled={workFileDownloadLocked} aria-describedby={workFileUnavailableReason ? workFileReasonId : undefined} onClick={(event) => void prepareDownload("ro", event.currentTarget)}>Download work file (.ro)</button>
          <button type="button" className="ts-button" disabled={controlsLocked || !interop?.metadata} aria-describedby={!interop?.metadata ? exportUnavailableId : undefined} onClick={(event) => void prepareDownload("csv", event.currentTarget)}>Prepare CSV</button>
          <button type="button" className="ts-button" disabled={controlsLocked || !interop?.metadata} aria-describedby={!interop?.metadata ? exportUnavailableId : undefined} onClick={(event) => void prepareDownload("xlsx", event.currentTarget)}>Prepare XLSX</button>
        </div>
        {workFileUnavailableReason ? <p className="ts-hint" id={workFileReasonId}>{workFileUnavailableReason}</p> : null}
        {!interop?.metadata ? <p className="ts-hint" id={exportUnavailableId}>CSV and XLSX downloads are available only for work opened from an imported spreadsheet. Examples cannot be downloaded in these formats yet. {view.openedFromWorkFile && !workFileUnavailableReason ? "Download the work file to keep these changes." : "Save a copy to keep your work on this device."}</p> : null}
        {interop?.downloadStatus === "failed" ? <p className="ts-dialog-error" role="alert">{interop.downloadError ?? "The download failed; the current work is still open and unsaved changes were preserved."}</p> : null}
      </section>
    </div>;
  }

  function renderSummaryPanel(): ReactNode {
    if (!view) return null;
    const liveWitness: ViewWitness = { occurrence: view.occurrence, revision: view.revision };
    const collection = (key: string) => j4Catalog?.collections.find((candidate) => candidate.key === key) ?? null;
    const fields = (key: string) => collection(key)?.fields ?? [];
    const choose = (key: keyof KeyedGroupedSumBindingChoice, value: string) => {
      setJ4Binding((current) => {
        if (!current) return current;
        if (key === "ordersCollection") return { ...current, ordersCollection: value, orderLookupKeyField: "", orderQuantityField: "" };
        if (key === "productsCollection") return { ...current, productsCollection: value, productKeyField: "", productCategoryField: "", productPriceField: "" };
        return { ...current, [key]: value };
      });
    };
    const prepare = async () => {
      if (controlsLocked || j4Pending) return;
      setJ4Pending(true);
      setLocalError(null);
      try {
        const catalog = await onPrepareJ4Bindings(liveWitness);
        const first = catalog.collections[0];
        setJ4Catalog(catalog);
        setJ4Binding(first ? {
          ordersCollection: first.key,
          orderLookupKeyField: first.fields[0]?.key ?? "",
          orderQuantityField: first.fields[0]?.key ?? "",
          productsCollection: first.key,
          productKeyField: first.fields[0]?.key ?? "",
          productCategoryField: first.fields[0]?.key ?? "",
          productPriceField: first.fields[0]?.key ?? "",
        } : null);
      } catch (error) {
        setLocalError(explain(error, "Could not read the current table and field names."));
      } finally {
        setJ4Pending(false);
      }
    };
    const create = async () => {
      if (!j4Binding || controlsLocked || j4Pending) return;
      if (cellDraftActive) {
        setLocalError("Apply or cancel the value you are editing before creating a cross-table summary.");
        // The editor is only mounted in the Table panel. Returning there lets
        // its existing autofocus callback retain the draft for correction.
        setTab("table");
        return;
      }
      setJ4Pending(true);
      setLocalError(null);
      try {
        await onCreateJ4(liveWitness, j4Binding);
      } finally {
        setJ4Pending(false);
      }
    };
    const selector = (label: string, key: keyof KeyedGroupedSumBindingChoice, values: Array<{ key: string; displayName?: string }>) => (
      <div className="ts-summary-field"><label className="ts-field-label" htmlFor={`j4-${key}`}>{label}</label>
      <select id={`j4-${key}`} value={j4Binding?.[key] ?? ""} onChange={(event) => choose(key, event.currentTarget.value)} disabled={controlsLocked || j4Pending}>
        <option value="">Choose a field</option>
        {values.map((value) => <option key={value.key} value={value.key}>{value.displayName ?? value.key}</option>)}
      </select></div>
    );
    const hasField = (collectionKey: string, fieldKey: string) => fields(collectionKey).some((field) => field.key === fieldKey);
    const bindingReady = Boolean(j4Binding && j4Catalog &&
      [j4Binding.ordersCollection, j4Binding.productsCollection].every(Boolean) &&
      hasField(j4Binding.ordersCollection, j4Binding.orderLookupKeyField) &&
      hasField(j4Binding.ordersCollection, j4Binding.orderQuantityField) &&
      hasField(j4Binding.productsCollection, j4Binding.productKeyField) &&
      hasField(j4Binding.productsCollection, j4Binding.productCategoryField) &&
      hasField(j4Binding.productsCollection, j4Binding.productPriceField));
    const missingDefinitionIds = missingJ4DefinitionIds;
    const hasConfiguredSummary = Boolean(j4Catalog || j4Results.length > 0 || j4DefinitionIds.length > 0);
    return <div role="tabpanel" id={panelId("summary")} aria-labelledby={tabId("summary")} className={`ts-panel ${hasConfiguredSummary ? "ts-summary-panel" : "ts-brief"}`}>
      <section className={hasConfiguredSummary ? "ts-summary-binding" : "ts-card"} aria-label="Cross-table summary setup">
        <h2 className={hasConfiguredSummary ? "ts-content-heading" : "ts-h2"}>Cross-table summary</h2>
        <p className="ts-subtle">Choose the tables and columns to calculate your summary.</p>
        {!j4Catalog ? <button type="button" className="ts-button" onClick={() => void prepare()} disabled={controlsLocked || j4Pending}>{j4Pending ? "Loading names…" : "Choose tables and fields"}</button> : <>
          <div className="ts-summary-fields">
            {selector("Orders table", "ordersCollection", j4Catalog.collections)}
            {selector("Order lookup key", "orderLookupKeyField", fields(j4Binding?.ordersCollection ?? ""))}
            {selector("Order quantity", "orderQuantityField", fields(j4Binding?.ordersCollection ?? ""))}
            {selector("Products table", "productsCollection", j4Catalog.collections)}
            {selector("Product key", "productKeyField", fields(j4Binding?.productsCollection ?? ""))}
            {selector("Product category", "productCategoryField", fields(j4Binding?.productsCollection ?? ""))}
            {selector("Product price", "productPriceField", fields(j4Binding?.productsCollection ?? ""))}
          </div>
          <p className="ts-hint">{workFileUnavailableReason ?? "Download a work file from Import & export to keep your tables and summaries."}</p>
          <button type="button" className="ts-button ts-button--primary" onClick={() => void create()} disabled={controlsLocked || j4Pending || !bindingReady}>{j4Pending ? "Creating…" : "Create cross-table summary"}</button>
        </>}
      </section>
      <section className={hasConfiguredSummary ? "ts-summary-result" : "ts-card"} aria-label="Cross-table summary result">
        <h2 className={hasConfiguredSummary ? "ts-content-heading" : "ts-h2"}>{hasConfiguredSummary
          ? currentness === "pending" ? "Previous grouped result" : resultsNeedAttention ? "Grouped results need attention" : "Current grouped result"
          : "Calculated result"}</h2>
        {resultsNeedAttention && currentness === "current" ? <p className="ts-notice" role="status">Some results need attention. Check the affected summaries.</p> : null}
        {j4Results.length === 0 && j4DefinitionIds.length === 0 ? <p className="ts-empty">No current cross-table result is available. Create a summary after choosing its fields.</p> : null}
        {j4Results.map((result, index) => <div key={result.definitionId} className="ts-preview" data-testid={`j4-result-${index}`}>
          {result.diagnostics.length > 0 ? <><p role="status">{currentness === "pending" ? "This previous result has source issues. Its values are hidden while results update." : "The source data has problems. Group values are hidden until those problems are corrected."}</p><ul className="ts-ledger" aria-label="Summary problems">{result.diagnostics.map((diagnostic, diagnosticIndex) => <li key={`${diagnostic.code}-${diagnosticIndex}`}>{diagnostic.code}: {diagnostic.lookup_key ?? "(no lookup key)"}</li>)}</ul></> : <>
            <p className="ts-content-meta">{currentness === "pending" ? "Previous result" : resultsNeedAttention ? "Current result" : "Complete result"} · {result.groups.length} groups{resultsNeedAttention || currentness === "pending" ? "" : ` · ${currentness === "current" && result.revision === view.revision ? "up to date" : freshnessNotice(currentness)}`}</p>
            <table className="ts-summary-groups" aria-label="Cross-table groups">
              <thead><tr><th scope="col">Product</th><th scope="col">Value</th></tr></thead>
              <tbody>{result.groups.map((group) => <tr key={group.category}><td>{group.category}</td><td>{group.value}</td></tr>)}</tbody>
            </table>
            <div className="ts-row-actions ts-summary-actions"><button type="button" className="ts-button ts-button--primary" onClick={() => createReportFromSummary(result.definitionId, "bar")} disabled={controlsLocked}>Create bar report</button><button type="button" className="ts-button" onClick={() => createReportFromSummary(result.definitionId, "line")} disabled={controlsLocked}>Create line report</button><button type="button" className="ts-button" onClick={() => void onRefreshJ4(liveWitness, result.definitionId)} disabled={controlsLocked || j4Pending}>Refresh summary</button></div>
          </>}
          {result.diagnostics.length > 0 ? <button type="button" className="ts-button" onClick={() => void onRefreshJ4(liveWitness, result.definitionId)} disabled={controlsLocked || j4Pending}>Refresh summary</button> : null}
        </div>)}
        {missingDefinitionIds.length > 0 ? <div className="ts-preview">
          <p className="ts-empty">This summary has no confirmed current result. Refresh it to try again.</p>
          {missingDefinitionIds.map((definitionId) => {
            const index = j4DefinitionIds.indexOf(definitionId);
            return <button key={definitionId} type="button" className="ts-button" onClick={() => void onRefreshJ4(liveWitness, definitionId)} disabled={controlsLocked || j4Pending}>Refresh cross-table summary {index + 1}</button>;
          })}
        </div> : null}
      </section>
    </div>;
  }

  function createReportFromSummary(definitionId: string, type: ReportConfiguration["type"]): void {
    if (hasInvalidReportDraft) {
      setLocalError("Correct the invalid report presentation text before replacing this report.");
      selectTab("report");
      return;
    }
    onCreateReport(definitionId, type);
    selectTab("report");
  }

  function renderReportPanel(): ReactNode {
    if (!view) return null;
    const reportSourceHasDiagnostics = Boolean(report && j4Results.some((candidate) =>
      candidate.definitionId === report.definitionId && candidate.revision === view.revision && candidate.diagnostics.length > 0,
    ));
    const result = report && j4Results.find((candidate) =>
      candidate.definitionId === report.definitionId &&
      candidate.revision === view.revision &&
      candidate.diagnostics.length === 0,
    );
    const reportSourceHasNoCurrentResult = Boolean(report &&
      j4DefinitionIds.includes(report.definitionId) &&
      missingJ4DefinitionIds.includes(report.definitionId));
    const update = (patch: Partial<NonNullable<typeof report>>) => {
      if (report) {
        setReportRenderReady(false);
        onUpdateReport({ ...report, ...patch });
      }
    };
    const textValue = (field: ReportPresentationTextField): string =>
      activeReportTextDraft?.values[field] ?? report?.[field] ?? "";
    const textViolation = (field: ReportPresentationTextField) =>
      reportPresentationTextLimitViolation(field, textValue(field));
    const updateText = (field: ReportPresentationTextField, value: string): void => {
      if (!report || !view) return;
      if (reportPresentationTextLimitViolation(field, value)) {
        setReportTextDraft((current) => ({
          occurrence: view.occurrence,
          definitionId: report.definitionId,
          type: report.type,
          values: {
            ...(current && current.occurrence === view.occurrence && current.definitionId === report.definitionId && current.type === report.type
              ? current.values
              : {}),
            [field]: value,
          },
        }));
        return;
      }
      setReportTextDraft((current) => {
        if (!current || current.occurrence !== view.occurrence || current.definitionId !== report.definitionId || current.type !== report.type) return current;
        const { [field]: _discarded, ...remaining } = current.values;
        return Object.keys(remaining).length > 0 ? { ...current, values: remaining } : null;
      });
      update({ [field]: value });
    };
    const exportPng = async () => {
      if (!report || !result || controlsLocked) return;
      if (hasInvalidReportDraft) {
        setLocalError("Correct the invalid report presentation text before exporting PNG.");
        return;
      }
      if (!onExportReportPng({ occurrence: view.occurrence, revision: view.revision }, report)) return;
      const canvas = reportCanvasRef.current;
      if (!canvas || canvas.dataset.reportReady !== "true") {
        setLocalError("The current report image could not be rendered, so no PNG was downloaded.");
        return;
      }
      const encodingFailed = "The current report image could not be encoded, so no PNG was downloaded.";
      // The save is requested before encoding finishes, so it already counts
      // as work in progress while the PNG is being produced.
      const png = new Promise<Blob>((resolve, reject) => {
        try {
          canvas.toBlob((blob) => {
            if (!blob || blob.type !== "image/png" || blob.size === 0) reject(new Error(encodingFailed));
            else resolve(blob);
          }, "image/png");
        } catch {
          reject(new Error(encodingFailed));
        }
      });
      hostFiles.saveFile("tachiko-sheet-report.png", png).catch((error: unknown) => {
        setLocalError(error instanceof Error && error.message ? error.message : encodingFailed);
      });
    };
    const removeReport = () => {
      if (!onRemoveReport()) return;
      setReportTextDraft(null);
      window.setTimeout(() => document.getElementById(tabId("report"))?.focus(), 0);
    };
    const reportLayoutState = !report ? "empty" : !result ? "stale" : "configured";
    return <div role="tabpanel" id={panelId("report")} aria-labelledby={tabId("report")} className="ts-panel ts-report-panel">
      <section className="ts-report-composition" aria-label="Current report">
        <h1 className="ts-content-heading">Current report</h1>
        <div className={`ts-report-layout ts-report-layout--${reportLayoutState}`}>
        <div className="ts-report-settings">
          {!report ? <p className="ts-empty">Create a bar or line report from a current cross-table result.</p> : <>
            {!result ? <p role="status">{currentness === "pending"
              ? "Updating… — the report is unavailable until previous results are confirmed."
              : reportSourceHasDiagnostics
                ? "This summary needs attention. Correct the source data to see the report. Previous chart values are hidden."
                : currentness === "current" && reportSourceHasNoCurrentResult
                  ? "This summary has no confirmed current result. Refresh it to try again. Previous chart values are hidden."
                  : "This report source is not current. Refresh the cross-table summary before viewing or sharing it, or remove this report configuration before saving."}</p> : null}
            <div className="ts-report-controls">
              {(["title", "categoryLabel", "valueLabel"] as const).map((field) => {
                const labels = { title: "Title", categoryLabel: "Category label", valueLabel: "Value label" };
                const ids = { title: "report-title", categoryLabel: "report-category-label", valueLabel: "report-value-label" };
                const violation = textViolation(field);
                const errorId = `${ids[field]}-error`;
                return <div key={field}>
                  <label className="ts-field-label" htmlFor={ids[field]}>{labels[field]}</label>
                  <input id={ids[field]} value={textValue(field)} onChange={(event) => updateText(field, event.currentTarget.value)} disabled={controlsLocked} aria-invalid={violation ? true : undefined} aria-describedby={violation ? errorId : undefined} />
                  {violation ? <p id={errorId} className="ts-subtle" role="status">{labels[field]} must be {violation.limit} Unicode code points or fewer ({violation.length} entered). This value has not been applied.</p> : null}
                </div>;
              })}
              <label className="ts-check"><input type="checkbox" checked={report.legendVisible} onChange={(event) => update({ legendVisible: event.currentTarget.checked })} disabled={controlsLocked} /> Show legend</label>
            </div>
          </>}
        </div>
        <div className="ts-report-document">
          {report && result ? <>
            <h2 className="ts-report-document-heading">Complete current group result</h2>
            <dl className="ts-report-data" aria-label="Current report data">
              {result.groups.map((group) => <div key={group.category}><dt>{group.category}</dt><dd>{group.value}</dd></div>)}
              <div className="ts-report-currentness"><dt>Results</dt><dd>{currentness === "current" && result.revision === view.revision ? "up to date" : freshnessNotice(currentness)}</dd></div>
            </dl>
            <p className="ts-subtle ts-report-output-note">This {report.type} report shows the complete current summary. It does not store a separate copy of the values.</p>
            {result.groups.length === 0 ? <p role="status">No groups in the current result.</p> : null}
            <div role="region" aria-label="Report chart" tabIndex={0} className="ts-report-scroll"><ReportCanvas key={reportRenderKey} canvasRef={reportCanvasRef} report={report} groups={result.groups} onRenderState={onReportRenderState} /></div>
            {!reportCanvasReady ? <p role="status">The current report image could not be rendered. PNG export is unavailable.</p> : null}
            {hasInvalidReportDraft ? <p role="status">Correct the invalid report presentation text before saving or exporting. The current report has not been changed.</p> : null}
            <button type="button" className="ts-button ts-button--primary" onClick={exportPng} disabled={controlsLocked || !reportCanvasReady || hasInvalidReportDraft}>Export current PNG</button>
          </> : null}
        </div>
        {report ? <div className="ts-report-remove">
          <button type="button" className="ts-button ts-button--ghost" onClick={removeReport} disabled={controlsLocked}>Remove report</button>
          <p className="ts-subtle">This removes only the report configuration{hasInvalidReportDraft ? " and discards the uncommitted presentation text" : ""}. Table data and the cross-table definition stay available.</p>
        </div> : null}
        </div>
      </section>
    </div>;
  }

  function renderWorkbook(): ReactNode {
    if (!view || !table) return null;
    return (
      <div className="ts-workbook" data-testid="project-ready" aria-busy={busy}>
        {renderToolbar()}
        <nav className="ts-work-context" aria-label="Workbook actions">
          <div className="ts-context-table">
            <label className="ts-field-label" htmlFor="ts-active-table">Table</label>
            <select id="ts-active-table" value={view.table.collection.key} onChange={(event) => void selectCollection(event.currentTarget.value)} title={rowDraftActive ? "Add or discard the new row first." : undefined} disabled={controlsLocked || cellDraftActive || rowDraftActive}>
              {view.collections.map((collection) => <option key={collection.key} value={collection.key}>{names.table(collection.id) ?? collection.display_name}</option>)}
            </select>
          </div>
        </nav>
        {rowDraftActive && tab !== "table" ? <div className="ts-entry-actions">
          <span className="ts-hint">Add or discard the new row first.</span>
          <button type="button" className="ts-button" disabled={controlsLocked} onClick={() => { setTab("table"); if (columns[0]) focusDraftAfterRender(columns[0].id, completionIntent()); }}>Review new row</button>
        </div> : null}
        {controlsLocked ? (
          <p className="ts-hint" id={lockNoteId} role="note">
            {currentness === "unknown" ? "The current work is not confirmed. Use Refresh to recheck it before editing." : "An operation is in progress; editing is disabled until it finishes."}
          </p>
        ) : null}
        <div className="ts-workbook-panel-slot ts-workbook-table-slot">
          {tab === "table" ? renderTablePanel() : null}
        </div>
        <footer className="ts-workspace-footer">
          <div className="ts-tabs" role="tablist" aria-label="Workbook views" onKeyDown={onTabListKeyDown}>
            <span className="ts-views-label" aria-hidden="true">Views</span>
            <button type="button" role="tab" id={tabId("table")} aria-selected={tab === "table"} aria-controls={panelId("table")} tabIndex={tab === "table" ? 0 : -1} className={tab === "table" ? "ts-tab ts-tab--active" : "ts-tab"} onClick={() => selectTab("table")}>Table</button>
            <button type="button" role="tab" id={tabId("summary")} aria-selected={tab === "summary"} aria-controls={panelId("summary")} tabIndex={tab === "summary" ? 0 : -1} className={tab === "summary" ? "ts-tab ts-tab--active" : "ts-tab"} onClick={() => selectTab("summary")}>Cross-table summary</button>
            <button type="button" role="tab" id={tabId("report")} aria-selected={tab === "report"} aria-controls={panelId("report")} tabIndex={tab === "report" ? 0 : -1} className={tab === "report" ? "ts-tab ts-tab--active" : "ts-tab"} onClick={() => selectTab("report")}>Report</button>
            <button type="button" role="tab" id={tabId("brief")} aria-selected={tab === "brief"} aria-controls={panelId("brief")} tabIndex={tab === "brief" ? 0 : -1} className={tab === "brief" ? "ts-tab ts-tab--active" : "ts-tab"} onClick={() => selectTab("brief")}>Brief</button>
            <button type="button" role="tab" id={tabId("interop")} aria-selected={tab === "interop"} aria-controls={panelId("interop")} tabIndex={tab === "interop" ? 0 : -1} className={tab === "interop" ? "ts-tab ts-tab--active" : "ts-tab"} onClick={() => selectTab("interop")}>Import & export</button>
          </div>
          <div className="ts-workbook-status">{renderStatusStrip()}</div>
        </footer>
        <div className="ts-workbook-panel-slot ts-workbook-secondary-slot">
          {tab === "table" ? null : tab === "summary" ? renderSummaryPanel() : tab === "report" ? renderReportPanel() : tab === "brief" ? renderBriefPanel() : renderInteropPanel()}
        </div>
      </div>
    );
  }

  function onTabListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const tabs: ActiveTab[] = ["table", "summary", "report", "brief", "interop"];
    const focused = (event.target as HTMLElement).id;
    const index = Math.max(0, tabs.findIndex((name) => tabId(name) === focused));
    selectTab(tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]!);
  }

  function selectTab(next: ActiveTab): void {
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  }

  function revealFocusedResult(target: HTMLElement, scrollport: HTMLElement, tablePanel: HTMLElement): void {
    const portRect = scrollport.getBoundingClientRect();
    const clipRect = tablePanel.getBoundingClientRect();
    const portTop = portRect.top + scrollport.clientTop;
    const portBottom = portTop + scrollport.clientHeight;
    const clipTop = clipRect.top + tablePanel.clientTop;
    const clipBottom = clipTop + tablePanel.clientHeight;
    const visible = { top: Math.max(portTop, clipTop), bottom: Math.min(portBottom, clipBottom) };
    if (visible.bottom <= visible.top) return;
    const targetRect = target.getBoundingClientRect();
    const delta = focusRevealScrollDelta({ top: targetRect.top, bottom: targetRect.bottom }, visible);
    if (delta === 0) return;
    const maximum = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight);
    const next = focusRevealNextScrollTop(scrollport.scrollTop, delta, maximum);
    if (next !== scrollport.scrollTop) scrollport.scrollTop = next;
  }

  function scheduleFocusedResultReveal(target: HTMLElement): void {
    if (target.closest(".ts-workspace-footer, .ts-sales-tip, .ts-grid-scroll, [role='grid'], .ts-notes, .ts-cell-editor, [contenteditable='true']")) return;
    const shell = shellRef.current;
    const composition = target.closest<HTMLElement>(".ts-table-composition");
    const tablePanel = target.closest<HTMLElement>(".ts-table-panel");
    const resultsPane = target.closest<HTMLElement>(".ts-results-pane");
    const isShowResults = target.closest(".ts-results-show") !== null;
    if (!shell || !composition || !tablePanel || (!resultsPane && !isShowResults)) return;
    const expectedViewKey = composition.dataset.focusRevealViewKey;
    if (!expectedViewKey) return;
    if (resultsFocusRevealFrameRef.current !== null) window.cancelAnimationFrame(resultsFocusRevealFrameRef.current);
    resultsFocusRevealFrameRef.current = window.requestAnimationFrame(() => {
      resultsFocusRevealFrameRef.current = null;
      const currentShell = shellRef.current;
      const stillCurrent = focusRevealStillCurrent({
        targetConnected: target.isConnected && Boolean(currentShell?.contains(target)),
        targetIsActive: target.ownerDocument.activeElement === target,
        compositionConnected: composition.isConnected,
        compositionIsCurrent: Boolean(currentShell && currentShell.querySelector(".ts-table-composition") === composition &&
          composition.dataset.focusRevealViewKey === expectedViewKey && composition.closest(".ts-table-panel") === tablePanel && tablePanel.isConnected),
      });
      if (!stillCurrent) return;
      if (window.innerWidth < 1024) {
        revealFocusedResult(target, composition, tablePanel);
        return;
      }
      if (resultsPane?.isConnected) revealFocusedResult(target, resultsPane, tablePanel);
      revealFocusedResult(target, composition, tablePanel);
    });
  }

  if (props.reloadRequired) {
    return (
      <div className="ts-app" data-view="reload-required" role="alert">
        <main className="ts-home">
          <section className="ts-card" aria-label="Reload required">
            <h1 className="ts-h2">Reload required</h1>
            <p className="ts-dialog-error">{message ?? LOCAL_RUNTIME_RELOAD_REQUIRED_MESSAGE}</p>
            <button type="button" className="ts-button ts-button--primary" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className="ts-app"
      data-view={view ? "workbook" : "home"}
      data-sales-entry-tip={salesEntryTip ? `${salesEntryTip.collection}.${salesEntryTip.field}` : undefined}
      data-sales-catalog-layout={view && salesCatalogLayoutEligible(view, salesCatalogLayout) ? "true" : undefined}
      onCompositionStartCapture={beginAppearanceComposition}
      onCompositionEndCapture={scheduleAppearanceCompositionEnd}
      onFocusCapture={(event) => {
        const request = historyFocusRequestRef.current;
        const destination = event.target;
        if (destination instanceof HTMLElement) {
          scheduleFocusedResultReveal(destination);
          if (request && !request.settled && destination !== request.initiator && historyFocusDestinationIsUsable(destination, shellRef.current)) {
            const updated = { ...request, userDestination: destination };
            historyFocusRequestRef.current = updated;
            setHistoryFocusRequest(updated);
          }
        }
      }}
      onPointerDownCapture={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        clearOwnedSharedPointer(heldPointerOwnerRef);
        const button = holdSharedButton(event.target);
        if (button) heldPointerOwnerRef.current = { button, pointerId: event.pointerId };
      }}
      onPointerOverCapture={(event) => {
        const owner = heldPointerOwnerRef.current;
        if (!owner || event.pointerId !== owner.pointerId || !event.isPrimary || (event.buttons & 1) !== 1) return;
        if (sharedButtonFromTarget(event.target) !== owner.button) return;
        if (sharedButtonIsEligible(owner.button)) owner.button.setAttribute("data-ts-held", "");
        else clearOwnedSharedPointer(heldPointerOwnerRef, event.pointerId);
      }}
      onPointerOutCapture={(event) => {
        const owner = heldPointerOwnerRef.current;
        const button = sharedButtonFromTarget(event.target);
        const next = event.relatedTarget;
        if (!owner || !button || owner.button !== button || owner.pointerId !== event.pointerId || !event.isPrimary) return;
        if (next instanceof Node && button.contains(next)) return;
        button.removeAttribute("data-ts-held");
        if ((event.buttons & 1) !== 1) clearOwnedSharedPointer(heldPointerOwnerRef, event.pointerId);
      }}
      onKeyDownCapture={(event) => {
        if (!event.defaultPrevented && (event.key === "Enter" || event.key === " ")) holdSharedButton(event.target);
      }}
      onKeyUpCapture={(event) => {
        if (event.key === "Enter" || event.key === " ") releaseSharedKeyboardButton(event.target, heldPointerOwnerRef);
      }}
      onClickCapture={(event) => releaseSharedButton(event.target, heldPointerOwnerRef)}
      onBlurCapture={(event) => releaseSharedButton(event.target, heldPointerOwnerRef)}
    >
      {errorMessage && !closeSaveErrorIsInline && !copyErrorIsInline && !importErrorIsInline && !downloadErrorIsInline ? (
        <div className="ts-error" role="alert">
          {errorMessage}
        </div>
      ) : null}
      {view ? renderWorkbook() : renderHome()}
      {newTableOpen && onNewTable ? <NewTableDialog onCreate={async (name, columns) => {
        const generation = focusIntentRef.current;
        const created = await onNewTable(name, columns);
        if (created) newTableFocusIntentRef.current = generation;
        return created;
      }} onSuccess={() => setNewTableOpen(false)} onDraftChange={setNewTableDraftActive} onCancel={() => { setNewTableOpen(false); requestAnimationFrame(() => newTableTriggerRef.current?.focus()); }} /> : null}
      {deleteName !== null ? <Modal variant="close" label="Delete copy" onCancel={cancelDelete} dismissDisabled={deletePending}>
        <div className="ts-dialog-intro"><h2 ref={deletePendingFocusRef} className="ts-h2" tabIndex={deletePending || deleteError !== null ? 0 : -1}>Delete “{deleteName}”?</h2><p>This deletes the saved copy from this device. It cannot be undone.</p></div>
        {deleteError ? <p role="alert" className="ts-dialog-error">{deleteError}</p> : null}
        <div className="ts-dialog-actions">
          <button type="button" className="ts-button" data-autofocus="true" onClick={cancelDelete} disabled={deletePending}>Cancel</button>
          <button type="button" className="ts-button ts-button--danger" onClick={() => void deleteCopy()} disabled={deletePending || controlsLocked}>Delete</button>
        </div>
      </Modal> : null}
      {copyOpen ? (
        <Modal variant="save" label="Save a copy" onCancel={closeCopyDialog} dismissDisabled={copyPending}>
          <div className="ts-dialog-intro">
            <h2 className="ts-h2">Save a copy</h2>
            <p className="ts-subtle">{hostCopy.createCopyScope}<br />It does not update an existing one.</p>
          </div>
          <div className="ts-dialog-field">
            <label className="ts-field-label" htmlFor={copyNameId}>Copy name</label>
            <input
              id={copyNameId}
              className="ts-text-input"
              ref={copyNameInputRef}
              data-autofocus="true"
              value={copyName}
              readOnly={copyPending}
              aria-describedby={copyError ? copyErrorId : undefined}
              onChange={(event) => {
                setCopyError(null);
                setCopyName(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !isComposingEvent(event)) {
                  event.preventDefault();
                  void createCopy();
                }
              }}
            />
          </div>
          {rowDraftActive ? <p className="ts-hint">Add or discard the new row first. Cancel to return to your draft.</p> : null}
          {copyError ? (
            <p className="ts-dialog-error" id={copyErrorId} role="alert">
              {copyError}
            </p>
          ) : null}
          <div className="ts-dialog-actions">
            <button
              type="button"
              className="ts-button"
              onClick={closeCopyDialog}
              disabled={copyPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ts-button ts-button--primary"
              onClick={() => void createCopy()}
              disabled={copyPending || copyName.trim() === "" || hasInvalidReportDraft || rowDraftActive}
              aria-busy={copyPending}
            >
              {copyPending ? "Working…" : "Create copy"}
            </button>
          </div>
        </Modal>
      ) : null}
      {interop?.importInspection ? (
        <Modal variant="import" label="Review import preview" onCancel={cancelImport} dismissDisabled={importPending}>
          <div className="ts-dialog-intro">
            <h2
              ref={importPendingFocusRef}
              className="ts-h2"
              tabIndex={interop.importInspection.source.ledger.length || importPending || Boolean(importError) ? 0 : -1}
              data-autofocus={interop.importInspection.source.ledger.length ? "true" : undefined}
            >Review import preview</h2>
            <p className="ts-subtle">{interop.importInspection.name}: {interop.importInspection.source.sheets.length} sheet(s). Check each column's type before importing. Number is suggested only where every value is a plain number; everything else stays Text.</p>
          </div>
          <div className="ts-dialog-scroll">
            {(() => {
              // Changes, losses and refusals stay in view; notes that only
              // confirm faithful reading are available on request.
              const ledger = interop.importInspection.source.ledger;
              const attention = ledger.filter((finding) => finding.blocking || !INFORMATIONAL_FINDINGS.has(finding.category));
              return <>
                {attention.length ? <ul className="ts-ledger" aria-label="Import preview changes and warnings">{attention.map((finding, index) => <li key={`${finding.code}-${index}`}>{finding.location}: {findingMessage(finding.message)}</li>)}</ul> : <p className="ts-hint ts-dialog-success">Nothing in this file needs your attention before import.</p>}
              </>;
            })()}
            <div className="ts-import-columns">{interop.importInspection.source.sheets.map((sheet, sheetIndex) => <section key={sheet.name}><h3 className="ts-h2">{sheet.name}</h3>{sheet.rows.length ? <div className="ts-import-preview-scroll"><table className="ts-import-preview" aria-label={`First rows of ${sheet.name}`}><thead><tr>{sheet.columns.map((column, columnIndex) => <th key={columnIndex} scope="col">{column.name}</th>)}</tr></thead><tbody>{sheet.rows.slice(0, 5).map((row, rowIndex) => <tr key={rowIndex}>{sheet.columns.map((_, columnIndex) => <td key={columnIndex}>{sourcePreviewText(row[columnIndex]?.value)}</td>)}</tr>)}</tbody></table><p className="ts-hint">{sheet.rows.length > 5 ? `First 5 of ${sheet.rows.length.toLocaleString("en-US")} rows` : `${sheet.rows.length} row${sheet.rows.length === 1 ? "" : "s"}`}</p></div> : null}{sheet.columns.map((column, columnIndex) => <label className="ts-import-column" key={column.name}>{column.name}{importSuggestions[sheetIndex]?.[columnIndex] === "number" ? <span className="ts-import-suggested"> · Number suggested from its values</span> : null}<select value={importTypes[sheetIndex]?.[columnIndex] ?? "text"} disabled={importPending} onChange={(event) => { const nextType = event.currentTarget.value; setImportChoice((current) => chooseImportType(current, importSuggestions, sheetIndex, columnIndex, nextType)); }}><option value="text">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="date">Date</option></select></label>)}</section>)}</div>
            {(() => {
              const notes = interop.importInspection.source.ledger.filter((finding) => !finding.blocking && INFORMATIONAL_FINDINGS.has(finding.category));
              return notes.length ? <details className="ts-import-notes"><summary>Import details ({notes.length})</summary><ul className="ts-ledger" aria-label="Import details">{notes.map((finding, index) => <li key={`${finding.code}-${index}`}>{finding.location}: {findingMessage(finding.message)}</li>)}</ul></details> : null;
            })()}
          </div>
          {importErrorMessage ? <p className="ts-dialog-error ts-dialog-error--import" role="alert">{importErrorMessage}</p> : null}
          <div className="ts-dialog-actions"><button type="button" className="ts-button" onClick={cancelImport} disabled={importPending}>Cancel</button><button ref={importRetryButtonRef} type="button" className="ts-button ts-button--primary" data-autofocus={interop.importInspection.source.ledger.length ? undefined : "true"} onClick={() => void importCandidate()} disabled={controlsLocked || importPending} aria-busy={importPending}>Import file</button></div>
        </Modal>
      ) : null}
      {downloadFormat ? <Modal variant="review" label="Confirm download" onCancel={cancelDownload} dismissDisabled={busy}>
        <div className="ts-dialog-intro">
          <h2 ref={downloadPendingFocusRef} className="ts-h2" tabIndex={0} data-autofocus="true">Review and download {downloadFormat === "ro" ? "work file (.ro)" : downloadFormat.toUpperCase()}</h2>
          <p>The file has been prepared. {hostCopy.exportConsent}</p>
          {downloadFormat === "ro" ? <p>Includes tables, values, formulas and summaries. Downloading does not save a copy on this device or allow unsaved work to close.</p> : null}
        </div>
        <div className="ts-dialog-scroll">
          {downloadFormat === "ro" ? downloadOmissions.length > 0 ? <>
            <h3 className="ts-content-heading">Not included in this file</h3>
            <ul className="ts-ledger" aria-label="Not included in this file">{downloadOmissions.map((omission) => <li key={omission} data-loss-category="lossy_on_export">{omission}</li>)}</ul>
          </> : <p className="ts-hint">This work has no attached spreadsheet file or report settings to leave out.</p> : interop?.ledger.length ? <ul className="ts-ledger" aria-label="Export changes and warnings">{interop.ledger.map((finding, index) => <li key={`${finding.code}-${index}`}><strong>{findingCategoryLabel(finding.category)}</strong>: {finding.location ? `${finding.location}: ` : ""}{findingMessage(finding.message)}</li>)}</ul> : <p className="ts-hint ts-dialog-success">No changes or losses were reported for this file.</p>}
        </div>
        <div className="ts-dialog-actions">
          <button type="button" className="ts-button" disabled={busy} onClick={cancelDownload}>Cancel</button>
          <button type="button" className="ts-button ts-button--primary" disabled={busy} onClick={() => { downloadPendingFocusRef.current?.focus(); void onDownload(downloadFormat).then(() => cancelDownload(), () => cancelDownload()); }}>Download</button>
        </div>
      </Modal> : null}
      {closeOpen && !copyOpen && !savedClose ? (() => {
        const closeSaveReason = closeSaveUnavailableReason({ saveStatus, currentness, busy: controlsLocked, workFileSaveUnavailableReason: view?.openedFromWorkFile ? workFileSaveUnavailableReason : null }, cellDraftActive || rowDraftActive || anyNotesDraft || hasInvalidReportDraft);
        return (
        <Modal variant="close" label="Unsaved work" onCancel={keepEditing}>
          <div className="ts-dialog-intro">
            <h2 className="ts-h2">Unsaved work</h2>
            <p>This work has changes that are not saved. Keep editing to return to the sheet, or close without saving.</p>
            {closeSaveError ? <p className="ts-dialog-error" role="alert">{closeSaveError}</p> : null}
            {closeSaveReason ? <p className="ts-hint" id={closeSaveUnavailableId}>{closeSaveReason}</p> : null}
          </div>
          <div className="ts-dialog-actions">
            <button type="button" className="ts-button" ref={keepEditingButtonRef} data-autofocus="true" onClick={keepEditing}>
              Keep editing
            </button>
            {view?.openedFromWorkFile ? <button type="button" className="ts-button" disabled={workFileDownloadLocked} onClick={(event) => { invalidateCloseSaveIntent(); setCloseOpen(false); void prepareDownload("ro", event.currentTarget); }}>Download work file (.ro)</button> : null}
            <span className="ts-close-save-action">
              <button type="button" className="ts-button ts-button--primary" onClick={() => { keepEditingButtonRef.current?.focus(); void saveWork(true); }} disabled={closeSaveReason !== null} aria-describedby={closeSaveReason ? closeSaveUnavailableId : undefined}>
                Save
              </button>
              <button type="button" className="ts-button" ref={closeSaveButtonRef} onClick={() => openCopyDialog(true)} disabled={closeSaveReason !== null} aria-describedby={closeSaveReason ? closeSaveUnavailableId : undefined}>
                Save a copy…
              </button>
            </span>
            <button type="button" className="ts-button ts-button--danger" onClick={() => void closeWork()} disabled={saveStatus === "saving"}>
              Close without saving
            </button>
          </div>
        </Modal>
        );
      })() : null}
    </div>
  );
}

function currentnessLabel(currentness: SheetShellProps["currentness"], resultsNeedAttention = false): string {
  if (currentness === "current") return resultsNeedAttention ? "Results need attention" : "Up to date";
  if (currentness === "pending") return "Updating…";
  return "Needs refresh";
}

function freshnessNotice(currentness: SheetShellProps["currentness"]): string {
  return currentness === "pending"
    ? "These values are being updated; wait for confirmation before editing."
    : "These values could not be confirmed. Refresh before editing.";
}

function saveLabel(saveStatus: SheetShellProps["saveStatus"]): string {
  switch (saveStatus) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved on this device";
    case "failed":
      return "Save failed";
    default:
      return "Not saved yet";
  }
}

function workStateLabel(dirty: boolean): string {
  return dirty ? "Edited — not saved" : "Unchanged";
}

function outcomeLabel(outcome: SheetShellProps["outcome"]): string {
  if (outcome === "pending") return "Applying changes…";
  if (outcome === "unknown") return "Outcome needs review";
  return "";
}

const INFORMATIONAL_FINDINGS = new Set<string>(["native_equivalent", "preserved_readable"]);

function explain(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return `${fallback} (Details: ${error.message})`;
  return fallback;
}
