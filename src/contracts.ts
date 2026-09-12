import type {
  CanonicalProjectFile,
  CanonicalTreeExport,
  CollectionSummary,
  FieldBatchProjection,
  FieldTarget,
  TableProjection,
} from "../public/core-kit/experimental-client.js";

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
  close(): Promise<void>;
}

export interface SavedCopySummary { name: string; savedAt: string }
export interface SavedCopy extends SavedCopySummary {
  revision: string;
  files: CanonicalProjectFile[];
}
export interface SaveReceipt extends SavedCopySummary { revision: string }
export interface LocalCopies {
  list(): Promise<SavedCopySummary[]>;
  read(name: string): Promise<SavedCopy | null>;
  create(name: string, snapshot: CanonicalTreeExport): Promise<SaveReceipt>;
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
}

/** A dispatched operation has no trustworthy publication result. */
export class UnknownOperationOutcomeError extends Error {
  readonly outcome = "unknown";
  constructor(message = "The operation outcome is unknown.", options?: ErrorOptions) {
    super(message, options);
    this.name = "UnknownOperationOutcomeError";
  }
}
