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
  SheetShellProps,
  ViewWitness,
  WorkbookView,
} from "../contracts.js";
import type { InterfaceProfileV1 } from "../application/interface-profile-contract.js";
import { reportPresentationTextLimitViolation } from "../contracts.js";
import { historyCommandForKey } from "./history-keyboard.js";
import { BriefFacts } from "./BriefFacts.js";
import { AppearanceSelector } from "./AppearanceSelector.js";
import { fieldDisplay, parseBooleanDraft, scalarEditOf, seedTextOf } from "./field-display.js";
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

interface NotesDraft {
  occurrence: string;
  revision: string;
  entity: string;
  value: string;
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
  return target.closest<HTMLButtonElement>(".ts-app .ts-button");
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
  document.querySelectorAll<HTMLButtonElement>(".ts-app .ts-button[data-ts-held]").forEach((button) => {
    button.removeAttribute("data-ts-held");
  });
}

export function SheetShell(props: SheetShellProps) {
  const {
    view,
    busy,
    dirty,
    currentness,
    outcome,
    saveStatus,
    message,
    copies,
    onOpenFiles,
    onOpenExample,
    onOpenSaved,
    onSelectCollection = async () => {},
    onCommit,
    localHistory = emptyLocalHistory(),
    onHistory = async () => null,
    onCreateCopy,
    onClose,
    onRefresh,
    interop = null,
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
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [notesDrafts, setNotesDrafts] = useState<NotesDraft[]>([]);
  const [commitPending, setCommitPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyName, setCopyName] = useState("");
  const [copyPending, setCopyPending] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyParentFailureMessage, setCopyParentFailureMessage] = useState<string | null>(null);
  const [captureCopyParentFailure, setCaptureCopyParentFailure] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [historyFocusRequest, setHistoryFocusRequest] = useState<HistoryFocusRequest | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPending, setImportPending] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<"csv" | "xlsx" | null>(null);
  const [importTypes, setImportTypes] = useState<string[][]>([]);
  const [j4Catalog, setJ4Catalog] = useState<KeyedGroupedSumBindingCatalog | null>(null);
  const [j4Binding, setJ4Binding] = useState<KeyedGroupedSumBindingChoice | null>(null);
  const [j4Pending, setJ4Pending] = useState(false);
  const [reportRenderReady, setReportRenderReady] = useState(false);
  const [reportRenderReadyKey, setReportRenderReadyKey] = useState("unavailable");
  const [reportTextDraft, setReportTextDraft] = useState<ReportTextDraft | null>(null);

  const fileInputId = useId();
  const spreadsheetInputId = useId();
  const copyNameId = useId();
  const copyErrorId = useId();
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
  const focusRejectedEditorRef = useRef(false);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const spreadsheetInputRef = useRef<HTMLInputElement | null>(null);
  const lastNotesOccurrenceRef = useRef<string | null>(null);
  const lastCellRef = useRef<HTMLTableCellElement | null>(null);
  const saveCopyButtonRef = useRef<HTMLButtonElement | null>(null);
  const recoveryCloseTriggerRef = useRef<HTMLButtonElement | null>(null);
  const recoveryRefreshRef = useRef<HTMLButtonElement | null>(null);
  const desktopRefreshRef = useRef<HTMLButtonElement | null>(null);
  const commandOverflowSummaryRef = useRef<HTMLElement | null>(null);
  const importPendingFocusRef = useRef<HTMLHeadingElement | null>(null);
  const importRetryButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyNameInputRef = useRef<HTMLInputElement | null>(null);
  const copyParentMessageAtAttemptRef = useRef<string | null>(message);
  const downloadTriggerRef = useRef<HTMLButtonElement | null>(null);
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
  const lastCollectionIdentityRef = useRef(collectionIdentity);
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

  // The callback only requests a collection; the installed projection is the
  // authority for a real switch. Reset roving focus before the new grid paints
  // so an old table key cannot leave this grid with no tab stop.
  useLayoutEffect(() => {
    if (lastCollectionIdentityRef.current !== collectionIdentity) {
      setFocusedKey(null);
      lastCellRef.current = null;
    }
    lastCollectionIdentityRef.current = collectionIdentity;
  }, [collectionIdentity]);

  useLayoutEffect(() => {
    if (commitPending || !focusRejectedEditorRef.current) return;
    const input = editorInputRef.current;
    if (!editor || !input) {
      focusRejectedEditorRef.current = false;
      return;
    }
    if (props.busy || currentness === "unknown" || input.disabled) return;
    focusRejectedEditorRef.current = false;
    input.focus();
  }, [commitPending, currentness, editor, props.busy]);

  useEffect(() => {
    if (!view) {
      setSelectedEntity(null);
      return;
    }
    const entities = view.table.rows.map(rowEntity);
    setSelectedEntity((previous) => (previous && entities.includes(previous) ? previous : entities[0] ?? null));
  }, [view]);

  useEffect(() => {
    const inspection = interop?.importInspection;
    setImportTypes(inspection ? inspection.source.sheets.map((sheet) => sheet.columns.map(() => "text")) : []);
  }, [interop?.importInspection]);

  const table = view?.table ?? null;
  const columns = useMemo(() => (table ? tableColumns(table) : []), [table]);
  const gridOrder = useMemo(() => {
    if (!table) return [] as GridPosition[];
    const tableCols = tableColumns(table);
    return table.rows.flatMap((row) => {
      const entity = rowEntity(row);
      return tableCols.map((column) => ({
        entity,
        field: column.id,
      }));
    });
  }, [table]);
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
  const notesDraftBound = Boolean(
    activeNotesDraft && view && activeNotesDraft.revision === view.revision,
  );
  const notesValue = activeNotesDraft?.value ?? notesCommitted;
  const notesDirty = activeNotesDraft !== undefined && activeNotesDraft.value !== notesCommitted;
  const anyNotesDraft = notesDrafts.length > 0;
  const notesEditable = Boolean(notesField && notesField.editable_scalar === "text");

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
  const modalInteractionOpen = copyOpen || closeOpen || downloadFormat !== null || Boolean(interop?.importInspection);
  const historyDraftLocked = editor !== null || anyNotesDraft;
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
    }
    if (!destination && historyFocusDestinationIsUsable(request.initiator, shell)) {
      destination = request.initiator;
    }
    if (!destination && currentness === "unknown") {
      const recoveryRefresh = recoveryRefreshRef.current;
      if (historyFocusDestinationIsUsable(recoveryRefresh, shell)) destination = recoveryRefresh;
    }
    if (!destination) {
      const more = commandOverflowSummaryRef.current;
      const refresh = desktopRefreshRef.current;
      if (historyFocusDestinationIsUsable(more, shell)) destination = more;
      else if (historyFocusDestinationIsUsable(refresh, shell)) destination = refresh;
    }
    if (destination && document.activeElement !== destination) destination.focus();
    historyFocusRequestRef.current = null;
    setHistoryFocusRequest(null);
  }, [busy, commitPending, currentness, gridOrder, historyFocusRequest, view]);

  useEffect(() => {
    function onHistoryKeyDown(event: KeyboardEvent): void {
      const shell = shellRef.current;
      if (!shell || !shell.contains(event.target as Node)) return;
      const direction = historyCommandForKey(
        event,
        event.target,
        historyInteractionLocked || props.appearancePreference.getSnapshot().composing || controlsLocked,
      );
      if (!direction || (direction === "undo" ? localHistory.undoCount < 1 : localHistory.redoCount < 1)) return;
      event.preventDefault();
      void requestHistory(direction, document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
    window.addEventListener("keydown", onHistoryKeyDown);
    return () => window.removeEventListener("keydown", onHistoryKeyDown);
  }, [controlsLocked, historyInteractionLocked, localHistory, onHistory, props.appearancePreference]);
  const cellDraftActive = editor !== null && editor.value !== editor.original;
  const draftActive =
    cellDraftActive || anyNotesDraft || (copyOpen && copyName.trim() !== "");
  const errorMessage = localError ?? copyError ?? (message && message.length > 0 ? message : null);
  const importErrorMessage = interop?.importInspection
    ? (importError && message && message.length > 0 ? message : importError)
    : importError;
  const copyErrorIsInline = copyOpen && localError === null && (
    copyError !== null || (copyParentFailureMessage !== null && message === copyParentFailureMessage)
  );
  const importErrorIsInline = Boolean(
    importError && localError === null && copyError === null &&
      errorMessage !== null && errorMessage === importErrorMessage,
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
      grid.style.setProperty(
        "--ts-grid-available-height",
        `${availableGridScrollHeight(gridTop, panel.getBoundingClientRect().bottom)}px`,
      );
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
    };
  }, [view, tab, currentness, errorMessage, busy, commitPending]);

  useEffect(() => {
    onDraftChangeRef.current(draftActive);
  }, [draftActive]);

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
    if (editor && editor.value !== editor.original && (editor.entity !== entity || editor.field !== field.target.field)) {
      setLocalError("Apply or cancel the value you are editing before you edit another cell.");
      focusCell(editor.entity, editor.field);
      return;
    }
    const original = seedTextOf(field);
    selectEditorValueOnFocusRef.current = seed === undefined;
    focusRejectedEditorRef.current = false;
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

  function cancelEdit(): void {
    const cancelled = editor;
    setEditor(null);
    setLocalError(null);
    if (cancelled) focusCell(cancelled.entity, cancelled.field);
  }

  function focusCell(entity: string, field: string): void {
    const node = cellRefs.current.get(cellKey(entity, field));
    node?.focus();
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

  function moveFocus(event: ReactKeyboardEvent<HTMLElement>, position: GridPosition, step: number): void {
    const index = gridOrder.findIndex((item) => item.entity === position.entity && item.field === position.field);
    if (index < 0) return;
    const next = index + step;
    if (next < 0 || next >= gridOrder.length) return;
    const target = gridOrder[next];
    if (!target) return;
    event.preventDefault();
    setSelectedEntity(target.entity);
    focusCell(target.entity, target.field);
  }

  function submitEditor(): void {
    void commitEditor();
  }

  async function commitEditor(): Promise<boolean> {
    if (!editor || commitPending || controlsLocked) return false;
    const field = currentEditorField(editor);
    if (!field) {
      setEditor(null);
      return false;
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
    const accepted = await runCommit(field.target, edit, () => {
      focusRejectedEditorRef.current = true;
    });
    if (accepted) {
      setEditor(null);
      setLocalError(null);
      focusCell(editor.entity, editor.field);
    }
    return accepted;
  }

  function onCellKeyDown(
    event: ReactKeyboardEvent<HTMLTableCellElement>,
    entity: string,
    field: FieldProjection | null,
    position: GridPosition,
  ): void {
    if (isComposingEvent(event)) return;
    const editable = Boolean(field?.editable_scalar) && !controlsLocked;
    if (event.key === "Enter" || event.key === "F2") {
      if (!editable) return;
      event.preventDefault();
      beginEdit(entity, field);
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
      beginEdit(entity, field, event.key);
    }
  }

  function onEditorKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (isComposingEvent(event)) return;
    // Keep editor input and caret keys from being reinterpreted by the cell grid.
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      submitEditor();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
      return;
    }
    if (event.key === "Tab" && editor) {
      event.preventDefault();
      const position = { entity: editor.entity, field: editor.field };
      const step = event.shiftKey ? -1 : 1;
      void commitEditor().then((accepted) => {
        if (accepted) moveFocus(event, position, step);
      });
    }
  }

  async function applyNotes(): Promise<void> {
    if (!notesField || !notesEditable || !notesDirty || !notesDraftBound || controlsLocked) return;
    const accepted = await runCommit(notesField.target, { kind: "text", value: notesValue });
    if (accepted) {
      setNotesDrafts((drafts) => drafts.filter((draft) => draft !== activeNotesDraft));
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
    setLocalError(null);
    try {
      await onOpenSaved(name);
    } catch (error) {
      setLocalError(explain(error, `Could not open the saved copy “${name}”.`));
    }
  }

  async function selectCollection(next: string): Promise<void> {
    if (!witness || next === view?.table.collection.key) return;
    if (cellDraftActive) {
      setLocalError("Apply or cancel the value you are editing before switching tables.");
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
    setLocalError(null);
    try {
      await onOpenExample();
    } catch (error) {
      setLocalError(explain(error, "Could not open the example work."));
    }
  }

  async function openJ4Canary(): Promise<void> {
    setLocalError(null);
    try {
      await onOpenJ4Canary();
    } catch (error) {
      setLocalError(explain(error, "Could not open the sales example."));
    }
  }

  async function openFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setLocalError(null);
    try {
      await onOpenFiles(files);
    } catch (error) {
      setLocalError(explain(error, "The selected folder could not be opened."));
    }
  }

  async function inspectSpreadsheet(file: File | null): Promise<void> {
    if (!file) return;
    setLocalError(null);
    setImportError(null);
    try { await onInspectImport(file); }
    catch (error) { setImportError(explain(error, "The spreadsheet could not be inspected.")); }
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
      setImportError(explain(error, "The import was not applied. Your source selection is still available."));
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

  async function prepareDownload(format: "csv" | "xlsx", trigger: HTMLButtonElement): Promise<void> {
    downloadTriggerRef.current = trigger;
    setLocalError(null);
    if (await onPrepareDownload(format)) setDownloadFormat(format);
  }

  function cancelDownload(): void {
    setDownloadFormat(null);
    window.requestAnimationFrame(() => downloadTriggerRef.current?.focus());
  }

  async function refresh(): Promise<void> {
    setLocalError(null);
    try {
      await onRefresh();
    } catch (error) {
      setLocalError(explain(error, "The work could not be refreshed."));
    }
  }

  function openCopyDialog(): void {
    setCopyError(null);
    setLocalError(null);
    setCopyName("");
    setCaptureCopyParentFailure(false);
    setCopyOpen(true);
  }

  function closeCopyDialog(): void {
    if (copyPending) return;
    setCopyOpen(false);
    setCopyError(null);
    setCopyName("");
    setCaptureCopyParentFailure(false);
    saveCopyButtonRef.current?.focus();
  }

  async function createCopy(): Promise<void> {
    const name = copyName.trim();
    if (name === "" || copyPending) return;
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
    try {
      const created = await onCreateCopy(name);
      if (created) {
        setCaptureCopyParentFailure(false);
        setCopyParentFailureMessage(null);
        setCopyOpen(false);
        setCopyError(null);
        setCopyName("");
        saveCopyButtonRef.current?.focus();
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
    if (dirty || draftActive || hasInvalidReportDraft || currentness === "unknown") {
      setCloseOpen(true);
      return;
    }
    await closeWork();
  }

  async function closeWork(): Promise<void> {
    setCloseOpen(false);
    setLocalError(null);
    try {
      await onClose();
    } catch (error) {
      setLocalError(explain(error, "The work could not be closed."));
    }
  }

  function keepEditing(): void {
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

  function renderHome(): ReactNode {
    const recoveryLocked = currentness === "unknown";
    const fileActionsLocked = controlsLocked || recoveryLocked;
    return (
      <main className="ts-home">
        {currentness === "unknown" ? (
          <section className="ts-card" aria-label="Recovery">
            <h2 className="ts-h2">Refresh required</h2>
            <p className="ts-subtle">The open work could not be confirmed. Refresh to read it again.</p>
            <div className="ts-status-strip" aria-label="Recovery status">
              <span className="ts-chip" data-testid="currentness" data-currentness={currentness}>
                {currentnessLabel(currentness)}
              </span>
              {outcome !== "idle" ? (
                <span className={`ts-chip ts-chip--${outcome}`} data-testid="operation-outcome">
                  {outcomeLabel(outcome)}
                </span>
              ) : null}
            </div>
            <button type="button" className="ts-button" ref={recoveryRefreshRef} onClick={() => void refresh()} disabled={busy || commitPending}>
              Refresh
            </button>
            <button type="button" className="ts-button ts-button--ghost" ref={recoveryCloseTriggerRef} onClick={() => void requestClose()} disabled={busy || commitPending}>
              Close and abandon recovery
            </button>
          </section>
        ) : null}
        <header className="ts-home-head">
          <h1 className="ts-brand">Tachiko Sheet</h1>
          {renderAppearanceSelector("home")}
        </header>
        <p className="ts-home-intro ts-home-desktop-intro">Open a project folder, or reopen a copy saved in this browser profile.</p>
        <p className="ts-home-intro ts-home-compact-intro">Open a local project or a saved copy.</p>
        <section className="ts-home-section" aria-label="Open project">
          <h2 className="ts-h2">Open</h2>
          <div className="ts-row-actions ts-home-open-actions">
            <label className={`ts-button ts-button--primary ts-home-file-action${fileActionsLocked ? " ts-home-file-action--disabled" : ""}`} aria-disabled={fileActionsLocked}>
              <span>Open project folder</span>
              <input
                id={fileInputId}
                data-testid="open-project"
                type="file"
                multiple
                disabled={fileActionsLocked}
                aria-describedby={busy ? lockNoteId : undefined}
                onChange={(event) => {
                  const input = event.currentTarget;
                  const files = input.files;
                  void openFiles(files).finally(() => {
                    input.value = "";
                  });
                }}
                {...directoryInputAttributes}
              />
            </label>
            <button type="button" className="ts-button" onClick={() => void openExample()} disabled={fileActionsLocked} aria-describedby={busy ? lockNoteId : undefined}>
              Try example
            </button>
            <button type="button" className="ts-button" onClick={() => void openJ4Canary()} disabled={fileActionsLocked} aria-describedby={busy ? lockNoteId : undefined}>
              Try sales example
            </button>
            {busy ? <span className="ts-status" role="status">Opening…</span> : null}
          </div>
          <p className="ts-subtle ts-home-open-desktop-help">Choose a local project folder. Its source stays unchanged.</p>
          <p className="ts-subtle ts-home-open-compact-help">The source folder stays unchanged.</p>
          {busy ? <p className="ts-hint" id={lockNoteId} role="note">An operation is in progress; controls are disabled until it finishes.</p> : null}
        </section>
        <section className="ts-home-section" aria-label="Import spreadsheet">
          <h2 className="ts-h2">Import CSV or XLSX</h2>
          <p className="ts-subtle ts-home-import-desktop-help">Review the source and column types before importing.</p>
          <label className={`ts-button ts-home-file-action ts-home-import-action${fileActionsLocked ? " ts-home-file-action--disabled" : ""}`} aria-disabled={fileActionsLocked}>
            <span>Choose CSV or XLSX</span>
            <input ref={spreadsheetInputRef} id={spreadsheetInputId} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={fileActionsLocked} onChange={(event) => { const input = event.currentTarget; void inspectSpreadsheet(input.files?.[0] ?? null).finally(() => { input.value = ""; }); }} />
          </label>
          <p className="ts-subtle ts-home-import-compact-help">Review the source and column types before importing.</p>
          {importError && !interop?.importInspection ? <p className="ts-dialog-error" role="alert">{importError}</p> : null}
        </section>
        <section className={`ts-home-section ts-home-saved${copies.length ? " ts-home-saved--populated" : ""}`} aria-label="Saved copies">
          <h2 className="ts-h2">Saved copies</h2>
          <p className="ts-subtle">Stored in this browser profile on this device.</p>
          {copies.length === 0 ? (
            <p className="ts-empty">No saved copies yet.</p>
          ) : (
            <ul className="ts-copy-list">
              {copies.map((copy, index) => {
                const whitespaceDescription = describeSavedCopyNameWhitespace(copy.name);
                const whitespaceDescriptionId = `${copyNameDescriptionBaseId}-${index}`;
                const describedBy = [
                  ...(busy ? [lockNoteId] : []),
                  ...(whitespaceDescription ? [whitespaceDescriptionId] : []),
                ].join(" ") || undefined;
                return (
                  <li key={copy.name} className="ts-copy-item">
                    <button
                      type="button"
                      className="ts-button ts-button--ghost ts-home-saved-action"
                      onClick={() => void openSaved(copy.name)}
                      disabled={controlsLocked || recoveryLocked}
                      aria-describedby={describedBy}
                    >
                      {`Open saved ${copy.name}`}
                    </button>
                    {whitespaceDescription ? <span className="ts-visually-hidden" id={whitespaceDescriptionId}>{whitespaceDescription}</span> : null}
                    <span className="ts-copy-meta">Saved {formatHomeSavedAt(copy.savedAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
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
            <h1 className="ts-title">{view ? view.title : ""}</h1>
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
          disabled={controlsLocked || historyInteractionLocked || localHistory.undoCount < 1 || localHistory.occurrence !== view?.occurrence || localHistory.revision !== view?.revision}
          aria-describedby={controlsLocked ? lockNoteId : undefined}
        >
          Undo
        </button>
        <button
          type="button"
          className="ts-button ts-history-command"
          onClick={(event) => void requestHistory("redo", event.currentTarget)}
          disabled={controlsLocked || historyInteractionLocked || localHistory.redoCount < 1 || localHistory.occurrence !== view?.occurrence || localHistory.revision !== view?.revision}
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
          <span className="ts-save-scope">Copies: this browser on this device</span>
        </div>
        <button
          type="button"
          className="ts-button ts-button--primary"
          ref={saveCopyButtonRef}
          onClick={openCopyDialog}
          disabled={controlsLocked || saveStatus === "saving"}
          aria-describedby={controlsLocked ? lockNoteId : undefined}
        >
          Save a copy
        </button>
        {closeButton("ts-button ts-close-project-desktop")}
        <details className="ts-command-overflow">
          <summary ref={commandOverflowSummaryRef} aria-label="More document commands">…</summary>
          <div className="ts-command-menu">
            <button type="button" className="ts-button ts-button--ghost" onClick={(event) => void requestHistory("undo", event.currentTarget)} disabled={controlsLocked || historyInteractionLocked || localHistory.undoCount < 1}>Undo</button>
            <button type="button" className="ts-button ts-button--ghost" onClick={(event) => void requestHistory("redo", event.currentTarget)} disabled={controlsLocked || historyInteractionLocked || localHistory.redoCount < 1}>Redo</button>
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
              className={`ts-chip ${dirty ? "ts-chip--edited" : "ts-chip--unchanged"}`}
              data-testid="work-state"
              data-work-state={dirty ? "edited" : "unchanged"}
            >
              {workStateLabel(dirty)}
            </span>
          </span>
          <span className="ts-status-pair">
            <span className="ts-status-label">Values:</span>
            <span className={`ts-chip ts-chip--${currentness}`} data-testid="currentness" data-currentness={currentness}>
            {currentnessLabel(currentness, resultsNeedAttention)}
            </span>
          </span>
          {currentness === "pending" && j4Results.length > 0 ? <span className="ts-notice" role="status">Updating… — showing previous results.</span> : null}
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
    return (
      <div role="tabpanel" id={panelId("table")} aria-labelledby={tabId("table")} className="ts-panel">
        {currentness === "current" ? null : <p className="ts-notice">{freshnessNotice(currentness)}</p>}
        <div className="ts-grid-scroll" ref={gridScrollRef}>
          <table className="ts-grid" role="grid" aria-label="Table" aria-busy={busy}>
            <thead>
              <tr>
                <th scope="col" className="ts-gutter-head">
                  Row
                </th>
                {columns.map((column) => (
                  <th key={column.id} scope="col" className="ts-col-head">
                    {column.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => {
                const entity = rowEntity(row);
                const isSelectedRow = entity === selectedEntity;
                return (
                  <tr key={row.id || entity} className={isSelectedRow ? "ts-row ts-row--selected" : "ts-row"}>
                    <th scope="row" className="ts-row-head">
                      {table.rows.indexOf(row) + 1}
                    </th>
                    {columns.map((column) => renderCell(row, entity, column))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderCell(row: TableRow, entity: string, column: TableColumn): ReactNode {
    if (!view) return null;
    const field = fieldForColumn(row, column.id);
    const display = fieldDisplay(field);
    const key = cellKey(entity, column.id);
    const editing = editor !== null && editor.entity === entity && editor.field === column.id;
    const editable = Boolean(field?.editable_scalar) && !controlsLocked;
    const classes = ["ts-cell", `ts-cell--${display.tone}`];
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
        data-work-occurrence={view.occurrence}
        data-work-revision={view.revision}
        data-work-entity={entity}
        data-work-currentness={currentness}
        tabIndex={focusedKey === key || (!focusedKey && isFirstCell(entity, column)) ? 0 : -1}
        aria-selected={entity === selectedEntity}
        aria-readonly={!editable}
        title={display.title ?? undefined}
        onClick={() => setSelectedEntity(entity)}
        onDoubleClick={() => beginEdit(entity, field)}
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
            aria-busy={commitPending}
            data-testid="cell-editor"
            disabled={controlsLocked}
            value={editor.value}
            ref={focusEditorInput}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setLocalError(null);
              setEditor((previous) => (previous ? { ...previous, value } : previous));
            }}
            onKeyDown={onEditorKeyDown}
          />
        ) : (
          <span className="ts-cell-value">{display.text}</span>
        )}
      </td>
    );
  }

  function isFirstCell(entity: string, column: TableColumn): boolean {
    if (!table) return false;
    const firstRow = table.rows[0];
    if (!firstRow) return false;
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
              aria-describedby={notesEditable ? undefined : `${notesId}-hint`}
              onChange={(event) => {
                setLocalError(null);
                if (view && selectedRow) {
                  const draft = {
                    occurrence: view.occurrence,
                    revision: view.revision,
                    entity: rowEntity(selectedRow),
                    value: event.currentTarget.value,
                  };
                  setNotesDrafts((drafts) => {
                    const remaining = drafts.filter(
                      (candidate) =>
                        candidate.occurrence !== draft.occurrence || candidate.entity !== draft.entity,
                    );
                    return draft.value === notesCommitted ? remaining : [...remaining, draft];
                  });
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
              <span className="ts-hint">{notesDirty ? "Unapplied notes draft" : "No unapplied notes"}</span>
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
      <section className="ts-interop-section" aria-label="Source fidelity ledger">
        <h3 className="ts-content-heading">Source fidelity ledger</h3>
        {interop?.ledger.length ? <ul className="ts-ledger">{interop.ledger.map((finding, index) => <li key={`${finding.code}-${index}`}><strong>{finding.category}</strong>: {finding.message}</li>)}</ul> : <p className="ts-empty">No imported-source ledger is available for this work.</p>}
      </section>
      <section className="ts-interop-section" aria-label="Cleanup preview">
        <h3 className="ts-content-heading">Cleanup</h3>
        <p className="ts-subtle">Previews are produced by the core kit. Nothing changes until you commit this exact preview.</p>
        <div className="ts-row-actions">
          <button type="button" className="ts-button" disabled={controlsLocked || allFields.length === 0} onClick={() => witness && void onPreviewTrim(witness, allFields)}>Preview trim</button>
          <button type="button" className="ts-button" disabled={controlsLocked || entities.length < 2 || keyFields.length === 0} onClick={() => witness && void onPreviewDeduplicate(witness, entities, keyFields)}>Preview whole-row deduplication</button>
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
                    <td>{`Row ${row + 1}, ${column?.key ?? change.target.field}`}</td>
                  </tr>;
                })}</tbody>
              </table>
            ) : null}
            <div className="ts-row-actions">
              <button type="button" className="ts-button" onClick={onCancelCleanup}>Cancel preview</button>
              <button type="button" className="ts-button ts-button--primary" disabled={controlsLocked || !witness} onClick={() => witness && void onCommitCleanup(witness, preview.preview_id)}>Commit preview</button>
            </div>
          </div>
        ) : null}
      </section>
      <section className="ts-interop-section" aria-label="Download spreadsheet">
        <h3 className="ts-content-heading">Download</h3>
        <p className="ts-subtle">Exports use the imported source metadata and the current core revision. Review the ledger before downloading.</p>
        <div className="ts-row-actions">
          <button type="button" className="ts-button" disabled={controlsLocked || !interop?.metadata} onClick={(event) => void prepareDownload("csv", event.currentTarget)}>Prepare CSV</button>
          <button type="button" className="ts-button" disabled={controlsLocked || !interop?.metadata} onClick={(event) => void prepareDownload("xlsx", event.currentTarget)}>Prepare XLSX</button>
        </div>
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
    const selector = (label: string, key: keyof KeyedGroupedSumBindingChoice, values: Array<{ key: string }>) => (
      <div className="ts-summary-field"><label className="ts-field-label" htmlFor={`j4-${key}`}>{label}</label>
      <select id={`j4-${key}`} value={j4Binding?.[key] ?? ""} onChange={(event) => choose(key, event.currentTarget.value)} disabled={controlsLocked || j4Pending}>
        <option value="">Choose a field</option>
        {values.map((value) => <option key={value.key} value={value.key}>{value.key}</option>)}
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
      <section className={hasConfiguredSummary ? "ts-summary-binding" : "ts-card"} aria-label="Cross-table summary binding">
        <h2 className={hasConfiguredSummary ? "ts-content-heading" : "ts-h2"}>Cross-table summary</h2>
        <p className="ts-subtle">Choose visible table and field names. The core binds their stable identities and remains the only calculator.</p>
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
          <p className="ts-hint">Creating this summary uses the core’s format-2 project representation. Canonical and portable v1 exits remain unsupported for definition-bearing work.</p>
          <button type="button" className="ts-button ts-button--primary" onClick={() => void create()} disabled={controlsLocked || j4Pending || !bindingReady}>{j4Pending ? "Creating…" : "Create cross-table summary"}</button>
        </>}
      </section>
      <section className={hasConfiguredSummary ? "ts-summary-result" : "ts-card"} aria-label="Cross-table summary result">
        <h2 className={hasConfiguredSummary ? "ts-content-heading" : "ts-h2"}>{hasConfiguredSummary
          ? currentness === "pending" ? "Previous grouped result" : resultsNeedAttention ? "Grouped results need attention" : "Current grouped result"
          : "Authoritative result"}</h2>
        {resultsNeedAttention && currentness === "current" ? <p className="ts-notice" role="status">Some results need attention. Check the affected summaries.</p> : null}
        {j4Results.length === 0 && j4DefinitionIds.length === 0 ? <p className="ts-empty">No current cross-table result is available. Create a summary after choosing its fields.</p> : null}
        {j4Results.map((result, index) => <div key={result.definitionId} className="ts-preview" data-testid={`j4-result-${index}`}>
          {result.diagnostics.length > 0 ? <><p role="status">{currentness === "pending" ? "This previous result has source issues. Its values are hidden while results update." : "The core reported diagnostics; no group values are shown."}</p><ul className="ts-ledger" aria-label="Cross-table diagnostics">{result.diagnostics.map((diagnostic, diagnosticIndex) => <li key={`${diagnostic.code}-${diagnosticIndex}`}>{diagnostic.code}: {diagnostic.lookup_key ?? "(no lookup key)"}</li>)}</ul></> : <>
            <p className="ts-content-meta">{currentness === "pending" ? "Previous result" : resultsNeedAttention ? "Current result" : "Complete result"} · {result.groups.length} groups{resultsNeedAttention || currentness === "pending" ? "" : ` · ${currentness === "current" && result.revision === view.revision ? "up to date" : freshnessNotice(currentness)}`}</p>
            <table className="ts-summary-groups" aria-label="Cross-table groups">
              <thead><tr><th scope="col">Product</th><th scope="col">Value</th></tr></thead>
              <tbody>{result.groups.map((group) => <tr key={group.category}><td>{group.category}</td><td>{group.value}</td></tr>)}</tbody>
            </table>
            <div className="ts-row-actions ts-summary-actions"><button type="button" className="ts-button ts-button--primary" onClick={() => createReportFromSummary(result.definitionId, "bar")} disabled={controlsLocked}>Create bar report</button><button type="button" className="ts-button" onClick={() => createReportFromSummary(result.definitionId, "line")} disabled={controlsLocked}>Create line report</button><button type="button" className="ts-button" onClick={() => void onRefreshJ4(liveWitness, result.definitionId)} disabled={controlsLocked || j4Pending}>Refresh core result</button></div>
          </>}
          {result.diagnostics.length > 0 ? <button type="button" className="ts-button" onClick={() => void onRefreshJ4(liveWitness, result.definitionId)} disabled={controlsLocked || j4Pending}>Refresh core result</button> : null}
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
      try {
        const href = canvas.toDataURL("image/png");
        if (href === "data:," || !href.startsWith("data:image/png;base64,")) throw new Error("PNG encoding failed.");
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = "tachiko-sheet-report.png";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } catch {
        setLocalError("The current report image could not be encoded, so no PNG was downloaded.");
      }
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
              <div className="ts-report-currentness"><dt>Currentness</dt><dd>{currentness === "current" && result.revision === view.revision ? "up to date" : freshnessNotice(currentness)}</dd></div>
            </dl>
            <p className="ts-subtle ts-report-output-note">This {report.type} report renders the complete current core group result. It does not calculate or persist group values.</p>
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
            <select id="ts-active-table" value={view.table.collection.key} onChange={(event) => void selectCollection(event.currentTarget.value)} disabled={controlsLocked || cellDraftActive}>
              {view.collections.map((collection) => <option key={collection.key} value={collection.key}>{collection.key}</option>)}
            </select>
          </div>
        </nav>
        {controlsLocked ? (
          <p className="ts-hint" id={lockNoteId} role="note">
            An operation is in progress; editing is disabled until it finishes.
          </p>
        ) : null}
        <footer className="ts-workspace-footer">
          <div className="ts-tabs" role="tablist" aria-label="Workbook views" onKeyDown={onTabListKeyDown}>
            <span className="ts-views-label" aria-hidden="true">Views</span>
            <button
            type="button"
            role="tab"
            id={tabId("table")}
            aria-selected={tab === "table"}
            aria-controls={panelId("table")}
            tabIndex={tab === "table" ? 0 : -1}
            className={tab === "table" ? "ts-tab ts-tab--active" : "ts-tab"}
            onClick={() => selectTab("table")}
          >
            Table
            </button>
            <button type="button" role="tab" id={tabId("summary")} aria-selected={tab === "summary"} aria-controls={panelId("summary")} tabIndex={tab === "summary" ? 0 : -1} className={tab === "summary" ? "ts-tab ts-tab--active" : "ts-tab"} onClick={() => selectTab("summary")}>Cross-table summary</button>
            <button type="button" role="tab" id={tabId("report")} aria-selected={tab === "report"} aria-controls={panelId("report")} tabIndex={tab === "report" ? 0 : -1} className={tab === "report" ? "ts-tab ts-tab--active" : "ts-tab"} onClick={() => selectTab("report")}>Report</button>
            <button
            type="button"
            role="tab"
            id={tabId("brief")}
            aria-selected={tab === "brief"}
            aria-controls={panelId("brief")}
            tabIndex={tab === "brief" ? 0 : -1}
            className={tab === "brief" ? "ts-tab ts-tab--active" : "ts-tab"}
            onClick={() => selectTab("brief")}
          >
            Brief
            </button>
            <button type="button" role="tab" id={tabId("interop")} aria-selected={tab === "interop"} aria-controls={panelId("interop")} tabIndex={tab === "interop" ? 0 : -1} className={tab === "interop" ? "ts-tab ts-tab--active" : "ts-tab"} onClick={() => selectTab("interop")}>Import & export</button>
          </div>
          <div className="ts-workbook-status">{renderStatusStrip()}</div>
        </footer>
        {tab === "table" ? renderTablePanel() : tab === "summary" ? renderSummaryPanel() : tab === "report" ? renderReportPanel() : tab === "brief" ? renderBriefPanel() : renderInteropPanel()}
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

  return (
    <div
      ref={shellRef}
      className="ts-app"
      data-view={view ? "workbook" : "home"}
      onCompositionStartCapture={beginAppearanceComposition}
      onCompositionEndCapture={scheduleAppearanceCompositionEnd}
      onFocusCapture={(event) => {
        const request = historyFocusRequestRef.current;
        const destination = event.target;
        if (!request || request.settled || !(destination instanceof HTMLElement) || destination === request.initiator) return;
        if (!historyFocusDestinationIsUsable(destination, shellRef.current)) return;
        const updated = { ...request, userDestination: destination };
        historyFocusRequestRef.current = updated;
        setHistoryFocusRequest(updated);
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
      {errorMessage && !copyErrorIsInline && !importErrorIsInline && !downloadErrorIsInline ? (
        <div className="ts-error" role="alert">
          {errorMessage}
        </div>
      ) : null}
      {view ? renderWorkbook() : renderHome()}
      {copyOpen ? (
        <Modal variant="save" label="Save a copy" onCancel={closeCopyDialog} dismissDisabled={copyPending}>
          <div className="ts-dialog-intro">
            <h2 className="ts-h2">Save a copy</h2>
            <p className="ts-subtle">Creates a new copy in this browser profile.<br />It does not update an existing one.</p>
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
              disabled={copyPending || copyName.trim() === "" || hasInvalidReportDraft}
              aria-busy={copyPending}
            >
              {copyPending ? "Working…" : "Create copy"}
            </button>
          </div>
        </Modal>
      ) : null}
      {interop?.importInspection ? (
        <Modal variant="import" label="Review import candidate" onCancel={cancelImport} dismissDisabled={importPending}>
          <div className="ts-dialog-intro">
            <h2
              ref={importPendingFocusRef}
              className="ts-h2"
              tabIndex={interop.importInspection.source.ledger.length || importPending || Boolean(importError) ? 0 : -1}
              data-autofocus={interop.importInspection.source.ledger.length ? "true" : undefined}
            >Review import candidate</h2>
            <p className="ts-subtle">{interop.importInspection.name}: {interop.importInspection.source.sheets.length} sheet(s). Each column is imported as Text; recognition is advisory and does not change stored values.</p>
          </div>
          <div className="ts-dialog-scroll">
            {interop.importInspection.source.ledger.length ? <ul className="ts-ledger" aria-label="Candidate source fidelity ledger">{interop.importInspection.source.ledger.map((finding, index) => <li key={`${finding.code}-${index}`}>{finding.location}: {finding.message}</li>)}</ul> : <p className="ts-hint ts-dialog-success">No source-fidelity findings were reported for this candidate.</p>}
            <div className="ts-import-columns">{interop.importInspection.source.sheets.map((sheet, sheetIndex) => <section key={sheet.name}><h3 className="ts-h2">{sheet.name}</h3>{sheet.columns.map((column, columnIndex) => <label className="ts-import-column" key={column.name}>{column.name}<select value={importTypes[sheetIndex]?.[columnIndex] ?? "text"} disabled={importPending} onChange={(event) => { const nextType = event.currentTarget.value; setImportTypes((current) => current.map((types, index) => index !== sheetIndex ? types : types.map((type, index2) => index2 === columnIndex ? nextType : type))); }}><option value="text">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="date">Date</option></select></label>)}</section>)}</div>
          </div>
          {importErrorMessage ? <p className="ts-dialog-error ts-dialog-error--import" role="alert">{importErrorMessage}</p> : null}
          <div className="ts-dialog-actions"><button type="button" className="ts-button" onClick={cancelImport} disabled={importPending}>Cancel</button><button ref={importRetryButtonRef} type="button" className="ts-button ts-button--primary" data-autofocus={interop.importInspection.source.ledger.length ? undefined : "true"} onClick={() => void importCandidate()} disabled={controlsLocked || importPending} aria-busy={importPending}>Import candidate</button></div>
        </Modal>
      ) : null}
      {downloadFormat ? <Modal variant="review" label="Confirm download" onCancel={cancelDownload}><div className="ts-dialog-intro"><h2 className="ts-h2" tabIndex={0} data-autofocus="true">Review and download {downloadFormat.toUpperCase()}</h2><p>The actual exporter produced this revision. Review its source-fidelity ledger before consenting to the browser download.</p></div><div className="ts-dialog-scroll">{interop?.ledger.length ? <ul className="ts-ledger" aria-label="Export fidelity ledger">{interop.ledger.map((finding, index) => <li key={`${finding.code}-${index}`}><strong>{finding.category}</strong>: {finding.message}</li>)}</ul> : <p className="ts-hint ts-dialog-success">The exporter reported no fidelity findings for this output.</p>}</div><div className="ts-dialog-actions"><button type="button" className="ts-button" onClick={cancelDownload}>Cancel</button><button type="button" className="ts-button ts-button--primary" onClick={() => { void onDownload(downloadFormat).then(() => cancelDownload(), () => cancelDownload()); }}>Download</button></div></Modal> : null}
      {closeOpen ? (
        <Modal variant="close" label="Unsaved work" onCancel={keepEditing}>
          <div className="ts-dialog-intro">
            <h2 className="ts-h2">Unsaved work</h2>
            <p>This work has changes that are not saved. Keep editing to return to the sheet, or close without saving.</p>
          </div>
          <div className="ts-dialog-actions">
            <button type="button" className="ts-button" data-autofocus="true" onClick={keepEditing}>
              Keep editing
            </button>
            <button type="button" className="ts-button ts-button--danger" onClick={() => void closeWork()}>
              Close without saving
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Modal({ label, onCancel, children, variant = "review", dismissDisabled = false }: { label: string; onCancel: () => void; children: ReactNode; variant?: "save" | "close" | "import" | "review"; dismissDisabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const target =
      root.querySelector<HTMLElement>("[data-autofocus]") ?? focusableElements(root)[0] ?? null;
    target?.focus();
  }, []);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!dismissDisabled) onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const root = ref.current;
    if (!root) return;
    const nodes = focusableElements(root);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    const active = root.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="ts-modal-backdrop"
      onMouseDown={(event) => {
        if (!dismissDisabled && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={ref}
        className={`ts-modal ts-modal--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ),
  );
}

function isComposingEvent(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const native = event.nativeEvent as KeyboardEvent;
  return native.isComposing === true || native.keyCode === 229;
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

function explain(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return `${fallback} (${error.message})`;
  return fallback;
}
