import type {
  CanonicalProjectFile,
  CanonicalTreeExport,
  CollectionSummary,
  FieldBatchProjection,
  FieldTarget,
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

export type { CanonicalProjectFile, CanonicalTreeExport, FieldTarget };
export type CoreKit = typeof import("../public/core-kit/experimental-client.js");
export type KitLoader = () => Promise<CoreKit>;

/** Disposable, coherent projections from one actual core occurrence/revision. */
export interface WorkbookView {
  title: string;
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

export interface SheetRuntime {
  openFiles(files: FileList): Promise<WorkbookView>;
  openCanonical(files: readonly CanonicalProjectFile[]): Promise<WorkbookView>;
  /**
   * Opens an unparsed core-produced format-2 export. When it descends from an
   * imported source, the public kit first validates the retained producer
   * metadata; no client codec is involved.
   */
  openOpaque(bytes: ArrayBuffer, importedMetadata?: InteropMetadata): Promise<WorkbookView>;
  read(): Promise<WorkbookView>;
  selectCollection(witness: ViewWitness, collection: string): Promise<WorkbookView>;
  readFields(witness: ViewWitness, targets: FieldTarget[]): Promise<FieldBatchProjection>;
  edit(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<WorkbookView>;
  exportCanonical(witness: ViewWitness): Promise<CanonicalTreeExport>;
  exportOpaque(witness: ViewWitness): Promise<OpaqueProjectExport>;
  listKeyedGroupedSumBindings(witness: ViewWitness): Promise<KeyedGroupedSumBindingCatalog>;
  createKeyedGroupedSum(witness: ViewWitness, binding: KeyedGroupedSumBindingChoice): Promise<KeyedGroupedSumResult>;
  queryKeyedGroupedSum(witness: ViewWitness, definitionId: string): Promise<KeyedGroupedSumResult>;
  discoverKeyedGroupedSums(witness: ViewWitness): Promise<KeyedGroupedSumResult[]>;
  /** The public kit parses all spreadsheet bytes; Sheet retains no parser. */
  inspectSpreadsheet(bytes: ArrayBuffer, format: SpreadsheetFormat, options: ImportOptions): Promise<SourceWorkbook>;
  importSpreadsheet(bytes: ArrayBuffer, format: SpreadsheetFormat, options: ImportOptions, selection: ImportSelection): Promise<ImportedWorkbook>;
  previewCleanup(witness: ViewWitness, operation: CleanupOperation): Promise<CleanupPreview>;
  commitCleanup(witness: ViewWitness, previewId: string): Promise<WorkbookView>;
  exportSpreadsheet(witness: ViewWitness, metadata: InteropMetadata, format: SpreadsheetFormat): Promise<SpreadsheetExport>;
  validateImportedProject(files: readonly CanonicalProjectFile[], metadata: InteropMetadata): Promise<void>;
  close(): Promise<void>;
}

export interface ImportedWorkbook {
  view: WorkbookView;
  metadata: InteropMetadata;
  ledger: FidelityFinding[];
}

export type SavedCopyKind = "canonical" | "opaque";
export interface SavedCopySummary { name: string; savedAt: string; kind?: SavedCopyKind }
export interface SavedCopy {
  name: string;
  savedAt: string;
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
export type AnySavedCopy = SavedCopy | OpaqueSavedCopy;
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
    fields: Array<{ key: string; fieldType: string }>;
  }>;
}
export interface KeyedGroupedSumBindingChoice {
  ordersCollection: string;
  orderLookupKeyField: string;
  orderQuantityField: string;
  productsCollection: string;
  productKeyField: string;
  productCategoryField: string;
  productPriceField: string;
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
  close(): Promise<void>;
}

export type Currentness = "current" | "pending" | "unknown";
export type OperationOutcome = "idle" | "pending" | "unknown";
export type SaveStatus = "not-saved" | "saving" | "saved" | "failed";
export interface SheetShellProps {
  appearancePreference: AppearancePreferenceController;
  view: WorkbookView | null;
  busy: boolean;
  dirty: boolean;
  currentness: Currentness;
  outcome: OperationOutcome;
  saveStatus: SaveStatus;
  message: string | null;
  copies: SavedCopySummary[];
  onOpenFiles(files: FileList): Promise<void>;
  onOpenExample(): Promise<void>;
  onOpenSaved(name: string): Promise<void>;
  onSelectCollection?(witness: ViewWitness, collection: string): Promise<void>;
  onCommit(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<boolean>;
  onCreateCopy(name: string): Promise<boolean>;
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
  onOpenJ4Canary?(): Promise<void>;
  report?: ReportConfiguration | null;
  onCreateReport?(definitionId: string, type: ReportConfiguration["type"]): void;
  onUpdateReport?(report: ReportConfiguration): void;
  onExportReportPng?(witness: ViewWitness, report: ReportConfiguration): boolean;
  onRemoveReport?(): boolean;
  interop?: InteropState | null;
  onInspectImport?(file: File): Promise<ImportInspection>;
  onImportCandidate?(selection: ImportSelection): Promise<boolean>;
  onCancelImport?(): void;
  onPreviewTrim?(witness: ViewWitness, fields: FieldTarget[]): Promise<CleanupPreview | null>;
  onPreviewDeduplicate?(witness: ViewWitness, entities: string[], fields: string[]): Promise<CleanupPreview | null>;
  onCommitCleanup?(witness: ViewWitness, previewId: string): Promise<boolean>;
  onCancelCleanup?(): void;
  /** Produces the actual core export and ledger; this never downloads it. */
  onPrepareDownload?(format: SpreadsheetFormat): Promise<boolean>;
  onDownload?(format: SpreadsheetFormat): Promise<boolean>;
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
