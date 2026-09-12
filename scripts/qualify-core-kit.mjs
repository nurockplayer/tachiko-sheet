// Qualified producer-pin runner. It uses the default public/core-kit (or an
// explicit WORK_CORE_KIT for an ephemeral proof composition), invokes unchanged
// Sheet tests, and records each child exit code in a separate log. It never
// claims Sheet product acceptance or PASS.
import { closeSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const lock = JSON.parse(await readFile(path.join(root, 'core-kit.lock.json'), 'utf8'));
const kit = path.resolve(process.env.WORK_CORE_KIT ?? path.join(root, lock.defaultKit));
const logDir = await mkdtemp(path.join(os.tmpdir(), 'tachiko-sheet-core-kit-qualified-'));
await mkdir(logDir, {recursive: true});

async function runStep(name, args, extraEnvironment = {}) {
  const logPath = path.join(logDir, `${name}.log`);
  const logFd = openSync(logPath, 'w');
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      WORK_CORE_KIT: kit,
      WORK_CLIENT_KIT: kit,
      WORK_CORE_COMMIT: lock.sourceCommit,
      ...extraEnvironment,
    },
    stdio: ['ignore', logFd, logFd],
  });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  closeSync(logFd);
  const exitCode = typeof result.code === 'number' ? result.code : 1;
  console.log(JSON.stringify({case: `qualified producer pin ${name}`, status: exitCode === 0 ? 'PASS' : 'FAIL', exitCode, log: logPath}));
  return exitCode;
}

console.log(JSON.stringify({
  qualificationStatus: lock.qualificationStatus,
  sourceCommit: lock.sourceCommit,
  artifactManifestSha256: lock.artifactManifestSha256,
  kit,
  logDir,
}));
for (const [name, args, env] of [
  ['verify-kit-and-inventory', [path.join(root, 'scripts', 'verify-core-kit.mjs')], {}],
  ['storage-c1', [path.join(root, 'tests', 'storage.mjs')], {
    WORK_STORAGE_DRIVER: path.join(root, 'tests', 'qualification', 'public-kit-storage-driver.mjs'),
    WORK_PLAYWRIGHT_MODULE: 'playwright-core',
  }],
  ['browser-canary', [path.join(root, 'scripts', 'run-core-kit-canary.mjs')], {}],
]) {
  const exitCode = await runStep(name, args, env);
  if (exitCode !== 0) process.exit(exitCode);
}
console.log('qualified producer pin verified; product acceptance and platform gates remain separate');
