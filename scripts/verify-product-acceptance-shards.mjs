import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyShardSummaries } from './product-acceptance-shards.mjs';

try {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: verify-product-acceptance-shards.mjs <dir>');
  const expectedSteps = JSON.parse(execFileSync(process.execPath, [
    fileURLToPath(new URL('./run-product-acceptance.mjs', import.meta.url)), '--list',
  ], { encoding: 'utf8' }));
  const entries = await readdir(directory, { withFileTypes: true });
  const summaries = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) =>
    JSON.parse(await readFile(path.join(directory, entry.name, 'summary.json'), 'utf8'))));
  const needs = JSON.parse(process.env.TACHIKO_ACCEPTANCE_NEEDS ?? 'null');
  const names = verifyShardSummaries(expectedSteps, summaries, needs);
  for (const name of names) console.log(name);
  console.log(`PASS: all ${names.length} product acceptance steps ran exactly once across 4 shards`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
