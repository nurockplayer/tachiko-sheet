import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { captureRunnerCommand } from '../../scripts/runner-process-lifecycle.mjs';
import { appIdentity, boundedText, lifecycleFiles, lifecycleVerdict, OUTPUT_LIMIT, productionFiles, runLifecycle, stageProduction, verifyLifecycle, verifyProduction, workIdentity } from '../../scripts/desktop-evidence.mjs';

const commit = 'a'.repeat(40);
const successfulProcess = { code: 0, signal: null, outcome: 'EXITED' };
const successfulDirect = { schema: 'sheet-desktop-direct-result-v1', status: 'PASS', cleanup: { status: 'PASS' } };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (file, value) => writeFile(file, JSON.stringify(value));
async function fixture(t) {
  const repo = await mkdtemp(path.join(tmpdir(), 'sheet-desktop-evidence-test-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await mkdir(path.join(repo, 'public/core-kit'), { recursive: true });
  await mkdir(path.join(repo, 'src-tauri'), { recursive: true });
  const kit = JSON.stringify({ sourceRepository: 'nurockplayer/tachiko-work', sourceCommit: commit });
  await writeFile(path.join(repo, 'public/core-kit/artifact-manifest.json'), kit);
  await writeJson(path.join(repo, 'core-kit.lock.json'), { sourceRepository: 'nurockplayer/tachiko-work', sourceCommit: commit, artifactManifest: 'public/core-kit/artifact-manifest.json', artifactManifestSha256: sha(kit) });
  await writeFile(path.join(repo, 'src-tauri/Cargo.lock'), `[[package]]\nname = "tachiko-workspace-engine"\nsource = "git+https://github.com/nurockplayer/tachiko-work?rev=${commit}#${commit}"\n`);
  const bundles = path.join(repo, 'bundles');
  await mkdir(path.join(bundles, 'dmg'), { recursive: true });
  await writeFile(path.join(bundles, 'dmg/Sheet_0.1.0_aarch64.dmg'), 'production DMG fixture');
  for (const kind of ['production', 'e2e']) {
    const app = path.join(bundles, 'macos', kind === 'production' ? 'Tachiko Sheet.app' : 'Tachiko Sheet E2E.app');
    await mkdir(path.join(app, 'Contents/MacOS'), { recursive: true });
    await writeJson(path.join(app, 'Contents/Info.plist'), { CFBundleIdentifier: `dev.tachiko.sheet${kind === 'e2e' ? '.e2e' : ''}`, CFBundleExecutable: 'sheet', CFBundleShortVersionString: '0.1.0', CFBundleVersion: '1' });
    await writeFile(path.join(app, 'Contents/MacOS/sheet'), `distinct ${kind} executable`);
  }
  const command = (name, args) => {
    if (name === 'plutil') {
      const kind = args.at(-1).includes('E2E') ? 'e2e' : 'production';
      return JSON.stringify({ CFBundleIdentifier: `dev.tachiko.sheet${kind === 'e2e' ? '.e2e' : ''}`, CFBundleExecutable: 'sheet', CFBundleShortVersionString: '0.1.0', CFBundleVersion: '1' });
    }
    if (name === 'lipo') return 'arm64';
    if (name === 'codesign') return args[0] === '--verify' ? '' : `Identifier=dev.tachiko.sheet${args.at(-1).includes('E2E') ? '.e2e' : ''}\nSignature=adhoc`;
    if (name === 'git') return args.at(-1) === 'HEAD' ? commit : 'b'.repeat(40);
    if (name === 'sw_vers' || name === 'uname') return 'fixture macOS';
    throw new Error(`unexpected command: ${name}`);
  };
  return { repo, bundles, command, directory: path.join(repo, 'retained-production'), env: { GITHUB_SHA: 'c'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_EVENT_NAME: 'pull_request', EVIDENCE_PR_HEAD: 'd'.repeat(40), EVIDENCE_PR_BASE: 'e'.repeat(40) } };
}

test('stages immutable production bytes and keeps the separately built E2E identity distinct', async t => {
  const f = await fixture(t);
  const production = await stageProduction(f);
  const e2e = await appIdentity(path.join(f.bundles, 'macos/Tachiko Sheet E2E.app'), 'e2e', f.command);
  assert.notEqual(production.app.bundleId, e2e.bundleId);
  assert.notEqual(production.app.executableSha256, e2e.executableSha256);
  assert.equal(production.app.signature.verification, 'PASS');
  assert.equal(production.source.checkoutCommit, commit);
  assert.notEqual(production.source.checkoutCommit, production.source.github.prHead);
  assert.equal(production.source.github.runAttempt, '2');
  assert.deepEqual(production.app.architectures, ['arm64']);
  // A later shared-output overwrite cannot change staged production bytes.
  await writeFile(path.join(f.bundles, 'dmg/Sheet_0.1.0_aarch64.dmg'), 'later output');
  await verifyProduction(f.directory);
  assert.equal(production.work.nativeResolvedCommit, commit);
});

test('missing DMG and absent individual production evidence fail rather than upload a manifest alone', async t => {
  const f = await fixture(t);
  await rm(path.join(f.bundles, 'dmg/Sheet_0.1.0_aarch64.dmg'));
  await assert.rejects(stageProduction(f), /exactly one production DMG/);
  await writeFile(path.join(f.bundles, 'dmg/Sheet.dmg'), 'fixture');
  await stageProduction(f);
  for (const file of productionFiles) {
    const target = path.join(f.directory, file);
    const bytes = await readFile(target);
    await rm(target);
    await assert.rejects(verifyProduction(f.directory), /ENOENT/);
    await writeFile(target, bytes);
  }
});

test('rejects wrong bundled ID, wrong Mach-O architecture and failed signature verification', async t => {
  const f = await fixture(t);
  const app = path.join(f.bundles, 'macos/Tachiko Sheet E2E.app');
  await assert.rejects(appIdentity(app, 'production', f.command), /bundle ID mismatch/);
  await assert.rejects(appIdentity(app, 'e2e', (name, args) => name === 'lipo' ? 'x86_64' : f.command(name, args)), /Mach-O/);
  await assert.rejects(appIdentity(app, 'e2e', (name, args) => {
    if (name === 'codesign' && args[0] === '--verify') throw new Error('invalid signature');
    return f.command(name, args);
  }), /invalid signature/);
});

test('rejects native resolved Work/kit mismatch and altered actual kit bytes', async t => {
  const f = await fixture(t);
  const cargo = path.join(f.repo, 'src-tauri/Cargo.lock');
  const original = await readFile(cargo, 'utf8');
  await writeFile(cargo, original.replaceAll(commit, 'f'.repeat(40)));
  await assert.rejects(workIdentity(f.repo), /native Work\/kit source mismatch/);
  await writeFile(cargo, original);
  const kit = path.join(f.repo, 'public/core-kit/artifact-manifest.json');
  await writeJson(kit, { sourceRepository: 'nurockplayer/tachiko-work', sourceCommit: 'f'.repeat(40) });
  await assert.rejects(workIdentity(f.repo), /kit manifest mismatch/);
  await writeJson(kit, { sourceRepository: 'nurockplayer/tachiko-work', sourceCommit: commit, altered: true });
  await assert.rejects(workIdentity(f.repo), /manifest hash mismatch/);
});

test('rejects altered staged DMG bytes', async t => {
  const f = await fixture(t);
  await stageProduction(f);
  await writeFile(path.join(f.directory, productionFiles[0]), 'altered bytes');
  await assert.rejects(verifyProduction(f.directory), /staged DMG bytes changed/);
});

test('actual process exit/signal and direct cleanup result control status, never printed PASS', () => {
  assert.equal(lifecycleVerdict(successfulProcess, successfulDirect), 'PASS');
  for (const processOutcome of [{ ...successfulProcess, code: 1, output: '{"status":"PASS"}' }, { ...successfulProcess, signal: 'SIGTERM' }, { ...successfulProcess, outcome: 'CLEANUP_FAILED' }, { ...successfulProcess, outcome: 'TIMEOUT' }]) {
    assert.equal(lifecycleVerdict(processOutcome, successfulDirect), 'FAIL');
  }
  for (const direct of [null, {}, { status: 'PASS' }, { ...successfulDirect, cleanup: { status: 'FAIL' } }, { ...successfulDirect, status: 'FAIL' }]) assert.equal(lifecycleVerdict(successfulProcess, direct), 'FAIL');
});

test('outer runner retains actual nonzero exit despite printed PASS and requires a direct result', async t => {
  const f = await fixture(t);
  const directory = path.join(f.repo, 'e2e');
  await mkdir(directory);
  await writeJson(path.join(directory, 'identity.json'), { app: { bundleId: 'dev.tachiko.sheet.e2e' } });
  let requested;
  const run = async (direct, code) => runLifecycle(directory, async (command, args, options) => {
    requested = { command, args, options };
    if (direct) await writeJson(options.env.DESKTOP_DIRECT_RESULT, direct);
    return { ...successfulProcess, code, output: '{"status":"PASS"}' };
  });
  assert.equal((await run(successfulDirect, 1)).status, 'FAIL');
  assert.equal(requested.command, 'caffeinate');
  assert.ok(requested.options.timeoutMs > 10 * 60 * 1000, 'must not inherit the generic 10-minute timeout');
  await rm(path.join(directory, 'direct-result.json'));
  assert.equal((await run(null, 0)).status, 'FAIL');
  assert.equal((await run({ ...successfulDirect, cleanup: { status: 'FAIL' } }, 0)).status, 'FAIL');
  assert.equal((await run(successfulDirect, 0)).status, 'PASS');
});

test('missing individual lifecycle evidence fails; contradictory final result fails', async t => {
  const f = await fixture(t);
  const directory = path.join(f.repo, 'e2e');
  await mkdir(directory);
  for (const file of lifecycleFiles) await writeFile(path.join(directory, file), '{}');
  await writeJson(path.join(directory, 'identity.json'), { app: { bundleId: 'dev.tachiko.sheet.e2e' } });
  await writeJson(path.join(directory, 'lifecycle.json'), { status: 'PASS', process: successfulProcess });
  await writeJson(path.join(directory, 'direct-result.json'), successfulDirect);
  await verifyLifecycle(directory);
  for (const file of lifecycleFiles) {
    const target = path.join(directory, file), bytes = await readFile(target);
    await rm(target);
    await assert.rejects(verifyLifecycle(directory), /ENOENT/);
    await writeFile(target, bytes);
  }
  await writeJson(path.join(directory, 'lifecycle.json'), { status: 'PASS', process: { ...successfulProcess, code: 1 } });
  await assert.rejects(verifyLifecycle(directory), /contradicts/);
  await writeJson(path.join(directory, 'lifecycle.json'), { status: 'BLOCKED', execution: 'NOT RUN' });
  assert.equal((await verifyLifecycle(directory)).status, 'BLOCKED');
});

test('retained diagnostic tails are bounded', () => {
  const value = boundedText('x'.repeat(OUTPUT_LIMIT * 2));
  assert.equal(Buffer.byteLength(value), OUTPUT_LIMIT);
  assert.ok(Buffer.byteLength(boundedText('雪'.repeat(OUTPUT_LIMIT))) <= OUTPUT_LIMIT);
});

test('workflow preserves gates, timeouts, permissions and exact narrow upload paths', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/desktop.yml', import.meta.url), 'utf8');
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /timeout-minutes: 45/);
  for (const gate of ['pnpm install --frozen-lockfile', 'pnpm typecheck', 'pnpm test:desktop-host', 'pnpm test:desktop-parity', 'pnpm desktop:build', 'pnpm desktop:build:e2e', 'node scripts/desktop-evidence.mjs lifecycle']) assert.ok(workflow.includes(gate), gate);
  assert.ok(workflow.indexOf('mjs production') < workflow.indexOf('run: pnpm desktop:build:e2e'));
  assert.ok(workflow.indexOf('mjs e2e-identity') < workflow.indexOf('mjs lifecycle'));
  assert.equal((workflow.match(/uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/g) ?? []).length, 2);
  assert.equal((workflow.match(/retention-days: 14/g) ?? []).length, 2);
  assert.equal((workflow.match(/if-no-files-found: error/g) ?? []).length, 2);
  assert.equal((workflow.match(/github.run_attempt/g) ?? []).length, 2);
  const paths = [...workflow.matchAll(/^            (desktop-evidence\/[^\n]+)$/gm)].map(match => match[1]);
  assert.deepEqual(paths, [...productionFiles.map(file => `desktop-evidence/production/${file}`), ...lifecycleFiles.map(file => `desktop-evidence/e2e/${file}`)]);
  assert.doesNotMatch(workflow, /continue-on-error|permissions: write|upload-artifact@main/);
});


test('real child exit and runner setup failure cannot be promoted by stdout PASS', async t => {
  const f = await fixture(t);
  const directory = path.join(f.repo, 'real-child-e2e');
  await mkdir(directory);
  await writeJson(path.join(directory, 'identity.json'), { app: { bundleId: 'dev.tachiko.sheet.e2e' } });
  await writeJson(path.join(directory, 'direct-result.json'), successfulDirect);
  const result = await runLifecycle(directory, (_command, _args, options) => captureRunnerCommand(process.execPath, ['-e', 'console.log("PASS"); console.error("stderr diagnostic"); process.exit(7)'], { ...options, timeoutMs: 5000 }));
  assert.equal(result.process.code, 7);
  assert.equal(result.status, 'FAIL');
  assert.match(await readFile(path.join(directory, 'stdout-stderr.log'), 'utf8'), /stderr diagnostic/);
  // Real packaged runner fails at its missing-app setup before it can emit a direct result.
  // This invokes no native command, browser, fixture generator or app.
  await rm(path.join(directory, 'direct-result.json'));
  const setupFailure = await runLifecycle(directory, (_command, _args, options) => captureRunnerCommand(process.execPath, ['tests/desktop/packaged-lifecycle.mjs', path.join(f.repo, 'missing.app')], { ...options, timeoutMs: 5000 }));
  assert.equal(setupFailure.process.code, 1);
  assert.equal(setupFailure.status, 'FAIL');
  assert.equal(setupFailure.directResultStatus, 'MISSING');
  assert.match(await readFile(path.join(directory, 'stdout-stderr.log'), 'utf8'), /packaged app not found/);
});
