import { projectTransferFromFiles } from "./host/project-transfer.js";
import { DesignerRuntimeError } from "./runtime/client.js";
import { WorkerDesignerClient } from "./runtime/worker-client.js";
export const EXPERIMENTAL_CLIENT_KIT_ID = "tachiko-designer-client-kit/v0-experimental";
export function createExperimentalDesignerClient() {
    return new WorkerDesignerClient(() => new Worker(new URL("./experimental-client.worker.js", import.meta.url), {
        type: "module",
        name: "tachiko-experimental-designer-runtime",
    }));
}
export { DesignerRuntimeError, projectTransferFromFiles };
