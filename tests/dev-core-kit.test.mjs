import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import { projectTransferFromFiles } from '../public/core-kit/experimental-client.js';
import { projectTransferToEntries } from '../public/core-kit/host/project-transfer.js';
import { archiveEntries } from './product/work-file-archive.mjs';

const root = new URL('../', import.meta.url);
const entries = [];
for (const source of ['src/core-loader.ts', 'src/host/native-runtime.ts']) {
  const text = await readFile(new URL(source, root), 'utf8');
  entries.push(...[...text.matchAll(/export const PUBLIC_\w+_ENTRY = "([^"]+)"/g)].map((match) => match[1]));
}
assert.equal(entries.length, 3, 'cover the Web entry and both additional native kit entries');

test('kit host accepts a backslash in a v3 folder root but refuses it in a relative path', async () => {
  const archive = Buffer.from((await readFile(new URL('./fixtures/work-file/constrained-v3.hex', import.meta.url), 'utf8')).replace(/\s/g, ''), 'hex');
  const canonical = archiveEntries(archive).slice(1).map(({ name, body }) => ({
    path: name.replace(/^payload\//, ''), bytes: Uint8Array.from(body).buffer,
  }));
  assert.equal(canonical.length, 19);
  assert.equal(JSON.parse(new TextDecoder().decode(canonical[0].bytes)).format_version, 3);
  function selectedFiles(relativePath = path => path) {
    // FileList order can differ from storage order; retain the original bytes.
    const files = canonical.slice().reverse().map(({ path, bytes }) => {
      const file = new File([bytes], path.split('/').at(-1));
      Object.defineProperty(file, 'webkitRelativePath', { value: `Forecast\\Final.roproj/${relativePath(path)}` });
      return file;
    });
    return Object.assign(files, { item: index => files[index] ?? null });
  }
  const transferred = await projectTransferFromFiles(selectedFiles());
  assert.deepEqual(projectTransferToEntries(transferred), canonical, 'root is stripped; every canonical path and byte survives');
  await assert.rejects(
    projectTransferFromFiles(selectedFiles(path => path.replace('entities/', 'entities\\'))),
    /one safe project directory/,
  );
});

test('Web and desktop dev imports preserve core-kit bytes and Vite URL modules', async () => {
  for (const mode of ['development', 'desktop']) {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'sheet-dev-core-kit-'));
    let server;
    try {
      server = await createServer({
        root: fileURLToPath(root),
        mode,
        cacheDir,
        server: {
          host: '127.0.0.1', port: 0, hmr: false, watch: null,
          // Vite 8.3 checks public asset URL IDs against its filesystem allowlist.
          // Permit those IDs here so the URL-module regression reaches transforms.
          fs: { allow: [fileURLToPath(root), '/core-kit'] },
        },
        optimizeDeps: { noDiscovery: true, include: [] },
      });
      await server.listen();
      const address = server.httpServer.address();
      assert.ok(address && typeof address === 'object');
      for (const entry of entries) {
        // Vite adds this marker even to the app's @vite-ignore imports.
        const response = await fetch(`http://127.0.0.1:${address.port}${entry}?import`, {
          signal: AbortSignal.timeout(5000),
        });
        assert.equal(response.status, 200, `${mode}: ${entry}?import`);
        assert.match(response.headers.get('content-type') ?? '', /(?:java|ecma)script/i);
        assert.deepEqual(
          Buffer.from(await response.arrayBuffer()),
          await readFile(new URL(`public${entry}`, root)),
          `${mode}: ${entry} is served without transforming kit bytes`,
        );
      }
      const wasmEntry = '/core-kit/designer_runtime.wasm';
      const urlResponse = await fetch(`http://127.0.0.1:${address.port}${wasmEntry}?import&url`, {
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(urlResponse.status, 200, `${mode}: ${wasmEntry}?import&url`);
      assert.match(urlResponse.headers.get('content-type') ?? '', /(?:java|ecma)script/i);
      assert.match(
        await urlResponse.text(),
        /^export default ["']\/core-kit\/designer_runtime\.wasm["'];?$/m,
        `${mode}: the WASM URL import is a JavaScript URL module, not raw bytes`,
      );
    } finally {
      await server?.close();
      await rm(cacheDir, { recursive: true, force: true });
    }
  }
});
