import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { validateCoreKitProvenance } from '../scripts/verify-core-kit.mjs';

const run = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtures = [
  {
    name: 'PR369 rollback artifact',
    sourceCommit: '518aaa55e046a4e4676b4d5e05d8189c4c6343fe',
    artifactManifestSha256: 'ae82d68592b73ac5da4f72fe9242833f2e9ba15e93480fac01d5d7751b86125b',
    review: 'https://github.com/nurockplayer/tachiko-work/pull/369#issuecomment-5645924065',
    handback: 'https://github.com/nurockplayer/tachiko-work/pull/369#issuecomment-5643542471',
  },
  {
    name: 'PR496 qualified Text-capacity artifact',
    sourceCommit: '40d01a45e4b24ff4652dad18662d29c9cbab86a8',
    artifactManifestSha256: 'b85f9c23906ae42f7210020b9ddd4309a85ef496bf3d48c5f8a014f13c947def',
    review: 'https://github.com/nurockplayer/tachiko-work/pull/496#issuecomment-6083244797',
    handback: 'https://github.com/nurockplayer/tachiko-work/issues/495#issuecomment-6083365325',
  },
  {
    name: 'Sheet #150 rebuilt 40d01a45 artifact',
    sourceCommit: '40d01a45e4b24ff4652dad18662d29c9cbab86a8',
    artifactManifestSha256: 'c5aa4b672f53a62de98f748f449602a62f26a6b1efdc2e66e5ec1adddc0bb035',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/150#issuecomment-6104794113',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/150#issuecomment-6104780673',
  },
  {
    name: 'Sheet #160 reproducible b1560ab4 artifact',
    sourceCommit: 'b1560ab4331847557f04dfd6833fbffcabfc1169',
    artifactManifestSha256: '94396e8fcd8cea32a4d120ca9087e0dde5bdd4adf2389f370eb1d6b96a2ff28a',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/160#issuecomment-6128045548',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/160#issuecomment-6128045548',
  },
];

function lockFor(fixture) {
  return {
    schema: 'tachiko-sheet-core-kit-lock-v1',
    qualificationStatus: 'qualified producer pin; product acceptance separate',
    defaultKit: 'public/core-kit',
    sourceRepository: 'nurockplayer/tachiko-work',
    sourceCommit: fixture.sourceCommit,
    artifactManifestSha256: fixture.artifactManifestSha256,
    entry: 'experimental-client.js',
    qualificationHandback: fixture.handback,
    qualificationArtifactReview: {
      sourceCommit: fixture.sourceCommit,
      artifactManifestSha256: fixture.artifactManifestSha256,
      url: fixture.review,
    },
  };
}

for (const [index, fixture] of fixtures.entries()) {
  test(`provenance admits the exact ${fixture.name} tuple only`, () => {
    assert.doesNotThrow(() => validateCoreKitProvenance(lockFor(fixture)));
  });

  const other = fixtures.find((candidate) => candidate.sourceCommit !== fixture.sourceCommit);
  const cases = [
    ['unknown schema', (lock) => { lock.schema += '-unknown'; }, /schema/],
    ['other repository', (lock) => { lock.sourceRepository = 'untrusted/tachiko-work'; }, /repository/],
    ['other public entry', (lock) => { lock.entry = 'private.js'; }, /public entry/],
    ['product PASS claim', (lock) => { lock.qualificationStatus = 'Sheet product PASS'; }, /product acceptance separate/],
    ['self-consistent unknown source', (lock) => { lock.sourceCommit = lock.qualificationArtifactReview.sourceCommit = '0'.repeat(40); }, /one qualified artifact/],
    ['self-consistent unknown manifest', (lock) => { lock.artifactManifestSha256 = lock.qualificationArtifactReview.artifactManifestSha256 = '0'.repeat(64); }, /one qualified artifact/],
    ['mixed source and manifest', (lock) => { lock.artifactManifestSha256 = lock.qualificationArtifactReview.artifactManifestSha256 = other.artifactManifestSha256; }, /one qualified artifact/],
    ['missing review', (lock) => { delete lock.qualificationArtifactReview; }, /canonical review URL/],
    ['stale review source', (lock) => { lock.qualificationArtifactReview.sourceCommit = other.sourceCommit; }, /pinned source/],
    ['stale review manifest', (lock) => { lock.qualificationArtifactReview.artifactManifestSha256 = other.artifactManifestSha256; }, /manifest/],
    ['cross-artifact review', (lock) => { lock.qualificationArtifactReview.url = other.review; }, /canonical review URL/],
    ['arbitrary same-PR review', (lock) => { lock.qualificationArtifactReview.url = fixture.review.replace(/\d+$/, '1'); }, /canonical review URL/],
    ['review URL lookalike', (lock) => { lock.qualificationArtifactReview.url = fixture.review.replace('github.com/', 'github.com.evil.invalid/'); }, /canonical review URL/],
    ['review suffix', (lock) => { lock.qualificationArtifactReview.url += '?approved=true'; }, /canonical review URL/],
    ['missing handback', (lock) => { delete lock.qualificationHandback; }, /handback source/],
    ['cross-artifact handback', (lock) => { lock.qualificationHandback = other.handback; }, /handback source/],
    ['arbitrary same-issue handback', (lock) => { lock.qualificationHandback = fixture.handback.replace(/\d+$/, '1'); }, /handback source/],
    ['handback suffix', (lock) => { lock.qualificationHandback += '/extra'; }, /handback source/],
  ];
  for (const [name, alter, expected] of cases) {
    test(`${fixture.name}: reject ${name}`, () => {
      const lock = lockFor(fixture);
      alter(lock);
      assert.throws(() => validateCoreKitProvenance(lock), expected);
    });
  }
}

test('same-source rebuilt and cloud-tested kits never share receipts', () => {
  const [tested, rebuilt] = [fixtures[1], fixtures[2]];
  for (const [bytes, receipts] of [[rebuilt, tested], [tested, rebuilt]]) {
    const review = lockFor(bytes);
    review.qualificationArtifactReview.url = receipts.review;
    assert.throws(() => validateCoreKitProvenance(review), /canonical review URL/);
    const handback = lockFor(bytes);
    handback.qualificationHandback = receipts.handback;
    assert.throws(() => validateCoreKitProvenance(handback), /handback source/);
    const manifest = lockFor(receipts);
    manifest.artifactManifestSha256 = manifest.qualificationArtifactReview.artifactManifestSha256 = bytes.artifactManifestSha256;
    assert.throws(() => validateCoreKitProvenance(manifest), /canonical review URL/);
  }
});

test('reject merge SHA substituted for the tested kit source even when its tree matches', () => {
  const lock = lockFor(fixtures[1]);
  lock.sourceCommit = lock.qualificationArtifactReview.sourceCommit =
    'a4fc7845456205c541c6f0c393235f0d75adb459';
  assert.throws(() => validateCoreKitProvenance(lock), /one qualified artifact/);
});

async function runWithLock(t, lock, kit = path.join(root, 'public/core-kit')) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tachiko-sheet-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lockPath = path.join(directory, 'core-kit.lock.json');
  await writeFile(lockPath, JSON.stringify(lock));
  return run(process.execPath, [path.join(root, 'scripts/verify-core-kit.mjs')], {
    cwd: root,
    env: { ...process.env, WORK_CORE_KIT_LOCK: lockPath, WORK_CORE_KIT: kit },
    timeout: 10000,
  });
}

test('CLI rejects the historical stale artifact review URL', async (t) => {
  const lock = lockFor(fixtures[0]);
  lock.qualificationArtifactReview.url =
    'https://github.com/nurockplayer/tachiko-work/pull/369#issuecomment-5644131034';
  await assert.rejects(runWithLock(t, lock), /canonical review URL/);
});

test('CLI verifies the shipped lock and complete C1 inventory', async (t) => {
  const lock = JSON.parse(await readFile(path.join(root, 'core-kit.lock.json'), 'utf8'));
  const { stdout } = await runWithLock(t, lock);
  assert.match(stdout, /qualified core-kit trust pin/);
  assert.match(stdout, /C1 artifact integrity/);
  assert.match(stdout, new RegExp(lock.sourceCommit));
});

test('CLI rejects a qualified lock paired with the other artifact bytes', async (t) => {
  const shipped = JSON.parse(await readFile(path.join(root, 'core-kit.lock.json'), 'utf8'));
  const other = fixtures.find((fixture) => fixture.sourceCommit !== shipped.sourceCommit);
  assert.ok(other, 'negative control requires a different qualified source');
  await assert.rejects(runWithLock(t, lockFor(other)), /Qualified kit manifest digest mismatch/);
});

test('CLI delegates asset integrity and rejects altered bytes under an intact manifest', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tachiko-sheet-kit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifestBytes = await readFile(path.join(root, 'public/core-kit/artifact-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.files[0].path, 'README.md');
  await writeFile(path.join(directory, 'artifact-manifest.json'), manifestBytes);
  await writeFile(path.join(directory, 'README.md'), 'unqualified altered bytes');
  const lock = JSON.parse(await readFile(path.join(root, 'core-kit.lock.json'), 'utf8'));
  await assert.rejects(runWithLock(t, lock, directory), /Digest mismatch: README.md/);
});
