// Qualified producer-pin helper. It verifies only the trusted source, review
// provenance and manifest digest, then delegates complete inventory/notices
// checks to the unchanged Sheet tests/kit.mjs. This never claims product PASS.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const lockPath = path.join(root, 'core-kit.lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
if (lock.qualificationStatus !== 'qualified producer pin; product acceptance separate') {
  throw new Error('core-kit.lock.json must record the qualified producer pin with product acceptance separate.');
}
if (lock.qualificationReviewSourceCommit !== lock.sourceCommit ||
    lock.qualificationReviewArtifactManifestSha256 !== lock.artifactManifestSha256) {
  throw new Error('core-kit.lock.json qualification review must be bound to the pinned source commit and artifact manifest.');
}
if (!Array.isArray(lock.qualificationReview) || lock.qualificationReview.length < 2) {
  throw new Error('core-kit.lock.json must record the canonical qualification/review sources.');
}
for (const source of lock.qualificationReview) {
  if (typeof source !== 'string' || !source.startsWith('https://github.com/nurockplayer/tachiko-work/pull/369#issuecomment-')) {
    throw new Error(`Unexpected qualification/review source: ${source}`);
  }
}
const kit = path.resolve(process.env.WORK_CORE_KIT ?? path.join(root, lock.defaultKit));
const manifestPath = path.join(kit, 'artifact-manifest.json');
const manifestBytes = await readFile(manifestPath);
const manifestDigest = createHash('sha256').update(manifestBytes).digest('hex');
if (manifestDigest !== lock.artifactManifestSha256) {
  throw new Error(`Qualified kit manifest digest mismatch: ${manifestDigest}`);
}
const manifest = JSON.parse(manifestBytes);
if (manifest.sourceRepository !== lock.sourceRepository) {
  throw new Error(`Candidate kit source repository mismatch: ${manifest.sourceRepository}`);
}
if (manifest.sourceCommit !== lock.sourceCommit) {
  throw new Error(`Candidate kit source commit mismatch: ${manifest.sourceCommit}`);
}
if (manifest.entry !== lock.entry || manifest.stability !== 'experimental') {
  throw new Error('Candidate kit public entry or stability does not match the lock.');
}
console.log(JSON.stringify({
  case: 'qualified core-kit trust pin',
  status: 'PASS',
  qualificationStatus: lock.qualificationStatus,
  qualificationReview: lock.qualificationReview,
  kit,
  sourceCommit: manifest.sourceCommit,
  artifactManifestSha256: manifestDigest,
}));

const child = spawn(process.execPath, [path.join(root, 'tests', 'kit.mjs')], {
  cwd: root,
  env: {
    ...process.env,
    WORK_CLIENT_KIT: kit,
    WORK_CORE_COMMIT: lock.sourceCommit,
  },
  stdio: 'inherit',
});
const result = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({code, signal}));
});
if (result.code !== 0) {
  console.error(`Unchanged tests/kit.mjs exited ${result.signal ?? result.code}.`);
  process.exit(typeof result.code === 'number' ? result.code : 1);
}
