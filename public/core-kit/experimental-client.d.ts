import { projectTransferFromFiles } from "./host/project-transfer.ts";
import { DesignerRuntimeError, type DesignerClient } from "./runtime/client.ts";
import type { CanonicalProjectFile, CanonicalTreeExport, OccurrenceProjection, OpenedProjection, ProjectExport } from "./runtime/protocol.ts";
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
    openCanonicalTree(files: readonly CanonicalProjectFile[]): Promise<OpenedProjection>;
    exportCanonicalTree(expectedRevision: string): Promise<CanonicalTreeExport>;
    exportPortableRo(expectedRevision: string): Promise<ProjectExport>;
    verifyPortableRo(bytes: ArrayBuffer): Promise<void>;
    openPortableRo(bytes: ArrayBuffer): Promise<OpenedProjection>;
    observeOccurrence(): Promise<OccurrenceProjection>;
}
export declare function createExperimentalDesignerClient(): ExperimentalDesignerClient;
export { DesignerRuntimeError, projectTransferFromFiles };
export type { DesignerClient };
export type { BootstrapProjection, CanonicalProjectFile, CanonicalTreeExport, CalculationProjection, CollectionSummary, DiagnosticProjection, FailureProjection, FieldBatchProjection, FieldProjection, FieldTarget, OpenedProjection, OccurrenceProjection, ProjectExport, PublicationProjection, StoredValueProjection, TableProjection, } from "./runtime/protocol.ts";
