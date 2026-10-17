// CI engineering evidence only. No release, human qualification or E2E binary upload.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureRunnerCommand, createRunnerCancellation } from './runner-process-lifecycle.mjs';

export const OUTPUT_LIMIT = 256 * 1024;
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceRoot = path.join(root, 'desktop-evidence');
const bundleRoot = path.join(root, 'src-tauri/target/aarch64-apple-darwin/release/bundle');
export const productionFiles = ['Tachiko-Sheet.dmg', 'identity.json', 'ENGINEERING-NOTICE.txt'];
export const lifecycleFiles = ['run.json', 'identity.json', 'lifecycle.json', 'direct-result.json', 'stdout-stderr.log', 'host.log', 'diagnostics.json'];
export const engineeringNotice = `Repository-visible CI engineering artifact; retained for 14 days from upload.\nEngineering Desktop Preview: ad-hoc signed, not notarized. This is not a qualified public release.\nE2E lifecycle evidence concerns a distinct test app, not this production DMG's Finder, native panels, IME, accessibility or human walkthrough.\nBundled third-party notices remain inside the app. Download and inspect this exact DMG before making package qualification claims.\n`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
export function boundedText(value) {
  const bytes = Buffer.from(String(value));
  let start = Math.max(0, bytes.length - OUTPUT_LIMIT);
  // Decode only complete UTF-8 codepoints; replacement characters can expand
  // a truncated prefix beyond the byte limit.
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString();
}

export function macCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

export async function regularFile(file) {
  assert.ok((await lstat(file)).isFile(), `expected regular file: ${file}`);
  return readFile(file);
}

export async function sourceIdentity(repo = root, env = process.env, command = macCommand) {
  const git = (...args) => command('git', ['-C', repo, ...args]);
  return {
    checkoutCommit: git('rev-parse', 'HEAD'), checkoutTree: git('rev-parse', 'HEAD^{tree}'),
    github: {
      repository: env.GITHUB_REPOSITORY ?? null, runId: env.GITHUB_RUN_ID ?? null,
      runAttempt: env.GITHUB_RUN_ATTEMPT ?? null, event: env.GITHUB_EVENT_NAME ?? null,
      workflowSha: env.GITHUB_SHA ?? null, ref: env.GITHUB_REF ?? null,
      prHead: env.EVIDENCE_PR_HEAD || null, prBase: env.EVIDENCE_PR_BASE || null,
    },
    runner: { os: command('sw_vers', []), kernel: command('uname', ['-mrs']), imageOS: env.ImageOS ?? null, imageVersion: env.ImageVersion ?? null },
  };
}

export async function workIdentity(repo = root) {
  const lock = await json(path.join(repo, 'core-kit.lock.json'));
  const kitBytes = await regularFile(path.join(repo, lock.artifactManifest));
  const kit = JSON.parse(kitBytes);
  const cargoBytes = await regularFile(path.join(repo, 'src-tauri/Cargo.lock'));
  const sources = [...new Set([...cargoBytes.toString().matchAll(/^source = "git\+https:\/\/github\.com\/nurockplayer\/tachiko-work\?rev=([0-9a-f]{40})#([0-9a-f]{40})"$/gm)].map(match => {
    assert.equal(match[1], match[2], 'native Work requested and resolved revisions differ');
    return match[2];
  }))];
  assert.deepEqual(sources, [lock.sourceCommit], 'native Work/kit source mismatch');
  assert.equal(kit.sourceRepository, lock.sourceRepository, 'kit repository mismatch');
  assert.equal(kit.sourceCommit, lock.sourceCommit, 'native Work/kit manifest mismatch');
  assert.equal(sha256(kitBytes), lock.artifactManifestSha256, 'kit manifest hash mismatch');
  return { nativeResolvedCommit: sources[0], cargoLockSha256: sha256(cargoBytes), kitSourceCommit: kit.sourceCommit, kitManifestSha256: sha256(kitBytes) };
}

export async function appIdentity(app, kind, command = macCommand) {
  assert.ok(['production', 'e2e'].includes(kind), 'unknown app kind');
  const plistFile = path.join(app, 'Contents/Info.plist');
  await regularFile(plistFile);
  const plist = JSON.parse(command('plutil', ['-convert', 'json', '-o', '-', plistFile]));
  const expectedId = kind === 'production' ? 'dev.tachiko.sheet' : 'dev.tachiko.sheet.e2e';
  assert.equal(plist.CFBundleIdentifier, expectedId, `${kind} bundle ID mismatch`);
  assert.ok(plist.CFBundleShortVersionString && plist.CFBundleVersion, 'missing bundled version');
  assert.ok(plist.CFBundleExecutable && path.basename(plist.CFBundleExecutable) === plist.CFBundleExecutable, 'invalid bundled executable');
  const executable = path.join(app, 'Contents/MacOS', plist.CFBundleExecutable);
  const executableBytes = await regularFile(executable);
  const architectures = command('lipo', ['-archs', executable]).split(/\s+/).sort();
  assert.deepEqual(architectures, ['arm64'], 'packaged Mach-O is not Apple Silicon');
  command('codesign', ['--verify', '--deep', '--strict', app]);
  const details = command('codesign', ['-dv', '--verbose=4', app]);
  assert.ok(details.split('\n').includes(`Identifier=${expectedId}`), 'signature identifier mismatch');
  assert.match(details, /Signature=adhoc/, 'expected ad-hoc preview signature');
  return { kind, bundleId: plist.CFBundleIdentifier, version: plist.CFBundleShortVersionString, buildVersion: plist.CFBundleVersion, executable: plist.CFBundleExecutable, executableSha256: sha256(executableBytes), architectures, signature: { verification: 'PASS', status: 'ad-hoc; not notarized', details: boundedText(details) } };
}

export async function stageProduction({ repo = root, bundles = bundleRoot, directory = path.join(evidenceRoot, 'production'), command = macCommand, env = process.env } = {}) {
  const dmgDir = path.join(bundles, 'dmg');
  const dmgs = (await readdir(dmgDir)).filter(name => name.endsWith('.dmg'));
  assert.equal(dmgs.length, 1, 'expected exactly one production DMG');
  const dmg = await regularFile(path.join(dmgDir, dmgs[0]));
  const identity = {
    schema: 'sheet-desktop-production-v1', source: await sourceIdentity(repo, env, command),
    work: await workIdentity(repo), buildCommand: 'pnpm desktop:build',
    app: await appIdentity(path.join(bundles, 'macos/Tachiko Sheet.app'), 'production', command),
    dmg: { file: productionFiles[0], originalName: dmgs[0], sha256: sha256(dmg), bytes: dmg.length },
  };
  await mkdir(directory, { recursive: true });
  await copyFile(path.join(dmgDir, dmgs[0]), path.join(directory, productionFiles[0]));
  await writeJson(path.join(directory, 'identity.json'), identity);
  await writeFile(path.join(directory, 'ENGINEERING-NOTICE.txt'), engineeringNotice);
  await verifyProduction(directory);
  return identity;
}

export async function verifyProduction(directory) {
  for (const file of productionFiles) await regularFile(path.join(directory, file));
  const identity = await json(path.join(directory, 'identity.json'));
  const bytes = await regularFile(path.join(directory, productionFiles[0]));
  assert.equal(identity.schema, 'sheet-desktop-production-v1');
  assert.equal(identity.app.bundleId, 'dev.tachiko.sheet');
  assert.equal(identity.dmg.file, productionFiles[0]);
  assert.equal(sha256(bytes), identity.dmg.sha256, 'staged DMG bytes changed');
  assert.equal(bytes.length, identity.dmg.bytes, 'staged DMG size changed');
  assert.equal(await readFile(path.join(directory, 'ENGINEERING-NOTICE.txt'), 'utf8'), engineeringNotice);
  return identity;
}

export function lifecycleVerdict(execution, direct) {
  if (execution.code !== 0 || execution.signal || execution.outcome !== 'EXITED') return 'FAIL';
  if (direct?.schema !== 'sheet-desktop-direct-result-v1' || direct.status !== 'PASS' || direct.cleanup?.status !== 'PASS') return 'FAIL';
  return 'PASS';
}

export async function initializeEvidence(directory = path.join(evidenceRoot, 'e2e')) {
  await mkdir(directory, { recursive: true });
  await writeJson(path.join(directory, 'run.json'), await sourceIdentity());
  await writeJson(path.join(directory, 'identity.json'), { status: 'NOT RUN', reason: 'E2E build/identity not completed' });
  await writeJson(path.join(directory, 'lifecycle.json'), { status: 'BLOCKED', execution: 'NOT RUN', reason: 'build or prerequisite gate not completed' });
  await writeJson(path.join(directory, 'direct-result.json'), { status: 'NOT RUN' });
  await writeJson(path.join(directory, 'diagnostics.json'), []);
  await writeFile(path.join(directory, 'stdout-stderr.log'), '');
  await writeFile(path.join(directory, 'host.log'), '');
}

export async function captureE2eIdentity(directory = path.join(evidenceRoot, 'e2e'), command = macCommand) {
  const identity = { schema: 'sheet-desktop-e2e-v1', source: await sourceIdentity(root, process.env, command), work: await workIdentity(), buildCommand: 'pnpm desktop:build:e2e', app: await appIdentity(path.join(bundleRoot, 'macos/Tachiko Sheet E2E.app'), 'e2e', command) };
  await writeJson(path.join(directory, 'identity.json'), identity);
}

export async function runLifecycle(directory = path.join(evidenceRoot, 'e2e'), capture = captureRunnerCommand) {
  const identity = await json(path.join(directory, 'identity.json'));
  assert.equal(identity.app?.bundleId, 'dev.tachiko.sheet.e2e', 'missing E2E identity');
  const cancellation = createRunnerCancellation();
  let execution;
  try {
    execution = await capture('caffeinate', ['-dimu', process.execPath, 'tests/desktop/packaged-lifecycle.mjs', path.join(bundleRoot, 'macos/Tachiko Sheet E2E.app')], {
      cwd: root, timeoutMs: 45 * 60 * 1000, maxOutputBytes: OUTPUT_LIMIT, signal: cancellation.signal,
      env: { DESKTOP_DIRECT_RESULT: path.join(directory, 'direct-result.json'), DESKTOP_KEEP_LOG: path.join(directory, 'host.log') },
    });
  } catch (error) {
    execution = { code: 125, signal: null, outcome: 'CAPTURE_FAILED', output: '', error: boundedText(error.stack) };
  } finally { cancellation.dispose(); }
  await writeFile(path.join(directory, 'stdout-stderr.log'), boundedText(execution.output ?? ''));
  // stdout/stderr are deliberately combined in order, with a bounded tail.
  let direct = null;
  let directReadError;
  try { direct = await json(path.join(directory, 'direct-result.json')); }
  catch (error) { directReadError = boundedText(error.message).slice(-16384); }
  const diagnostics = [];
  if (execution.error) diagnostics.push({ phase: 'process', error: boundedText(execution.error).slice(-16384) });
  if (direct?.error) diagnostics.push({ phase: 'lifecycle', error: boundedText(direct.error).slice(-16384) });
  if (direct?.cleanup?.status !== 'PASS') diagnostics.push({ phase: 'app-cleanup', status: direct?.cleanup?.status ?? 'UNKNOWN', errors: direct?.cleanup?.errors ?? [] });
  if (direct?.schema !== 'sheet-desktop-direct-result-v1') diagnostics.push({ phase: 'direct-result', error: directReadError ?? 'No completed direct lifecycle result' });
  await writeJson(path.join(directory, 'diagnostics.json'), diagnostics);
  const { bytes: _bytes, output: _output, ...processOutcome } = execution;
  const result = { schema: 'sheet-desktop-lifecycle-v1', status: lifecycleVerdict(execution, direct), process: processOutcome, directResultStatus: direct?.status ?? 'MISSING', appCleanup: direct?.cleanup ?? { status: 'UNKNOWN' } };
  await writeJson(path.join(directory, 'lifecycle.json'), result);
  console.log(execution.output ?? '');
  console.log(JSON.stringify(result));
  return result;
}

export async function verifyLifecycle(directory) {
  for (const file of lifecycleFiles) {
    const bytes = await regularFile(path.join(directory, file));
    assert.ok(bytes.length <= (file === 'direct-result.json' ? 2 * OUTPUT_LIMIT : OUTPUT_LIMIT), `unbounded evidence: ${file}`);
  }
  const outcome = await json(path.join(directory, 'lifecycle.json'));
  if (outcome.status === 'BLOCKED') {
    assert.equal(outcome.execution, 'NOT RUN');
    return outcome;
  }
  const identity = await json(path.join(directory, 'identity.json'));
  assert.equal(identity.app.bundleId, 'dev.tachiko.sheet.e2e');
  const direct = await json(path.join(directory, 'direct-result.json'));
  assert.equal(outcome.status, lifecycleVerdict(outcome.process, direct), 'lifecycle status contradicts actual result');
  return outcome;
}

async function main(mode) {
  const directory = path.join(evidenceRoot, 'e2e');
  if (mode === 'init') return initializeEvidence();
  if (mode === 'production') return stageProduction();
  if (mode === 'e2e-identity') return captureE2eIdentity();
  if (mode === 'lifecycle') { const result = await runLifecycle(); if (result.status !== 'PASS') process.exitCode = 1; return; }
  if (mode === 'verify-production') return verifyProduction(path.join(evidenceRoot, 'production'));
  if (mode === 'verify-e2e') {
    const outcome = await verifyLifecycle(directory);
    // If the lifecycle step ran, a missing/unfinished outer receipt cannot be BLOCKED.
    if (process.env.EVIDENCE_LIFECYCLE_OUTCOME && !['skipped', ''].includes(process.env.EVIDENCE_LIFECYCLE_OUTCOME)) assert.notEqual(outcome.status, 'BLOCKED', 'lifecycle ran without final evidence');
    return;
  }
  throw new Error(`unknown desktop evidence mode: ${mode}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv[2]);
