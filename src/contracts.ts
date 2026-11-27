import type { OpenedFile } from "./host/opened-file";
import type {
  CanonicalProjectFile,
  CanonicalTreeExport,
  CollectionSummary,
  FieldBatchProjection,
  FieldTarget,
  PasteCellInput,
  PublicationProjection,
  TableProjection,
} from "../public/core-kit/experimental-client.js";
import type { CellStyleChange, A1Geometry, CapacityProjection, SelectionStatisticsProjection, SelectionStatisticsRange, ColumnTotalsProjection, DistinctValuesProjection, FieldConstraintInput, FormulaCopy, GroupDimension, GroupScope, KeyedGroupedSumProjection, NameFailure, DateFormat, NumberFormat, CellAlignment } from "../public/core-kit/runtime/protocol.js";
import type { A1TranslationOutcome, GroupTotalsOutcome } from "./runtime/session.js";
import type {
  CleanupOperation,
  CleanupPreview,
  FidelityFinding,
  ImportOptions,
  ImportSelection,
  InteropMetadata,
  SourceWorkbook,
  SpreadsheetExport,
  SpreadsheetFormat,
} from "../public/core-kit/runtime/interop-protocol.js";
import type { AppearancePreferenceController } from "./application/appearance-preference.js";
import type { LocalHistorySnapshot, ViewHistoryChange } from "./application/local-history.js";
import type { CsvDelimiter, CsvEncoding } from "./ui/csv-text.js";
import type { TemplateId } from "./ui/templates.js";
export type {
  CleanupOperation,
  CleanupPreview,
  FidelityFinding,
  ImportOptions,
  ImportSelection,
  InteropMetadata,
  SourceWorkbook,
  SpreadsheetExport,
  SpreadsheetFormat,
} from "../public/core-kit/runtime/interop-protocol.js";

export type { CanonicalProjectFile, CanonicalTreeExport, FieldTarget, PasteCellInput };
export type CoreKit = typeof import("../public/core-kit/experimental-client.js");
export type KitLoader = () => Promise<CoreKit>;

// Work d60fc65b: crates/storage/src/portable_package/v1.rs:41
// PORTABLE_PACKAGE_V1_MAX_ARCHIVE_BYTES (also enforced at :1028).
// The pinned browser kit does not export this constant.
export const WORK_FILE_MAX_BYTES = 64 * 1024 * 1024;

export function requireWorkFileSize(size: number): void {
  if (size > WORK_FILE_MAX_BYTES) {
    throw new Error(`portable_package.resource_limit: archive bytes limit is ${WORK_FILE_MAX_BYTES}, found ${size}`);
  }
}

/** Disposable, coherent projections from one actual core occurrence/revision. */
export interface WorkbookView {
  /** Work-issued imported mapping, read at this revision. */
  importMetadata?: InteropMetadata;
  title: string;
  /** Ephemeral admission evidence, set only by the Work portable-file entry. */
  openedFromWorkFile?: boolean;
  /** New-table admission or confirmed typed export evidence requires Work's v3 writer. */
  requiresPortableSave?: boolean;
  occurrence: string;
  revision: string;
  collections: CollectionSummary[];
  table: TableProjection;
}
export interface ViewWitness { occurrence: string; revision: string }
export type CellStyleRows = { row: number; rowCount: number } | { entities: string[] };

/** Entity identity of one projected row: the FieldTarget identity the grid and test markers use. */
export function rowEntity(row: WorkbookView["table"]["rows"][number]): string {
  return row.fields[0]?.target.entity ?? row.id;
}
/** A typed scalar value. Only onCommit may carry a Work formula alongside these. */
export type ScalarValueEdit =
  | { kind: "auto"; input: string }
  | { kind: "number"; input: string }
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "date"; value: string };
export type ScalarEdit =
  | ScalarValueEdit
  /** Work owns the formula grammar; Sheet forwards the source unchanged. */
  | { kind: "formula"; source: string };

export type NewTableColumn = { name: string; field_type: "text" | "number" | "date" | "boolean"; required?: boolean };
export type ColumnInitializer = { entity: string; input: ScalarValueEdit };
/** Cell and row payloads are tracker scalars; formula text never rides them. */
export type CellEdit = { target: FieldTarget; input: ScalarValueEdit | { kind: "clear" } };
export type CellMove = { from: FieldTarget; to: FieldTarget };
export type RowInitializer = { field: string; input: ScalarValueEdit };
/** Refusals retain the draft; recovery must never replay a dispatched command. */
export type RowCommandOutcome =
  | { kind: "confirmed"; addedEntities?: readonly string[] }
  | { kind: "refused"; message: string; fieldType?: string; refusalCode?: string; blankCount?: number; nameFailures?: readonly NameFailure[] }
  | { kind: "recovery" };

/** The A1 text Work translates, its target cell and the grid geometry it reads addresses against. */
export interface A1TranslationRequest {
  collectionId: string;
  rowEntityId: string;
  targetFieldId: string;
  text: string;
  geometry: A1Geometry;
}

export interface SheetRuntime {
  /** Transport budget of the acknowledged ordinary or working-size admission. */
  readonly requestByteLimit: number;
  /** Read-only, cached client/kit readiness; never opens or creates work. */
  prepare(): Promise<void>;
  newTable(name: string, columns: NewTableColumn[]): Promise<WorkbookView>;
  newBlankWorkbook(): Promise<WorkbookView>;
  writeCellAt(witness: ViewWitness, collection: string, row: number, column: number, input: string | ScalarValueEdit): Promise<ConfirmedPublication>;
  addTable(witness: ViewWitness, name: string, columns: NewTableColumn[]): Promise<ConfirmedPublication>;
  insertRow(witness: ViewWitness, collection: string, initializers: RowInitializer[], before?: string, count?: number): Promise<ConfirmedPublication>;
  editCells(witness: ViewWitness, edits: CellEdit[]): Promise<ConfirmedPublication>;
  moveCells(witness: ViewWitness, moves: CellMove[]): Promise<ConfirmedPublication>;
  pasteCells(witness: ViewWitness, collection: string, startEntity: string | null, startField: string, rows: PasteCellInput[][]): Promise<ConfirmedPublication>;
  pasteCellsAt(witness: ViewWitness, collection: string, row: number, column: number, rows: PasteCellInput[][]): Promise<ConfirmedPublication>;
  addColumn(witness: ViewWitness, collection: string, name: string, fieldType: NewTableColumn["field_type"], initializers: ColumnInitializer[] | undefined, required?: boolean): Promise<ConfirmedPublication>;
  setColumnRequiredness(witness: ViewWitness, collection: string, field: string, required: boolean): Promise<ConfirmedPublication>;
  setColumnConstraint(witness: ViewWitness, collection: string, field: string, constraint: FieldConstraintInput): Promise<ConfirmedPublication>;
  /** Read Work's capacity accounting for a revision; null when the kit lacks the capability. */
  queryCapacity(expectedRevision?: string): Promise<CapacityProjection | null>;
  setColumnWidth(witness: ViewWitness, collection: string, field: string, width: number | null): Promise<ConfirmedPublication>;
  setTableVisibility(witness: ViewWitness, collection: string, entities: string[], fields: string[], hidden: boolean): Promise<ConfirmedPublication>;
  setCellStyle(witness: ViewWitness, collection: string, rows: CellStyleRows, fields: string[], changes: CellStyleChange[]): Promise<ConfirmedPublication>;
  setColumnAlignment(witness: ViewWitness, collection: string, field: string, alignment: CellAlignment | null): Promise<ConfirmedPublication>;
  setColumnDateFormat(witness: ViewWitness, collection: string, field: string, format: DateFormat | null): Promise<ConfirmedPublication>;
  setColumnNumberFormat(witness: ViewWitness, collection: string, field: string, format: NumberFormat | null): Promise<ConfirmedPublication>;
  copyFormula(witness: ViewWitness, request: FormulaCopy): Promise<ConfirmedPublication>;
  renameTable(witness: ViewWitness, collection: string, name: string): Promise<ConfirmedPublication>;
  deleteTable(witness: ViewWitness, collection: string): Promise<ConfirmedPublication>;
  renameColumn(witness: ViewWitness, collection: string, field: string, name: string): Promise<ConfirmedPublication>;
  removeColumn(witness: ViewWitness, collection: string, field: string): Promise<ConfirmedPublication>;
  /** Move a column to a zero-based position in Work's projected column order. */
  moveColumn(witness: ViewWitness, collection: string, field: string, toIndex: number): Promise<ConfirmedPublication>;
  removeRows(witness: ViewWitness, collection: string, entities: string[]): Promise<ConfirmedPublication>;
  /** `columnNames` names the copy's columns by source field id (imported headings Work does not hold). */
  moveCollection(witness: ViewWitness, collection: string, toIndex: number): Promise<ConfirmedPublication>;
  duplicateCollection(witness: ViewWitness, collection: string, name: string, columnNames?: Record<string, string>, toIndex?: number): Promise<ConfirmedPublication>;
  /** Work's Number totals over exactly these entities; null when the kit lacks it or the revision moved. */
  querySelectionStatistics(witness: ViewWitness, selection: FieldTarget[] | SelectionStatisticsRange): Promise<SelectionStatisticsProjection | "too-large" | null>;
  queryColumnTotals(witness: ViewWitness, collection: string, entities: string[]): Promise<ColumnTotalsProjection | null>;
  /** Work's distinct column texts; null when unavailable or the revision moved. */
  queryDistinctValues(witness: ViewWitness, collection: string, field: string): Promise<DistinctValuesProjection | null>;
  /** Work's grouped Number totals over one scope; null when the kit lacks it or the revision moved. */
  queryGroupTotals(witness: ViewWitness, collection: string, dimensions: GroupDimension[], measures: string[], scope: GroupScope): Promise<GroupTotalsOutcome | null>;
  /** Work's read-only Excel A1 translation; null when the kit lacks it or the revision moved. */
  translateA1Formula(witness: ViewWitness, input: A1TranslationRequest): Promise<A1TranslationOutcome | null>;
  openFiles(files: FileList): Promise<WorkbookView>;
  openCanonical(files: readonly CanonicalProjectFile[], importedMetadata?: InteropMetadata): Promise<WorkbookView>;
  /**
   * Opens an unparsed core-produced format-2 export. When it descends from an
   * imported source, the public kit first validates the retained producer
   * metadata; no client codec is involved.
   */
  openOpaque(bytes: ArrayBuffer, importedMetadata?: InteropMetadata): Promise<WorkbookView>;
  openWorkFile(bytes: ArrayBuffer, importedMetadata?: InteropMetadata): Promise<WorkbookView>;
  exportWorkFile(witness: ViewWitness, metadata?: InteropMetadata): Promise<OpaqueProjectExport>;
  read(): Promise<WorkbookView>;
  selectCollection(witness: ViewWitness, collection: string): Promise<WorkbookView>;
  readFields(witness: ViewWitness, targets: FieldTarget[]): Promise<FieldBatchProjection>;
  edit(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<WorkbookView>;
  editConfirmed(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<ConfirmedPublication>;
  trackerHistory(witness: ViewWitness, direction: "undo" | "redo"): Promise<ConfirmedPublication>;
  exportCanonical(witness: ViewWitness): Promise<CanonicalTreeExport>;
  exportOpaque(witness: ViewWitness, metadata?: InteropMetadata): Promise<OpaqueProjectExport>;
  listKeyedGroupedSumBindings(witness: ViewWitness): Promise<KeyedGroupedSumBindingCatalog>;
  createKeyedGroupedSum(witness: ViewWitness, binding: KeyedGroupedSumBindingChoice): Promise<KeyedGroupedSumResult & { publication: PublicationProjection }>;
  queryKeyedGroupedSum(witness: ViewWitness, definitionId: string): Promise<KeyedGroupedSumResult>;
  discoverKeyedGroupedSums(witness: ViewWitness): Promise<KeyedGroupedSumResult[]>;
  /** The public kit parses all spreadsheet bytes; Sheet retains no parser. */
  inspectSpreadsheet(bytes: ArrayBuffer, format: SpreadsheetFormat, options: ImportOptions): Promise<SourceWorkbook>;
  importSpreadsheet(bytes: ArrayBuffer, format: SpreadsheetFormat, options: ImportOptions, selection: ImportSelection): Promise<ImportedWorkbook>;
  previewCleanup(witness: ViewWitness, operation: CleanupOperation): Promise<CleanupPreview>;
  commitCleanup(witness: ViewWitness, previewId: string): Promise<ConfirmedPublication>;
  exportSpreadsheet(witness: ViewWitness, metadata: InteropMetadata, format: SpreadsheetFormat): Promise<SpreadsheetExport>;
  exportNativeTables(witness: ViewWitness, collection: string, format: SpreadsheetFormat): Promise<SpreadsheetExport>;
  validateImportedProject(files: readonly CanonicalProjectFile[], metadata: InteropMetadata): Promise<void>;
  close(): Promise<void>;
}

/** Private runtime evidence for a publication whose replacement view was read coherently. */
export interface ConfirmedPublication {
  view: WorkbookView;
  publication: import("../public/core-kit/experimental-client.js").PublicationProjection;
}

export interface ImportedWorkbook {
  view: WorkbookView;
  metadata: InteropMetadata;
  ledger: FidelityFinding[];
}

export type SavedCopyKind = "canonical" | "opaque" | "work-file";
export interface SavedCopySummary { name: string; savedAt: string; kind?: SavedCopyKind; saveToken?: string }
export interface SavedCopy {
  name: string;
  savedAt: string;
  /** Private local-save witness; absent on legacy records. */
  saveToken?: string;
  /** Legacy canonical records predate the discriminator and are inferred as canonical. */
  kind?: "canonical";
  revision: string;
  files: CanonicalProjectFile[];
  importedSource?: ImportedSourceAttachment;
}
/** A private, unparsed core-project export (format version 2). */
export type ImportOrigin = "xlsx" | "csv" | "native" | "imported";
export interface ImportCompanion { snapshotDigest: string; metadata: InteropMetadata; origin?: ImportOrigin }

export interface OpaqueSavedCopy extends SavedCopySummary {
  importCompanion?: ImportCompanion;
  kind: "opaque";
  formatVersion: 2;
  revision: string;
  bytes: ArrayBuffer;
  /** Optional host-private source attachment; never part of the opaque bytes. */
  importedSource?: ImportedSourceAttachment;
  /** Optional host-private report configuration; never part of the opaque bytes. */
  presentation?: PresentationAttachment;
}
/** Private local carrier for unchanged Work portable-package bytes. */
export interface WorkFileSavedCopy extends Omit<OpaqueSavedCopy, "kind" | "formatVersion"> {
  kind: "work-file";
  formatVersion: 1;
}
export type AnySavedCopy = SavedCopy | OpaqueSavedCopy | WorkFileSavedCopy;
export interface OpaqueProjectExport {
  importMetadata?: InteropMetadata;
  importCompanion?: ImportCompanion;
  revision: string;
  bytes: ArrayBuffer;
  importedSource?: ImportedSourceAttachment;
  /** Optional host-private report configuration paired to this exact snapshot. */
  presentation?: PresentationAttachment;
}
/** Visible selection vocabulary only. Runtime resolves these names to stable core IDs at dispatch. */
export interface KeyedGroupedSumBindingCatalog {
  collections: Array<{
    id: string;
    key: string;
    displayName?: string;
    fields: Array<{ id: string; key: string; displayName: string; displayNameExplicit: boolean; fieldType: string }>;
  }>;
}

/** True only when an authoritative schema catalog contains a Date field. */
export function bindingCatalogContainsDate(catalog: KeyedGroupedSumBindingCatalog): boolean {
  return catalog.collections.some((collection) =>
    collection.fields.some((field) => field.fieldType === "date"),
  );
}

export const DATE_SUMMARY_UNSUPPORTED_MESSAGE =
  "Cross-table summaries cannot be created while any table contains a Date column.";

export interface KeyedGroupedSumBindingChoice {
  ordersCollection: string;
  orderLookupKeyField: string;
  orderQuantityField: string;
  productsCollection: string;
  productKeyField: string;
  productCategoryField: string;
  productPriceField: string;
}
/** Result of the one explicit Home-to-Sales setup action. */
export type SalesEntryOutcome =
  | { kind: "confirmed"; occurrence: string; revision: string; definitionId: string }
  | { kind: "refused"; message: string }
  | { kind: "startup-unavailable" }
  | { kind: "acknowledged-open-recovery" }
  | { kind: "unknown-open-recovery" }
  | { kind: "published-recovery" }
  | { kind: "unknown-recovery" }
  | { kind: "reload-required"; message: string };
export interface SalesEntryTipMarker {
  occurrence: string;
  collection: string;
  field: string;
}
/** UI-only compact landing evidence for the active Catalog projection. */
export interface SalesCatalogLayoutMarker {
  occurrence: string;
  collectionId: string;
}
/** Disposable, revision-scoped core output. IDs are retained only for re-query, never requested from users. */
export interface KeyedGroupedSumResult {
  definitionId: string;
  revision: string;
  groups: KeyedGroupedSumProjection["groups"];
  diagnostics: KeyedGroupedSumProjection["diagnostics"];
}
/** Bounded UI configuration. It never contains groups, totals, currentness, or rendered pixels. */
export interface ReportConfiguration {
  definitionId: string;
  type: "bar" | "line";
  title: string;
  categoryLabel: string;
  valueLabel: string;
  legendVisible: boolean;
}

export const REPORT_PRESENTATION_TEXT_LIMITS = {
  title: 120,
  categoryLabel: 80,
  valueLabel: 80,
} as const;

export type ReportPresentationTextField = keyof typeof REPORT_PRESENTATION_TEXT_LIMITS;

/** These bounds are host-private presentation limits, never core-group limits. */
export function reportPresentationTextLimitViolation(
  field: ReportPresentationTextField,
  text: string,
): { limit: number; length: number } | null {
  const length = Array.from(text).length;
  const limit = REPORT_PRESENTATION_TEXT_LIMITS[field];
  return length <= limit ? null : { limit, length };
}

export function reportPresentationLimitViolation(
  report: Pick<ReportConfiguration, ReportPresentationTextField>,
): { field: ReportPresentationTextField; limit: number; length: number } | null {
  for (const field of Object.keys(REPORT_PRESENTATION_TEXT_LIMITS) as ReportPresentationTextField[]) {
    const violation = reportPresentationTextLimitViolation(field, report[field]);
    if (violation) return { field, ...violation };
  }
  return null;
}
/** Private host record paired to an opaque core snapshot, not a project codec extension. */
export interface PresentationAttachment {
  version: 1;
  report: ReportConfiguration;
  snapshotRevision: string;
  snapshotDigest: string;
}
/** Host-private attachment: deliberately outside the opaque canonical tree. */
export interface ImportedSourceAttachment {
  name: string;
  format: SpreadsheetFormat;
  bytes: ArrayBuffer;
  metadata: InteropMetadata;
  ledger: FidelityFinding[];
}
export interface SaveReceipt extends SavedCopySummary { revision: string }
export interface LocalCopies {
  list(): Promise<SavedCopySummary[]>;
  read(name: string): Promise<SavedCopy | null>;
  /** Discriminated read for callers that support both canonical and opaque copies. */
  readAny(name: string): Promise<AnySavedCopy | null>;
  create(name: string, snapshot: CanonicalTreeExport, importedSource?: ImportedSourceAttachment): Promise<SaveReceipt>;
  createOpaque(name: string, snapshot: OpaqueProjectExport): Promise<SaveReceipt>;
  /** Optional writer capability; compatible readers remain available without it. */
  createWorkFile?(name: string, snapshot: OpaqueProjectExport): Promise<SaveReceipt>;
  /** Compare the last-read/written token (or exact legacy read) inside the replace transaction. */
  replace?(expected: SavedCopySummary, snapshot: CanonicalTreeExport, importedSource?: ImportedSourceAttachment): Promise<SaveReceipt>;
  replaceOpaque?(expected: SavedCopySummary, snapshot: OpaqueProjectExport): Promise<SaveReceipt>;
  replaceWorkFile?(expected: SavedCopySummary, snapshot: OpaqueProjectExport): Promise<SaveReceipt>;
  delete?(name: string, expected: SavedCopySummary): Promise<void>;
  close(): Promise<void>;
}

export type Currentness = "current" | "pending" | "unknown";
export const LOCAL_RUNTIME_RELOAD_REQUIRED_MESSAGE =
  "The local work could not be safely released. Reload this page before continuing.";
export function savedCopiesAreVisible(status: "checking" | "ready" | "unavailable", count: number): boolean {
  return status === "ready" && count > 0;
}
export type OperationOutcome = "idle" | "pending" | "unknown";
export type SaveStatus = "not-saved" | "saving" | "saved" | "failed";
/** A refused commit keeps its draft; Work's message is shown verbatim to the user. */
export interface CommitOutcome {
  accepted: boolean;
  message?: string;
  /** Work's 1-based character position for a formula refusal, when it provides one. */
  position?: number;
  /**
   * The same position when Work gives it only as a diagnostic fact (its message
   * already states it): used for hints, never shown again.
   */
  sourcePosition?: number;
  /** The refusal is a column rule, and `message` words it with the column's name. */
  ruleRefusal?: true;
}
/** Outcome of a Save a copy attempt; a failure carries its own truthful reason. */
export type CreateCopyOutcome = { saved: true } | { saved: false; reason: string };
export interface SheetShellProps {
  appearancePreference: AppearancePreferenceController;
  requestByteLimit: number;
  view: WorkbookView | null;
  capacity?: { rows: number; maximum: number } | null;
  busy: boolean;
  dirty: boolean;
  currentness: Currentness;
  reloadRequired?: boolean;
  startupUnavailable?: boolean;
  outcome: OperationOutcome;
  saveStatus: SaveStatus;
  message: string | null;
  copies: SavedCopySummary[];
  copiesStatus?: "checking" | "ready" | "unavailable";
  onRetryCopies?(): Promise<void>;
  onOpenFiles(files: FileList): Promise<void>;
  onOpenWorkFile?(file: File): Promise<void>;
  /** The desktop host's file waiting to be opened; the browser has none. */
  takeOpenedFile?: () => Promise<OpenedFile | null>;
  workFileSaveUnavailableReason?: string | null;
  workFileOmissions?: string[];
  onNewTable?(name: string, columns: NewTableColumn[]): Promise<boolean>;
  onNewBlankWorkbook?(): Promise<boolean>;
  onWriteCellAt?(witness: ViewWitness, collection: string, row: number, column: number, input: string | ScalarValueEdit): Promise<RowCommandOutcome>;
  onEditCells?(witness: ViewWitness, edits: CellEdit[]): Promise<RowCommandOutcome>;
  onMoveCells?(witness: ViewWitness, moves: CellMove[]): Promise<RowCommandOutcome>;
  onCopyFormula?(witness: ViewWitness, request: FormulaCopy): Promise<RowCommandOutcome>;
  onPasteCells?(witness: ViewWitness, collection: string, startEntity: string | null, startField: string, rows: PasteCellInput[][]): Promise<RowCommandOutcome>;
  onPasteCellsAt?(witness: ViewWitness, collection: string, row: number, column: number, rows: PasteCellInput[][]): Promise<RowCommandOutcome>;
  onInsertRow?(witness: ViewWitness, collection: string, initializers: RowInitializer[], before?: string, count?: number): Promise<RowCommandOutcome>;
  onAddColumn?(witness: ViewWitness, collection: string, name: string, fieldType: NewTableColumn["field_type"], initializers: ColumnInitializer[] | undefined, required?: boolean): Promise<RowCommandOutcome>;
  onSetColumnRequiredness?(witness: ViewWitness, collection: string, field: string, required: boolean): Promise<RowCommandOutcome>;
  onSetColumnConstraint?(witness: ViewWitness, collection: string, field: string, constraint: FieldConstraintInput): Promise<RowCommandOutcome>;
  onSetColumnWidth?(witness: ViewWitness, collection: string, field: string, width: number | null): Promise<RowCommandOutcome>;
  onSetTableVisibility?(witness: ViewWitness, collection: string, entities: string[], fields: string[], hidden: boolean): Promise<RowCommandOutcome>;
  onSetCellStyle?(witness: ViewWitness, collection: string, rows: CellStyleRows, fields: string[], changes: CellStyleChange[]): Promise<RowCommandOutcome>;
  onSetColumnAlignment?(witness: ViewWitness, collection: string, field: string, alignment: CellAlignment | null): Promise<RowCommandOutcome>;
  onSetColumnDateFormat?(witness: ViewWitness, collection: string, field: string, format: DateFormat | null): Promise<RowCommandOutcome>;
  onSetColumnNumberFormat?(witness: ViewWitness, collection: string, field: string | readonly string[], format: NumberFormat | null): Promise<RowCommandOutcome>;
  onRenameTable?(witness: ViewWitness, collection: string, name: string): Promise<RowCommandOutcome>;
  onAddTable?(witness: ViewWitness, name: string, columns: NewTableColumn[]): Promise<RowCommandOutcome>;
  onDeleteTable?(witness: ViewWitness, collection: string): Promise<RowCommandOutcome>;
  onRenameColumn?(witness: ViewWitness, collection: string, field: string, name: string): Promise<RowCommandOutcome>;
  onRemoveColumn?(witness: ViewWitness, collection: string, field: string): Promise<RowCommandOutcome>;
  onMoveColumn?(witness: ViewWitness, collection: string, field: string, toIndex: number): Promise<RowCommandOutcome>;
  onRemoveRows?(witness: ViewWitness, collection: string, entities: string[]): Promise<RowCommandOutcome>;
  onMoveTable?(witness: ViewWitness, collection: string, toIndex: number): Promise<RowCommandOutcome>;
  onDuplicateTable?(witness: ViewWitness, collection: string, name: string, columnNames?: Record<string, string>, toIndex?: number): Promise<RowCommandOutcome>;
  onQuerySelectionStatistics?(witness: ViewWitness, selection: FieldTarget[] | SelectionStatisticsRange): Promise<SelectionStatisticsProjection | "too-large" | null>;
  /** Totals of the rows a filter shows; arithmetic stays in Work. */
  onQueryShownTotals?(witness: ViewWitness, collection: string, entities: string[]): Promise<ColumnTotalsProjection | null>;
  /** Existing column texts for in-cell completion; Work owns the values. */
  onQueryColumnValues?(witness: ViewWitness, collection: string, field: string): Promise<DistinctValuesProjection | null>;
  /** Grouped totals by one or two columns; the sheet only chooses the question. */
  onQueryGroupTotals?(witness: ViewWitness, collection: string, dimensions: GroupDimension[], measures: string[], scope: GroupScope): Promise<GroupTotalsOutcome | null>;
  /** Work's read-only Excel A1 translation for the displayed grid geometry. */
  onTranslateA1Formula?(witness: ViewWitness, input: A1TranslationRequest): Promise<A1TranslationOutcome | null>;
  onOpenExample(): Promise<void>;
  onOpenTemplate?(id: TemplateId): Promise<void>;
  onOpenSaved(name: string): Promise<void>;
  onSelectCollection?(witness: ViewWitness, collection: string): Promise<void>;
  onCommit(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<CommitOutcome>;
  localHistory: LocalHistorySnapshot;
  onRecordViewHistory(witness: ViewWitness, change: ViewHistoryChange): boolean;
  onHistory(direction: "undo" | "redo"): Promise<FieldTarget | null>;
  onCreateCopy(name: string): Promise<CreateCopyOutcome>;
  boundCopyName?: string | null;
  onSave?(): Promise<boolean>;
  onDeleteCopy?(copy: SavedCopySummary): Promise<void>;
  onClose(): Promise<void>;
  onRefresh(): Promise<void>;
  onDraftChange(dirty: boolean): void;
  /** An invalid report-presentation field is local-only, but must survive lifecycle guards. */
  onReportDraftChange(dirty: boolean): void;
  j4Results?: KeyedGroupedSumResult[];
  /** Internal core handles for refresh only; the UI never displays or requests them. */
  j4DefinitionIds?: string[];
  onPrepareJ4Bindings?(witness: ViewWitness): Promise<KeyedGroupedSumBindingCatalog>;
  onCreateJ4?(witness: ViewWitness, binding: KeyedGroupedSumBindingChoice): Promise<boolean>;
  onRefreshJ4?(witness: ViewWitness, definitionId: string): Promise<boolean>;
  onOpenJ4Canary?(): Promise<SalesEntryOutcome>;
  salesEntryTip?: SalesEntryTipMarker | null;
  salesCatalogLayout?: SalesCatalogLayoutMarker | null;
  /** True only until a real edit/history or applied report setting changes this Sales occurrence. */
  salesInitialNotSaved?: boolean;
  /** Authoritative edit/history has completed successfully in this Sales occurrence. */
  salesExampleChanged?: boolean;
  onDismissSalesEntryTip?(): void;
  report?: ReportConfiguration | null;
  onCreateReport?(definitionId: string, type: ReportConfiguration["type"]): void;
  onUpdateReport?(report: ReportConfiguration): void;
  onExportReportPng?(witness: ViewWitness, report: ReportConfiguration): boolean;
  onRemoveReport?(): boolean;
  interop?: InteropState | null;
  /** The user's file name for imported work; display only. */
  importedSourceName?: string | null;
  importOrigin?: ImportOrigin | null;
  /** `csv` re-reads the same file with a chosen separator or text encoding. */
  onInspectImport?(file: File, csv?: ImportReread): Promise<ImportInspection>;
  onImportCandidate?(selection: ImportSelection): Promise<boolean>;
  onCancelImport?(): void;
  onPreviewReplace?(witness: ViewWitness, fields: FieldTarget[], find: string, replacement: string): Promise<CleanupPreview | null>;
  onPreviewTrim?(witness: ViewWitness, fields: FieldTarget[]): Promise<CleanupPreview | null>;
  onPreviewDeduplicate?(witness: ViewWitness, entities: string[], fields: string[]): Promise<CleanupPreview | null>;
  onCommitCleanup?(witness: ViewWitness, previewId: string): Promise<boolean>;
  onCancelCleanup?(): void;
  /** Produces the actual core export and ledger; this never downloads it. */
  onPrepareDownload?(format: SpreadsheetFormat | "ro"): Promise<boolean>;
  onDownload?(format: SpreadsheetFormat | "ro"): Promise<boolean>;
}

/** A re-read of the chosen file with a different reading: CSV separator and encoding, or an XLSX Total row kept as data. */
export interface ImportReread { delimiter?: CsvDelimiter; encoding?: CsvEncoding; keepSummaryRows?: boolean }

export interface ImportInspection {
  name: string;
  format: SpreadsheetFormat;
  source: SourceWorkbook;
  /** How a delimited text file was read at the file boundary. Absent for .xlsx. */
  /** `sourceBytes` keeps the file exactly as chosen when it was decoded to UTF-8 for reading. */
  csv?: { delimiter: CsvDelimiter; encoding: CsvEncoding; samples: string[]; sourceBytes?: ArrayBuffer };
  /** XLSX: the user chose to import a recognised Total row as an ordinary row. */
  keepSummaryRows?: boolean;
}

export interface InteropState {
  importInspection: ImportInspection | null;
  metadata: InteropMetadata | null;
  ledger: FidelityFinding[];
  /** Every table's columns, read only when a download finding names a column outside the open table. */
  ledgerColumns?: KeyedGroupedSumBindingCatalog;
  cleanupPreview: CleanupPreview | null;
  downloadStatus: "idle" | "consent" | "failed";
  downloadError: string | null;
}

/** A dispatched operation has no trustworthy publication result. */
export class UnknownOperationOutcomeError extends Error {
  readonly outcome = "unknown";
  constructor(message = "The operation outcome is unknown.", options?: ErrorOptions) {
    super(message, options);
    this.name = "UnknownOperationOutcomeError";
  }
}
