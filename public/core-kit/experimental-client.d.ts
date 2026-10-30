import { projectTransferFromEntries, projectTransferFromFiles, type CanonicalProjectTransferEntry } from "./host/project-transfer.ts";
import type { SpreadsheetExport, SpreadsheetFormat } from "./runtime/interop-protocol.ts";
import { DesignerRuntimeError, type DesignerClient } from "./runtime/client.ts";
import { isCapacityFailure, isFormulaFailure } from "./runtime/protocol.ts";
import type { CanonicalProjectFile, CanonicalTreeExport, OccurrenceProjection, OpenedProjection, ProjectExport, FieldConstraintInput, NumberFormat, FieldTarget, PublicationProjection, CapacityProjection } from "./runtime/protocol.ts";
export declare const EXPERIMENTAL_CLIENT_KIT_ID = "tachiko-designer-client-kit/v0-experimental";
/**
 * Public client surface exposed by the experimental kit.
 *
 * The application client keeps these storage and occurrence operations
 * optional so lightweight in-app implementations can provide only the
 * capabilities they need. The actual Worker client supplies all of them,
 * and the vendored kit makes that stronger contract explicit for consumers.
 */
export interface ExperimentalDesignerClient extends DesignerClient {
    queryCapacity(expectedRevision?: string): Promise<CapacityProjection>;
    /** Explicit absence for one optional native Text/Number slot. */
    clearField(expectedRevision: string, target: FieldTarget): Promise<PublicationProjection>;
    /** Strengthening refuses while any entity lacks a value; never fills or coerces. */
    setColumnRequiredness(expectedRevision: string, collection: string, field: string, required: boolean): Promise<PublicationProjection>;
    /** Replace one durable Text/Number constraint; `none` clears it. */
    setColumnConstraint(expectedRevision: string, collection: string, field: string, constraint: FieldConstraintInput): Promise<PublicationProjection>;
    /** Replace or clear one Number column's durable display format. */
    setColumnNumberFormat(expectedRevision: string, collection: string, field: string, numberFormat: NumberFormat | null): Promise<PublicationProjection>;
    /** Move one column to a zero-based index; the order is durable document state. */
    moveColumn(expected: string, collection: string, field: string, toIndex: number): Promise<PublicationProjection>;
    exportNativeTablesSpreadsheet(expectedRevision: string, collection: string, format: SpreadsheetFormat): Promise<SpreadsheetExport>;
    exportProjectV3(expectedRevision: string): Promise<ProjectExport>;
    openCanonicalTree(files: readonly CanonicalProjectFile[]): Promise<OpenedProjection>;
    exportCanonicalTree(expectedRevision: string): Promise<CanonicalTreeExport>;
    exportPortableRo(expectedRevision: string): Promise<ProjectExport>;
    verifyPortableRo(bytes: ArrayBuffer): Promise<void>;
    openPortableRo(bytes: ArrayBuffer): Promise<OpenedProjection>;
    observeOccurrence(): Promise<OccurrenceProjection>;
}
/**
 * Check the public canonical-tree shape before any bytes are dispatched to a
 * Worker. This is transport admission only; Rust remains the `.roproj`
 * parser and source of meaning.
 */
export declare function preflightCanonicalProjectEntries(entries: readonly CanonicalProjectTransferEntry[]): void;
/**
 * Preflight and open a canonical tree through the public `openProject`
 * capability. Invalid entries fail before the capability is invoked.
 */
export declare function openCanonicalTreeFromEntries(client: Pick<ExperimentalDesignerClient, "openProject">, entries: readonly CanonicalProjectTransferEntry[]): Promise<OpenedProjection>;
export declare function createExperimentalDesignerClient(): ExperimentalDesignerClient;
export { DesignerRuntimeError, isCapacityFailure, isFormulaFailure, projectTransferFromEntries, projectTransferFromFiles, };
export type { DesignerClient };
export type { CanonicalProjectTransferEntry } from "./host/project-transfer.ts";
export type { BootstrapProjection, CapacityFailureProjection, CapacityLimitName, CapacityLimits, CapacityProjection, CapacityUsage, CanonicalProjectFile, CanonicalTreeExport, CalculationProjection, CollectionSummary, ColumnProjection, ConstraintFailureProjection, ConstraintFailureReason, DiagnosticProjection, FailureCode, FailureProjection, FieldConstraint, FieldConstraintInput, NumberFormat, FieldBatchProjection, FormulaFailureCode, FormulaFailureProjection, FieldDependencyProjection, FieldExplanationProjection, FieldProjection, FieldTarget, NewTableColumnInput, PasteCellInput, ScalarEditInput, TrackerCommand, OpenedProjection, OccurrenceProjection, ProjectExport, PublicationProjection, StoredValueProjection, TableProjection, } from "./runtime/protocol.ts";
