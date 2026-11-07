// Generates THIRD_PARTY_LICENSES.md: the locked, shipped dependency closure of
// the three desktop targets plus the production JavaScript dependencies of the
// page, with license and notice text byte-for-byte from `cargo vendor` and each
// package's node_modules LICENSE file.
//
// Usage:
//   node scripts/generate-third-party-licenses.mjs            # write both copies
//   node scripts/generate-third-party-licenses.mjs --check    # fail on any difference
//
// Text for a package that ships no LICENSE, COPYING or NOTICE file comes from
// scripts/third-party-overrides/<name>-<version>/: files fetched from upstream,
// next to a SOURCE file naming the URL and the exact tag or commit. The
// generator fails rather than omit anything.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const outputFile = 'THIRD_PARTY_LICENSES.md';
const publicCopy = 'public/THIRD_PARTY_LICENSES.md';

const TARGETS = [
  'x86_64-apple-darwin',
  'aarch64-apple-darwin',
  'x86_64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu',
];

// Licenses we may ship. Anything else stops the generator; a lead decides
// whether to add it. Copyleft stays out of the list on purpose.
export const ALLOWED_LICENSES = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'Apache-2.0 WITH LLVM-exception',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'Zlib',
  'Unicode-3.0',
  'Unicode-DFS-2016',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BSL-1.0',
]);

// Reviewed one by one: sheet-lead decision on PR #321. A version bump fails CI until reviewed.
// These are unmodified. If one is ever patched here, the patched files stay MPL-2.0 and their source must be published.
export const MPL_EXCEPTIONS = new Map([
  ['cssparser@0.37.0', 'https://github.com/servo/rust-cssparser'],
  ['cssparser-macros@0.7.1', 'https://github.com/servo/rust-cssparser'],
  ['dtoa-short@0.3.5', 'https://github.com/upsuper/dtoa-short'],
  ['option-ext@0.2.0', 'https://github.com/soc/option-ext'],
  ['selectors@0.38.0', 'https://github.com/servo/stylo'],
]);

// Both repositories are dual-licensed; the git dependency keeps its own
// workspace license while the Sheet crate declares its own.
const FIRST_PARTY_DEFAULT_LICENSE = 'Apache-2.0 OR MIT';
const FIRST_PARTY_LICENSE_FILES = ['public/core-kit/notices/LICENSE-MIT', 'public/core-kit/notices/LICENSE-APACHE'];

function fail(message) {
  console.error(`generate-third-party-licenses: ${message}`);
  process.exit(1);
}

function run(command, args) {
  try {
    return execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const stderr = String(error.stderr ?? '').trim();
    fail(`${command} ${args.join(' ')} failed${stderr ? `:\n${stderr}` : ''}`);
  }
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const normalizeEol = (text) => text.replace(/\r\n?/g, '\n');

// SPDX expressions: OR passes if one side passes, AND needs every side, and
// the pre-SPDX `A/B` form reads as OR. `WITH` is part of the license id.
function tokensOf(expression) {
  const spaced = expression.replace(/(\S)\s*\/\s*(?=[(A-Za-z0-9])/g, '$1 OR ');
  return spaced.replace(/([()])/g, ' $1 ').trim().split(/\s+/).filter(Boolean);
}

function parseTerm(tokens, state) {
  const token = tokens[state.index++];
  if (token === '(') {
    const value = parseExpression(tokens, state);
    if (tokens[state.index] !== ')') throw new Error(`missing ")" in "${tokens.join(' ')}"`);
    state.index++;
    return value;
  }
  if (!token || token === ')' || token === 'OR' || token === 'AND') throw new Error(`expected a license id in "${tokens.join(' ')}"`);
  let id = token;
  if (tokens[state.index] === 'WITH') {
    state.index++;
    id = `${id} WITH ${tokens[state.index++]}`;
  }
  return ALLOWED_LICENSES.has(id);
}

// SPDX binds AND tighter than OR.
function parseAnd(tokens, state) {
  let value = parseTerm(tokens, state);
  while (tokens[state.index] === 'AND') {
    state.index++;
    value = parseTerm(tokens, state) && value;
  }
  return value;
}

function parseExpression(tokens, state) {
  let value = parseAnd(tokens, state);
  while (tokens[state.index] === 'OR') {
    state.index++;
    value = parseAnd(tokens, state) || value;
  }
  return value;
}

/** True when every clause of the expression is allow-listed. */
export function isAllowedLicenseExpression(expression) {
  const tokens = tokensOf(expression);
  if (tokens.length === 0) return false;
  const state = { index: 0 };
  const allowed = parseExpression(tokens, state);
  if (state.index !== tokens.length) throw new Error(`unexpected "${tokens[state.index]}" in "${expression}"`);
  return allowed;
}

/**
 * True when the package may ship: its expression is allow-listed, or it is a
 * reviewed MPL-2.0 crates.io package at exactly the recorded name@version.
 */
export function isAllowedPackage(name, version, license) {
  try {
    if (isAllowedLicenseExpression(license)) return true;
  } catch (error) {
    fail(`${name} ${version} has an unparseable license expression "${license}": ${error.message}`);
  }
  return license === 'MPL-2.0' && MPL_EXCEPTIONS.has(`${name}@${version}`);
}

function targetTrees() {
  const packages = new Map();
  const manifest = path.join(repoRoot, 'src-tauri', 'Cargo.toml');
  for (const target of TARGETS) {
    const output = run('cargo', [
      'tree',
      '--manifest-path', manifest,
      '--locked',
      '--edges', 'normal',
      '--no-dedupe',
      '--prefix', 'none',
      '--format', '{p}|{l}',
      '--target', target,
    ]);
    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      const separator = line.lastIndexOf('|');
      if (separator < 0) fail(`could not parse cargo tree output: ${line}`);
      let display = line.slice(0, separator).trim();
      const license = line.slice(separator + 1).trim();
      if (display.endsWith(' (proc-macro)')) display = display.slice(0, -' (proc-macro)'.length);
      const match = display.match(/^(\S+) v(\S+?)(?: \((.*)\))?$/);
      if (!match) fail(`could not parse cargo tree package: ${line}`);
      const [, name, version, source = ''] = match;
      const key = `${name}|${version}`;
      const current = packages.get(key);
      if (current && current.license && license && current.license !== license) {
        fail(`${name} ${version} declares both "${current.license}" and "${license}" across targets`);
      }
      packages.set(key, { name, version, license: current?.license || license, source: current?.source || source });
    }
  }
  return [...packages.values()];
}

function lockedSources() {
  const lock = readFileSync(path.join(repoRoot, 'src-tauri', 'Cargo.lock'), 'utf8');
  const sources = new Map();
  for (const block of lock.split('[[package]]').slice(1)) {
    const name = block.match(/^name = "(.+)"$/m)?.[1];
    const version = block.match(/^version = "(.+)"$/m)?.[1];
    if (!name || !version) continue;
    const source = block.match(/^source = "(.+)"$/m)?.[1] ?? 'path';
    const key = `${name}|${version}`;
    if (sources.has(key) && sources.get(key) !== source) fail(`ambiguous locked source for ${name} ${version}`);
    sources.set(key, source);
  }
  return sources;
}

function describeSource(source) {
  if (source === 'path') return 'This repository (src-tauri)';
  if (source.startsWith('git+')) {
    const [url, revision] = source.slice('git+'.length).split('#');
    return `Git ${url.split('?')[0]} at ${revision}`;
  }
  return source;
}

const CODE_EXTENSIONS = new Set([
  '.rs', '.c', '.h', '.cc', '.cpp', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py',
  '.sh', '.toml', '.json', '.yml', '.yaml', '.html', '.css', '.java', '.go',
]);
const LICENSE_BASENAME = /^(licen[cs]e|unlicen[cs]e|copying|notice|copyright)([-_.][^/]*)?$/i;

/**
 * True when the file name is an actual license or notice text. A source file
 * such as `src/copying.rs` is never license text, whatever its name starts with.
 */
export function isLicenseFile(name) {
  const base = path.basename(name);
  const extension = path.extname(base).toLowerCase();
  if (extension && CODE_EXTENSIONS.has(extension)) return false;
  return LICENSE_BASENAME.test(base);
}

async function licenseFiles(directory, depth) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0) found.push(...(await licenseFiles(full, depth - 1)));
      continue;
    }
    if (isLicenseFile(entry.name)) found.push(full);
  }
  return found;
}

async function overrideText(name, version) {
  const directory = path.join(scriptDir, 'third-party-overrides', `${name}-${version}`);
  if (!existsSync(directory)) return null;
  const sourceFile = path.join(directory, 'SOURCE');
  const licenseFile = path.join(directory, 'LICENSE');
  if (!existsSync(sourceFile) || !existsSync(licenseFile)) {
    fail(`override for ${name} ${version} needs both LICENSE and SOURCE`);
  }
  const fields = {};
  for (const line of (await readFile(sourceFile, 'utf8')).split('\n')) {
    const match = line.match(/^(url|revision|mit-text|attribution):\s*(.+)$/);
    if (match) fields[match[1]] = match[2].trim();
  }
  if (!fields.url || !fields.revision) fail(`override SOURCE for ${name} ${version} needs url: and revision: lines`);
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== 'SOURCE')
    .map((entry) => entry.name)
    .sort(compare);
  const files = await Promise.all(
    names.map(async (file) => ({
      label: `scripts/third-party-overrides/${name}-${version}/${file}`,
      text: await readFile(path.join(directory, file), 'utf8'),
    })),
  );
  return {
    files,
    url: fields.url,
    revision: fields.revision,
    mitText: fields['mit-text'],
    attribution: fields.attribution,
  };
}

async function rustInventory(vendorDir) {
  const packages = targetTrees();
  const locked = lockedSources();
  const rows = [];
  const firstParty = [];
  const overrides = [];
  for (const entry of packages) {
    const lockedSource = locked.get(`${entry.name}|${entry.version}`);
    if (!lockedSource) fail(`cargo tree package is missing a locked source: ${entry.name} ${entry.version}`);
    const isFirstParty = entry.name.startsWith('tachiko-');
    const row = {
      name: entry.name,
      version: entry.version,
      license: entry.license || (isFirstParty ? FIRST_PARTY_DEFAULT_LICENSE : ''),
      source: describeSource(lockedSource),
      files: [],
    };
    if (!row.license) fail(`${entry.name} ${entry.version} declares no license`);
    if (isFirstParty) {
      row.defaultTexts = FIRST_PARTY_LICENSE_FILES;
      firstParty.push(row);
      continue;
    }
    const directory = path.join(vendorDir, `${entry.name}-${entry.version}`);
    if (!existsSync(directory)) fail(`locked package was not found in cargo vendor output: ${entry.name} ${entry.version}`);
    const files = await licenseFiles(directory, Infinity);
    if (files.length > 0) {
      row.files = await Promise.all(
        files.sort(compare).map(async (file) => ({
          label: path.relative(directory, file).split(path.sep).join('/'),
          text: await readFile(file, 'utf8'),
        })),
      );
    } else {
      const override = await overrideText(entry.name, entry.version);
      if (!override) {
        fail(`${entry.name} ${entry.version} ships no LICENSE, COPYING or NOTICE file and has no scripts/third-party-overrides/${entry.name}-${entry.version} (declared license: ${row.license})`);
      }
      overrides.push({
        name: entry.name,
        version: entry.version,
        url: override.url,
        revision: override.revision,
        mitText: override.mitText,
        attribution: override.attribution,
      });
      row.files = override.files;
    }
    rows.push(row);
  }
  return { rows, firstParty, overrides };
}

function pnpmLicenses() {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const output = run(command, ['licenses', 'list', '--prod', '--json']);
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    fail(`pnpm licenses list --prod --json did not return JSON:\n${output.slice(0, 500)}`);
  }
  const packages = [];
  for (const [license, entries] of Object.entries(parsed)) {
    for (const entry of entries) {
      for (const directory of entry.paths ?? []) {
        let manifest;
        try {
          manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
        } catch {
          fail(`could not read the package manifest at ${directory}`);
        }
        packages.push({ name: manifest.name, version: manifest.version, license: entry.license || license, directory });
      }
    }
  }
  return packages;
}

async function jsInventory() {
  const packages = pnpmLicenses();
  const rows = [];
  const overrides = [];
  for (const entry of packages) {
    if (!entry.license) fail(`${entry.name} ${entry.version} declares no license`);
    const files = (await licenseFiles(entry.directory, 0)).sort(compare);
    const row = { name: entry.name, version: entry.version, license: entry.license, source: 'npm (production)', files: [] };
    if (files.length > 0) {
      row.files = await Promise.all(files.map(async (file) => ({ label: path.basename(file), text: await readFile(file, 'utf8') })));
    } else {
      const override = await overrideText(entry.name, entry.version);
      if (!override) fail(`${entry.name} ${entry.version} ships no LICENSE file and has no scripts/third-party-overrides/${entry.name}-${entry.version} (declared license: ${row.license})`);
      overrides.push({
        name: entry.name,
        version: entry.version,
        url: override.url,
        revision: override.revision,
        mitText: override.mitText,
        attribution: override.attribution,
      });
      row.files = override.files;
    }
    rows.push(row);
  }
  const names = new Set(rows.map((row) => row.name));
  for (const required of ['react', 'react-dom']) {
    if (!names.has(required)) fail(`the production JavaScript dependency list does not contain ${required}`);
  }
  return { rows, overrides };
}

function markdownLink(text) {
  return text.replace(/\|/g, '\\|');
}

function render({ rust, js }) {
  const blocks = [];
  const push = (line = '') => blocks.push(line);
  const texts = new Map();
  const licenseRows = [];
  const addText = (row, file) => {
    const text = normalizeEol(file.text);
    const digest = sha256(text);
    const owner = `${row.name} ${row.version}`;
    if (!texts.has(digest)) texts.set(digest, { text, used: [] });
    if (!texts.get(digest).used.includes(`${owner} — ${file.label}`)) texts.get(digest).used.push(`${owner} — ${file.label}`);
    licenseRows.push({ package: owner, file: file.label, digest });
  };
  for (const row of rust.rows) for (const file of row.files) addText(row, file);
  for (const row of rust.firstParty) for (const file of row.defaultTexts) {
    addText(row, { label: file, text: readFileSync(path.join(repoRoot, file), 'utf8') });
  }
  for (const row of js.rows) for (const file of row.files) addText(row, file);

  push('<!-- Generated by scripts/generate-third-party-licenses.mjs. DO NOT EDIT. -->');
  push();
  push('# Third-Party Licenses');
  push();
  push('Tachiko Sheet ships this inventory for the three desktop targets (macOS universal,');
  push('Windows x64 and Linux x64) and for the production JavaScript dependencies of the');
  push('page. Package metadata comes from `cargo tree --locked --edges normal` over all');
  push('four targets and from `pnpm licenses list --prod`; license and notice text comes');
  push('byte-for-byte from `cargo vendor` and each package\'s LICENSE file. Packages that');
  push('ship no text take it from the upstream revision named in the override table.');
  push();
  push('Tachiko Work\'s kit notices (`public/core-kit/notices/`) sit beside this file.');
  push();
  push('Regenerate with `node scripts/generate-third-party-licenses.mjs`.');
  push();
  push('## First-party packages');
  push();
  push('| Package | Version | Declared license | Source |');
  push('| --- | --- | --- | --- |');
  for (const row of rust.firstParty.slice().sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version))) {
    push(`| \`${markdownLink(row.name)}\` | \`${markdownLink(row.version)}\` | ${markdownLink(row.license)} | ${markdownLink(row.source)} |`);
  }
  push();
  push('Their license texts are the MIT and Apache-2.0 files carried with the kit notices.');
  push();
  push('## Package inventory');
  push();
  push('| Package | Version | Declared license | Locked source |');
  push('| --- | --- | --- | --- |');
  const all = [...rust.rows, ...js.rows].sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version) || compare(a.source, b.source));
  for (const row of all) {
    push(`| \`${markdownLink(row.name)}\` | \`${markdownLink(row.version)}\` | ${markdownLink(row.license)} | ${markdownLink(row.source)} |`);
  }
  push();
  push('## License-text map');
  push();
  push('Each vendored or on-disk file maps to the exact text identified by its SHA-256 heading below. Identical files are stored once while every attribution is kept.');
  push();
  push('| Package | File | License-text SHA-256 |');
  push('| --- | --- | --- |');
  for (const row of licenseRows.slice().sort((a, b) => compare(a.package, b.package) || compare(a.file, b.file))) {
    push(`| \`${markdownLink(row.package)}\` | \`${markdownLink(row.file)}\` | \`${row.digest}\` |`);
  }
  if (rust.overrides.length + js.overrides.length > 0) {
    push();
    push('## License texts fetched from upstream');
    push();
    push('These packages ship no license file. The text was fetched from upstream, never written by hand.');
    push();
    push('| Package | Version | Upstream URL | Revision |');
    push('| --- | --- | --- | --- |');
    const overrides = [...rust.overrides, ...js.overrides].sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
    for (const row of overrides) {
      push(`| \`${markdownLink(row.name)}\` | \`${markdownLink(row.version)}\` | ${markdownLink(row.url)} | \`${markdownLink(row.revision)}\` |`);
    }
    const withMit = overrides.filter((row) => row.mitText && row.attribution);
    if (withMit.length > 0) {
      push();
      push('For these crates the upstream license above only links to the MIT text, so the file itself is carried here from the same upstream repository:');
      push();
      for (const row of withMit) {
        push(`- \`${markdownLink(row.name)} ${markdownLink(row.version)}\`: \`mit-text: ${markdownLink(row.mitText)}\`; \`attribution: ${markdownLink(row.attribution)}\``);
      }
    }
  }
  const mplRows = [...rust.rows, ...js.rows]
    .filter((row) => row.license === 'MPL-2.0' && MPL_EXCEPTIONS.has(`${row.name}@${row.version}`))
    .sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
  if (mplRows.length > 0) {
    push();
    push('## MPL-2.0 components');
    push();
    push('These crates are used unmodified. Their source for the exact version shipped is available at the download URL below, under the Mozilla Public License 2.0, whose text is in this file.');
    push();
    push('| Package | Version | Source download | Repository |');
    push('| --- | --- | --- | --- |');
    for (const row of mplRows) {
      const repository = MPL_EXCEPTIONS.get(`${row.name}@${row.version}`);
      push(`| \`${markdownLink(row.name)}\` | \`${markdownLink(row.version)}\` | https://static.crates.io/crates/${row.name}/${row.name}-${row.version}.crate | ${markdownLink(repository)} |`);
    }
  }
  push();
  push('## Exact license and notice texts');
  push();
  for (const digest of [...texts.keys()].sort(compare)) {
    const entry = texts.get(digest);
    const fence = '`'.repeat(Math.max(4, longestBacktickRun(entry.text) + 1));
    push(`### \`${digest}\``);
    push();
    push('Used by:');
    push();
    for (const used of entry.used.slice().sort(compare)) push(`- \`${used}\``);
    push();
    push(`${fence}text`);
    push(entry.text.replace(/\n$/, ''));
    push(fence);
    push();
  }
  return `${blocks.join('\n').replace(/\n+$/, '')}\n`;
}

function longestBacktickRun(text) {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

function requireAllowed(rows) {
  const refused = rows.filter((row) => !isAllowedPackage(row.name, row.version, row.license));
  if (refused.length > 0) {
    const listed = refused.map((row) => `${row.name} ${row.version} (${row.license})`).join('; ');
    fail(`${refused.length} package license(s) are outside the allow-list: ${listed}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--check']);
  for (const arg of args) if (!known.has(arg)) fail(`unknown argument: ${arg}`);
  const check = args.includes('--check');

  const work = await mkdtemp(path.join(tmpdir(), 'tachiko-sheet-notices-'));
  try {
    const vendorDir = path.join(work, 'vendor');
    await mkdir(vendorDir);
    run('cargo', [
      'vendor',
      '--manifest-path', path.join(repoRoot, 'src-tauri', 'Cargo.toml'),
      '--locked',
      '--versioned-dirs',
      vendorDir,
    ]);
    const rust = await rustInventory(vendorDir);
    const js = await jsInventory();
    requireAllowed([...rust.rows, ...rust.firstParty, ...js.rows]);
    const output = render({ rust, js });
    const mplExceptions = MPL_EXCEPTIONS.size;

    if (check) {
      const checked = path.join(work, outputFile);
      await writeFile(checked, output);
      for (const relative of [outputFile, publicCopy]) {
        const target = path.join(repoRoot, relative);
        const current = existsSync(target) ? await readFile(target, 'utf8') : null;
        if (current === null) fail(`${relative} is missing; run the generator`);
        if (current !== output) fail(`${relative} differs from a fresh generation; run the generator`);
      }
      console.log(JSON.stringify({ status: 'PASS', crates: rust.rows.length + rust.firstParty.length, jsPackages: js.rows.length, overrides: rust.overrides.length + js.overrides.length, mplExceptions }));
      return;
    }

    for (const relative of [outputFile, publicCopy]) {
      const target = path.join(repoRoot, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, output);
    }
    console.log(JSON.stringify({ status: 'WROTE', crates: rust.rows.length + rust.firstParty.length, jsPackages: js.rows.length, overrides: rust.overrides.length + js.overrides.length, mplExceptions }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
