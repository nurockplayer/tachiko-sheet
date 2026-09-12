/// <reference lib="webworker" />
import { startDesignerWorker } from "./runtime/worker-runtime.js";
startDesignerWorker(new URL("./designer_runtime.wasm", import.meta.url).href);
