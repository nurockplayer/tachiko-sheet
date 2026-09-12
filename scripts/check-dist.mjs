// Verifies a production distributable ships no acceptance/fault hook module
// and no acceptance global. The acceptance build is separate on purpose.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const forbiddenNames = /acceptance|sheet-foundation/i;
const forbiddenText = /__tachikoAcceptance|tachiko acceptance wiring|failNextSave|loseNextExecuteReply/;
const textExtensions = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.map', '.txt', '.svg']);

const files = [];
async function walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) {
      await walk(path.join(directory, entry.name), `${relative}/`);
    } else {
      files.push(relative);
    }
  }
}
await walk(root);

const failures = [];
for (const relative of files) {
  if (forbiddenNames.test(path.basename(relative))) failures.push(`hook module present: ${relative}`);
  if (!textExtensions.has(path.extname(relative)) && !relative.endsWith('index.html')) continue;
  const text = await readFile(path.join(root, relative), 'utf8');
  if (forbiddenText.test(text)) failures.push(`hook reference present: ${relative}`);
}

if (failures.length > 0) {
  console.error(JSON.stringify({ case: 'production exclusion of acceptance hooks', status: 'FAIL', failures }));
  process.exit(1);
}
console.log(JSON.stringify({ case: 'production exclusion of acceptance hooks', status: 'PASS', files: files.length }));
