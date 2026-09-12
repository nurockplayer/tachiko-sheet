// Prebuild helper for the Home "Try example" action.
//
// It copies the unchanged 18-file release-plan seed fixture into the generated
// (git-ignored) public/examples/release-plan directory so the product can
// transport opaque bytes from the same origin. Only the fixed file inventory is
// copied, no JSON is parsed and the seed fixture is never modified.
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = fileURLToPath(new URL('../tests/fixtures/release-plan.roproj', import.meta.url));
const target = fileURLToPath(new URL('../public/examples/release-plan', import.meta.url));
const shards = Array.from('0123456789abcdef', (shard) => `entities/${shard}.jsonl`);
const inventory = ['manifest.json', 'schemas.json', ...shards];

await rm(target, { recursive: true, force: true });
await mkdir(path.join(target, 'entities'), { recursive: true });
for (const entry of inventory) {
  await copyFile(path.join(source, entry), path.join(target, entry));
}
console.log(`Copied ${inventory.length} unchanged fixture files to ${target}`);
