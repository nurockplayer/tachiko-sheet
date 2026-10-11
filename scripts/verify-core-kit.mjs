// Qualified producer-pin helper. It verifies only the trusted source, review
// provenance and manifest digest, then delegates complete inventory/notices
// checks to the unchanged Sheet tests/kit.mjs. This never claims product PASS.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every receipt is bound to one tested artifact. Adding a successor requires
// review of its exact producer handback and artifact review; a URL pattern or
// self-consistent lock file is not qualification evidence. Keep the previous
// tuple for an explicit rollback, never mix receipts between qualified kits.
const qualifiedArtifacts = [
  {
    sourceCommit: '518aaa55e046a4e4676b4d5e05d8189c4c6343fe',
    artifactManifestSha256: 'ae82d68592b73ac5da4f72fe9242833f2e9ba15e93480fac01d5d7751b86125b',
    review: 'https://github.com/nurockplayer/tachiko-work/pull/369#issuecomment-5645924065',
    handback: 'https://github.com/nurockplayer/tachiko-work/pull/369#issuecomment-5643542471',
  },
  {
    sourceCommit: '40d01a45e4b24ff4652dad18662d29c9cbab86a8',
    artifactManifestSha256: 'b85f9c23906ae42f7210020b9ddd4309a85ef496bf3d48c5f8a014f13c947def',
    review: 'https://github.com/nurockplayer/tachiko-work/pull/496#issuecomment-6083244797',
    handback: 'https://github.com/nurockplayer/tachiko-work/issues/495#issuecomment-6083365325',
  },
  {
    // Same source, rebuilt by Work's exporter on macOS (different toolchain,
    // different WASM bytes). Qualified on its own evidence; this is the
    // artifact Sheet ships.
    sourceCommit: '40d01a45e4b24ff4652dad18662d29c9cbab86a8',
    artifactManifestSha256: 'c5aa4b672f53a62de98f748f449602a62f26a6b1efdc2e66e5ec1adddc0bb035',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/150#issuecomment-6104794113',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/150#issuecomment-6104780673',
  },
];

export function validateCoreKitProvenance(lock) {
  if (lock?.schema !== 'tachiko-sheet-core-kit-lock-v1' ||
      lock.sourceRepository !== 'nurockplayer/tachiko-work' ||
      lock.entry !== 'experimental-client.js') {
    throw new Error('core-kit.lock.json schema, source repository or public entry is not qualified.');
  }
  if (lock.qualificationStatus !== 'qualified producer pin; product acceptance separate') {
    throw new Error('core-kit.lock.json must record the qualified producer pin with product acceptance separate.');
  }
  const qualified = qualifiedArtifacts.find((artifact) =>
    artifact.sourceCommit === lock.sourceCommit &&
    artifact.artifactManifestSha256 === lock.artifactManifestSha256);
  if (!qualified) {
    throw new Error('core-kit.lock.json source and manifest must identify one qualified artifact.');
  }
  const artifactReview = lock.qualificationArtifactReview;
  if (artifactReview?.sourceCommit !== lock.sourceCommit ||
      artifactReview?.artifactManifestSha256 !== lock.artifactManifestSha256 ||
      artifactReview?.url !== qualified.review) {
    throw new Error('core-kit.lock.json artifact review must match the pinned source, manifest and canonical review URL.');
  }
  if (lock.qualificationHandback !== qualified.handback) {
    throw new Error(`Unexpected qualification handback source: ${lock.qualificationHandback}`);
  }
}

export async function verifyCoreKit() {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const lockPath = process.env.WORK_CORE_KIT_LOCK ?? path.join(root, 'core-kit.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  validateCoreKitProvenance(lock);
  const artifactReview = lock.qualificationArtifactReview;
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
    qualificationHandback: lock.qualificationHandback,
    qualificationArtifactReview: artifactReview,
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyCoreKit();
}
