// The desktop app runs the Tachiko Work runtime natively. Remove the kit's
// Worker/WASM runtime files from its frontend so the packaged app cannot fall
// back to them, and fail if any WebAssembly remains.
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist-desktop');
const workerRuntime = [
  'core-kit/designer_runtime.wasm',
  'core-kit/experimental-client.worker.js',
  'core-kit/experimental-client.worker.d.ts',
  'core-kit/runtime/worker-runtime.js',
  'core-kit/runtime/worker-runtime.d.ts',
  'core-kit/runtime/wasm-bridge.js',
  'core-kit/runtime/wasm-bridge.d.ts',
];
for (const relative of workerRuntime) await rm(path.join(root, relative), { force: true });

const remaining = [];
async function walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), `${relative}/`);
    else if (entry.name.endsWith('.wasm') || /worker-runtime|wasm-bridge/.test(entry.name)) remaining.push(relative);
  }
}
await walk(root);
if (remaining.length > 0) {
  console.error(JSON.stringify({ case: 'desktop dist excludes the Worker/WASM runtime', status: 'FAIL', remaining }));
  process.exit(1);
}
console.log(JSON.stringify({ case: 'desktop dist excludes the Worker/WASM runtime', status: 'PASS', removed: workerRuntime.length }));
