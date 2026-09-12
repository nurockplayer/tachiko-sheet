import type { SpreadsheetExport, SpreadsheetOperation } from "./interop-protocol.ts";
import type { CanonicalTreeExport, DesignerRequest, ProjectExport, DesignerWireReply } from "./protocol.ts";
export type DesignerWasmBridge = {
    spreadsheet(operation: SpreadsheetOperation, bytes: Uint8Array): DesignerWireReply | {
        status: "spreadsheet_exported";
        export: SpreadsheetExport;
    };
    request(request: DesignerRequest): DesignerWireReply;
    inspectProject(bytes: Uint8Array): DesignerWireReply;
    openProject(bytes: Uint8Array, occurrenceId: string): DesignerWireReply;
    openLocalDocument(bytes: Uint8Array, occurrenceId: string): DesignerWireReply;
    exportProject(expectedRevision: string): {
        status: "ok";
        export: ProjectExport;
    } | Extract<DesignerWireReply, {
        status: "error";
    }>;
    exportCanonicalTree(expectedRevision: string): {
        status: "ok";
        export: CanonicalTreeExport;
    } | Extract<DesignerWireReply, {
        status: "error";
    }>;
    exportPortableRo(expectedRevision: string): {
        status: "ok";
        export: ProjectExport;
    } | Extract<DesignerWireReply, {
        status: "error";
    }>;
    verifyPortableRo(bytes: Uint8Array): DesignerWireReply;
    openPortableRo(bytes: Uint8Array, occurrenceId: string): DesignerWireReply;
    observeOccurrence(): DesignerWireReply;
    closeProject(): void;
};
export declare function createDesignerWasmBridge(wasmUrl: string): Promise<DesignerWasmBridge>;
