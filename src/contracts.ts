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
import type { KeyedGroupedSumProjection } from "../public/core-kit/runtime/protocol.js";
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
import type { LocalHistorySnapshot } from "./application/local-history.js";
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
export type ScalarEdit =
  | { kind: "number"; input: string }
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "date"; value: string };

export type NewTableColumn = { name: string; field_type: "text" | "number" | "date" | "boolean" };
export type ColumnInitializer = { entity: string; input: ScalarEdit };
export type CellEdit = { target: FieldTarget; input: ScalarEdit | { kind: "clear" } };
export type RowInitializer = { field: string; input: ScalarEdit };
/** Refusals retain the draft; recovery must never replay a dispatched command. */
export type RowCommandOutcome =
  | { kind: "confirmed" }
  | { kind: "refused"; message: string; fieldType?: string; refusalCode?: string }
  | { kind: "recovery" };

export interface SheetRuntime {
  /** Read-only, cached client/kit readiness; never opens or creates work. */
  prepare(): Promise<void>;
  newTable(name: string, columns: NewTableColumn[]): Promise<WorkbookView>;
  insertRow(witness: ViewWitness, collection: string, initializers: RowInitializer[]): Promise<ConfirmedPublication>;
  editCells(witness: ViewWitness, edits: CellEdit[]): Promise<ConfirmedPublication>;
  pasteCells(witness: ViewWitness, collection: string, startEntity: string | null, startField: string, rows: PasteCellInput[][]): Promise<ConfirmedPublication>;
  addColumn(witness: ViewWitness, collection: string, name: string, fieldType: NewTableColumn["field_type"], initializers: ColumnInitializer[]): Promise<ConfirmedPublication>;
  renameColumn(witness: ViewWitness, collection: string, field: string, name: string): Promise<ConfirmedPublication>;
  removeColumn(witness: ViewWitness, collection: string, field: string): Promise<ConfirmedPublication>;
  removeRows(witness: ViewWitness, collection: string, entities: string[]): Promise<ConfirmedPublication>;
  openFiles(files: FileList): Promise<WorkbookView>;
  openCanonical(files: readonly CanonicalProjectFile[]): Promise<WorkbookView>;
  /**
   * Opens an unparsed core-produced format-2 export. When it descends from an
   * imported source, the public kit first validates the retained producer
   * metadata; no client codec is involved.
   */
  openOpaque(bytes: ArrayBuffer, importedMetadata?: InteropMetadata): Promise<WorkbookView>;
  openWorkFile(bytes: ArrayBuffer): Promise<WorkbookView>;
  exportWorkFile(witness: ViewWitness): Promise<OpaqueProjectExport>;
  read(): Promise<WorkbookView>;
  selectCollection(witness: ViewWitness, collection: string): Promise<WorkbookView>;
  readFields(witness: ViewWitness, targets: FieldTarget[]): Promise<FieldBatchProjection>;
  edit(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<WorkbookView>;
  editConfirmed(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<ConfirmedPublication>;
  trackerHistory(witness: ViewWitness, direction: "undo" | "redo"): Promise<ConfirmedPublication>;
  exportCanonical(witness: ViewWitness): Promise<CanonicalTreeExport>;
  exportOpaque(witness: ViewWitness): Promise<OpaqueProjectExport>;
  listKeyedGroupedSumBindings(witness: ViewWitness): Promise<KeyedGroupedSumBindingCatalog>;
  createKeyedGroupedSum(witness: ViewWitness, binding: KeyedGroupedSumBindingChoice): Promise<KeyedGroupedSumResult & { publication: PublicationProjection }>;
  queryKeyedGroupedSum(witness: ViewWitness, definitionId: string): Promise<KeyedGroupedSumResult>;
  discoverKeyedGroupedSums(witness: ViewWitness): Promise<KeyedGroupedSumResult[]>;
  /** The public kit parses all spreadsheet bytes; Sheet retains no parser. */
  inspectSpreadsheet(bytes: ArrayBuffer, format: SpreadsheetFormat, options: ImportOptions): Promise<SourceWorkbook>;
  importSpreadsheet(bytes: ArrayBuffer, format: SpreadsheetFormat, options: ImportOptions, selection: ImportSelection): Promise<ImportedWorkbook>;
  previewCleanup(witness: ViewWitness, operation: CleanupOperation): Promise<CleanupPreview>;
  commitCleanup(witness: ViewWitness, previewId: string): Promise<WorkbookView>;
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
export interface OpaqueSavedCopy extends SavedCopySummary {
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
  revision: string;
  bytes: ArrayBuffer;
  importedSource?: ImportedSourceAttachment;
  /** Optional host-private report configuration paired to this exact snapshot. */
  presentation?: PresentationAttachment;
}
/** Visible selection vocabulary only. Runtime resolves these names to stable core IDs at dispatch. */
export interface KeyedGroupedSumBindingCatalog {
  collections: Array<{
    key: string;
    displayName?: string;
    fields: Array<{ key: string; displayName?: string; fieldType: string }>;
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
export interface SheetShellProps {
  appearancePreference: AppearancePreferenceController;
  view: WorkbookView | null;
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
  workFileUnavailableReason?: string | null;
  workFileSaveUnavailableReason?: string | null;
  workFileOmissions?: string[];
  onNewTable?(name: string, columns: NewTableColumn[]): Promise<boolean>;
  onEditCells?(witness: ViewWitness, edits: CellEdit[]): Promise<RowCommandOutcome>;
  onPasteCells?(witness: ViewWitness, collection: string, startEntity: string | null, startField: string, rows: PasteCellInput[][]): Promise<RowCommandOutcome>;
  onInsertRow?(witness: ViewWitness, collection: string, initializers: RowInitializer[]): Promise<RowCommandOutcome>;
  onAddColumn?(witness: ViewWitness, collection: string, name: string, fieldType: NewTableColumn["field_type"], initializers: ColumnInitializer[]): Promise<RowCommandOutcome>;
  onRenameColumn?(witness: ViewWitness, collection: string, field: string, name: string): Promise<RowCommandOutcome>;
  onRemoveColumn?(witness: ViewWitness, collection: string, field: string): Promise<RowCommandOutcome>;
  onRemoveRows?(witness: ViewWitness, collection: string, entities: string[]): Promise<RowCommandOutcome>;
  onOpenExample(): Promise<void>;
  onOpenSaved(name: string): Promise<void>;
  onSelectCollection?(witness: ViewWitness, collection: string): Promise<void>;
  onCommit(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<boolean>;
  localHistory: LocalHistorySnapshot;
  onHistory(direction: "undo" | "redo"): Promise<FieldTarget | null>;
  onCreateCopy(name: string): Promise<boolean>;
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
  onInspectImport?(file: File): Promise<ImportInspection>;
  onImportCandidate?(selection: ImportSelection): Promise<boolean>;
  onCancelImport?(): void;
  onPreviewTrim?(witness: ViewWitness, fields: FieldTarget[]): Promise<CleanupPreview | null>;
  onPreviewDeduplicate?(witness: ViewWitness, entities: string[], fields: string[]): Promise<CleanupPreview | null>;
  onCommitCleanup?(witness: ViewWitness, previewId: string): Promise<boolean>;
  onCancelCleanup?(): void;
  /** Produces the actual core export and ledger; this never downloads it. */
  onPrepareDownload?(format: SpreadsheetFormat | "ro"): Promise<boolean>;
  onDownload?(format: SpreadsheetFormat | "ro"): Promise<boolean>;
}

export interface ImportInspection {
  name: string;
  format: SpreadsheetFormat;
  source: SourceWorkbook;
}

export interface InteropState {
  importInspection: ImportInspection | null;
  metadata: InteropMetadata | null;
  ledger: FidelityFinding[];
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
