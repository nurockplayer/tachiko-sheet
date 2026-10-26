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
    // Re-pin (Work #587/#588/#575/#590/#591): two clean detached lead exports
    // match byte for byte in all 25 files; receipt with inventory on #246.
    sourceCommit: '770dcf17d3e0dde97a3df90285bf78d708467c91',
    artifactManifestSha256: '17f76cf8537f4b6aed96afa80e632f3369daab3d45c1f49b94cc91bc08b50484',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/246#issuecomment-6423949352',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/246#issuecomment-6423949352',
  },
  {
    // Combined re-pin (Work #574/#580/#576/#583/#585/#586): two clean detached lead exports
    // match byte for byte in all 25 files; receipt with inventory on #246.
    sourceCommit: 'aac49a08da4b23a94f0279f01835c43a8596ccc9',
    artifactManifestSha256: 'b4c9ff7f8671a6ebd59bcb63457837f354e0ba1802b2ec8ec046ac043affb0e1',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/246#issuecomment-6407076552',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/246#issuecomment-6407076552',
  },
  {
    // #227 Rename: separate clean detached writer/lead builds; docs/227-rename-kit-handback.md.
    sourceCommit: '4e51942a6b8c83bb691bef4308b264d9104a18a5',
    artifactManifestSha256: 'd4c4bb7da05f906075bd93ecb99c1a4b64d348d0ed7130f3ce1b5f37c2a111b8',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/227#issuecomment-6292194963',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/227#issuecomment-6292194963',
  },
  {
    // #228 successor: independent clean writer/lead builds; docs/228-kit-handback.md.
    sourceCommit: '375da29f7c67ed74bace7d214ef23716d2e2237b',
    artifactManifestSha256: '43910ca78d2ac037215770a97f0bf4dc88d4114bbfa6b2ce5e64c868ddd075e3',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/228#issuecomment-6288021040',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/228#issuecomment-6288021040',
  },
  {
    // #228: separate clean detached writer/lead builds match; docs/228-kit-handback.md.
    sourceCommit: 'd0198466f0f6c1c2cac144e30ad9a20de119d7e6',
    artifactManifestSha256: 'b839f53f8196a182924e93a568fb4aa3bf305a83bf82215ec4dd6f1a38b4995a',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/228#issuecomment-6281604909',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/228#issuecomment-6281604909',
  },
  {
    // #225 / PR #226 inventory repair. Independent lead reproduction receipt;
    // writer byte identity and clean detached source proof: docs/225-kit-handback.md.
    sourceCommit: '353c6e948b78eeee07f6e77bd350a54070c1c280',
    artifactManifestSha256: 'a680af0a7f230b84e735fa2075360362c510139b49d5021f0101498c0d1268c3',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/225#issuecomment-6273009850',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/225#issuecomment-6273009850',
  },
  {
    // #225 producer. Independent lead reproduction receipt; writer byte identity
    // and clean detached source proof are recorded in docs/225-kit-handback.md.
    sourceCommit: '4e6b2c9d6aec069a0f5291fa0a1298d9fa095b6f',
    artifactManifestSha256: 'fd7d2655b53655a8022ecd0bcba0f8cd80dac43bc8fb1f7a59d3c68868abe180',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/225#issuecomment-6267426558',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/225#issuecomment-6267426558',
  },
  {
    // #215 producer. The existing lead receipt records acquisition and the
    // independent build; the writer's byte-identity proof is in docs/215-kit-handback.md.
    sourceCommit: '3d071dafc3166cd490b9ac03a67a7f4ec5dbafcf',
    artifactManifestSha256: 'a1c0a40798d541b620d6afe1a6bfd6671622ab39026d87ab00e2eb1596a721d7',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/215#issuecomment-6256396104',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/215#issuecomment-6256396104',
  },
  {
    // #199 producer. Review = the lead's independent byte-identical artifact
    // reproduction from a clean Work checkout; handback = the writer's acquisition.
    sourceCommit: 'abc2be6c5813771ea7b6c5b4a3292e9c72396b33',
    artifactManifestSha256: 'a98552ac69c9a33005f89d72b997a9b3afc0409937b217947e23e93e95ebe38f',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/199#issuecomment-6201033802',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/199#issuecomment-6200958431',
  },
  {
    // #197 producer. Review = the lead's independent byte-identical artifact
    // reproduction from a clean Work checkout; handback = the writer's acquisition.
    sourceCommit: 'd5dc6b8b48b14623f4acacd414c660f91b002e2f',
    artifactManifestSha256: '0e021a9ca97b2b8a599f941f26db9bc8a8d86e9b169b871facb6f215c2b5d603',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/197#issuecomment-6186306547',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/197#issuecomment-6186203372',
  },
  {
    // #195 producer. Review = the lead's independent byte-identical artifact
    // reproduction from a clean Work checkout; handback = the writer's acquisition.
    sourceCommit: '16545c55e49dfb4de5b55fd46e2260fd82ff4a58',
    artifactManifestSha256: '41f452f2d24d022e650124c27ad5bbc82865a1ee56f7bf86c5043228a31c07a7',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/195#issuecomment-6183108676',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/195#issuecomment-6182811855',
  },
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
  {
    sourceCommit: 'b1560ab4331847557f04dfd6833fbffcabfc1169',
    artifactManifestSha256: '94396e8fcd8cea32a4d120ca9087e0dde5bdd4adf2389f370eb1d6b96a2ff28a',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/160#issuecomment-6128045548',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/160#issuecomment-6128045548',
  },
  {
    sourceCommit: 'd60fc65bc0e6b78ceab5ddeff9afbc241f42fc1e',
    artifactManifestSha256: 'a374ba5d043b3e534f90ab1c34c5076bc8c05822eac3deddb737448d6af605b1',
    review: 'https://github.com/nurockplayer/tachiko-sheet/issues/131#issuecomment-6149346076',
    handback: 'https://github.com/nurockplayer/tachiko-sheet/issues/131#issuecomment-6149346076',
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
