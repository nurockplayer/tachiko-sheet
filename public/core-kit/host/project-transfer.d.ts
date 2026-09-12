export type CanonicalProjectTransferEntry = {
    path: string;
    bytes: ArrayBuffer;
};
export declare function projectTransferFromFiles(files: FileList): Promise<ArrayBuffer>;
/**
 * Encode opaque canonical path/byte entries for the private host/WASM arena.
 * This validates only transport shape; Rust remains the `.roproj` authority.
 */
export declare function projectTransferFromEntries(entries: readonly CanonicalProjectTransferEntry[]): ArrayBuffer;
/** Decode an app-private host transfer into opaque path/byte entries. */
export declare function projectTransferToEntries(input: ArrayBuffer): CanonicalProjectTransferEntry[];
