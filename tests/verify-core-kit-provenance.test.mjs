import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

test('verify-core-kit rejects a stale artifact review URL', async () => {
  const alteredRoot = await mkdtemp(path.join(tmpdir(), 'tachiko-sheet-lock-'));
  const alteredLock = path.join(alteredRoot, 'core-kit.lock.json');
  const lock = JSON.parse(await readFile(path.join(root, 'core-kit.lock.json'), 'utf8'));
  lock.qualificationArtifactReview.url =
    'https://github.com/nurockplayer/tachiko-work/pull/369#issuecomment-5644131034';
  await writeFile(alteredLock, JSON.stringify(lock));

  await assert.rejects(
    run(process.execPath, [path.join(root, 'scripts/verify-core-kit.mjs')], {
      cwd: root,
      env: { ...process.env, WORK_CORE_KIT_LOCK: alteredLock },
    }),
    /canonical review URL/,
  );
});
