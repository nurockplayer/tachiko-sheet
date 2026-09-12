import { projectTransferFromEntries, projectTransferFromFiles, } from "./host/project-transfer.js";
import { DesignerRuntimeError } from "./runtime/client.js";
import { WorkerDesignerClient } from "./runtime/worker-client.js";
export const EXPERIMENTAL_CLIENT_KIT_ID = "tachiko-designer-client-kit/v0-experimental";
const CANONICAL_PROJECT_FILE_COUNT = 18;
const MAX_PROJECT_TRANSFER_BYTES = 64 * 1024 * 1024;
/**
 * Check the public canonical-tree shape before any bytes are dispatched to a
 * Worker. This is transport admission only; Rust remains the `.roproj`
 * parser and source of meaning.
 */
export function preflightCanonicalProjectEntries(entries) {
    if (entries.length > CANONICAL_PROJECT_FILE_COUNT) {
        throw new Error("A canonical .roproj/v1 directory cannot contain more than 18 files.");
    }
    const paths = new Set();
    let total = 8 + 4;
    for (const entry of entries) {
        if (!isSafeRelativePath(entry.path) || paths.has(entry.path)) {
            throw new Error("The canonical project entries do not form one safe project directory.");
        }
        paths.add(entry.path);
        const pathBytes = new TextEncoder().encode(entry.path);
        if (pathBytes.byteLength > 65_535) {
            throw new Error("A selected project path exceeds the private host transfer profile.");
        }
        const bytes = new Uint8Array(entry.bytes);
        total += 2 + 4 + pathBytes.byteLength + bytes.byteLength;
        if (total > MAX_PROJECT_TRANSFER_BYTES) {
            throw new Error("The selected project exceeds the 64 MiB host transfer boundary.");
        }
    }
}
function isSafeRelativePath(path) {
    return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
        path.split("/").every((component) => component.length > 0 && component !== "." && component !== "..");
}
/**
 * Preflight and open a canonical tree through the public `openProject`
 * capability. Invalid entries fail before the capability is invoked.
 */
export async function openCanonicalTreeFromEntries(client, entries) {
    preflightCanonicalProjectEntries(entries);
    return client.openProject(projectTransferFromEntries(entries));
}
class PublicExperimentalDesignerClient extends WorkerDesignerClient {
    async openCanonicalTree(files) {
        return openCanonicalTreeFromEntries(this, files);
    }
}
export function createExperimentalDesignerClient() {
    return new PublicExperimentalDesignerClient(() => new Worker(new URL("./experimental-client.worker.js", import.meta.url), {
        type: "module",
        name: "tachiko-experimental-designer-runtime",
    }));
}
export { DesignerRuntimeError, projectTransferFromEntries, projectTransferFromFiles, };
