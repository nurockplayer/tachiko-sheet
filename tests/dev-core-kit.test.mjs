import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

const root = new URL('../', import.meta.url);
const entries = [];
for (const source of ['src/core-loader.ts', 'src/host/native-runtime.ts']) {
  const text = await readFile(new URL(source, root), 'utf8');
  entries.push(...[...text.matchAll(/export const PUBLIC_\w+_ENTRY = "([^"]+)"/g)].map((match) => match[1]));
}
assert.equal(entries.length, 3, 'cover the Web entry and both additional native kit entries');

test('Web and desktop dev imports serve the intact public core-kit JavaScript', async () => {
  for (const mode of ['development', 'desktop']) {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'sheet-dev-core-kit-'));
    let server;
    try {
      server = await createServer({
        root: fileURLToPath(root),
        mode,
        cacheDir,
        server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
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
    } finally {
      await server?.close();
      await rm(cacheDir, { recursive: true, force: true });
    }
  }
});
