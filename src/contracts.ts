import type {
  CanonicalProjectFile,
  CanonicalTreeExport,
  CollectionSummary,
  FieldBatchProjection,
  FieldTarget,
  TableProjection,
} from "../public/core-kit/experimental-client.js";
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
  read(): Promise<WorkbookView>;
  readFields(witness: ViewWitness, targets: FieldTarget[]): Promise<FieldBatchProjection>;
  edit(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<WorkbookView>;
  exportCanonical(witness: ViewWitness): Promise<CanonicalTreeExport>;
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

export interface SavedCopySummary { name: string; savedAt: string }
export interface SavedCopy extends SavedCopySummary {
  revision: string;
  files: CanonicalProjectFile[];
  importedSource?: ImportedSourceAttachment;
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
  create(name: string, snapshot: CanonicalTreeExport, importedSource?: ImportedSourceAttachment): Promise<SaveReceipt>;
  close(): Promise<void>;
}

export type Currentness = "current" | "pending" | "unknown";
export type OperationOutcome = "idle" | "pending" | "unknown";
export type SaveStatus = "not-saved" | "saving" | "saved" | "failed";
export interface SheetShellProps {
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
  onCommit(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<boolean>;
  onCreateCopy(name: string): Promise<boolean>;
  onClose(): Promise<void>;
  onRefresh(): Promise<void>;
  onDraftChange(dirty: boolean): void;
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
}

/** A dispatched operation has no trustworthy publication result. */
export class UnknownOperationOutcomeError extends Error {
  readonly outcome = "unknown";
  constructor(message = "The operation outcome is unknown.", options?: ErrorOptions) {
    super(message, options);
    this.name = "UnknownOperationOutcomeError";
  }
}
