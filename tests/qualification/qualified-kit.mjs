// Reads the recorded local qualification inventory. It is not a producer manifest.
import {createHash} from 'node:crypto';
import {lstat, readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const inventoryFile = fileURLToPath(new URL('../../evidence/core-kit-qualification.md', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function recordedQualifiedKitInventory() {
  const lines = (await readFile(inventoryFile, 'utf8')).split('\n');
  const start = lines.indexOf('| Asset | SHA-256 |');
  if (start === -1) throw new Error('Recorded qualified kit inventory is unavailable.');
  const assets = {};
  for (const line of lines.slice(start + 2)) {
    const match = /^\| `([^`]+)` \| `([a-f0-9]{64})` \|$/.exec(line);
    if (match === null) break;
    assets[match[1]] = match[2];
  }
  if (Object.keys(assets).length !== 21) throw new Error('Recorded qualified kit inventory must contain exactly 21 assets.');
  return assets;
}

async function scannedAssets(kitRoot) {
  const regular = {};
  const symlinked = [];
  const nonRegular = [];
  const root = await lstat(kitRoot);
  if (root.isSymbolicLink()) return {regular, symlinked: ['.'], nonRegular};
  if (!root.isDirectory()) return {regular, symlinked, nonRegular: ['.']};
  const walk = async (directory, prefix = '') => {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const relative = `${prefix}${entry.name}`;
      const file = path.join(directory, entry.name);
      const metadata = await lstat(file);
      if (metadata.isSymbolicLink()) symlinked.push(relative);
      else if (metadata.isDirectory()) await walk(file, `${relative}/`);
      else if (metadata.isFile()) regular[relative] = sha256(await readFile(file));
      else nonRegular.push(relative);
    }
  };
  await walk(kitRoot);
  return {regular, symlinked: symlinked.sort(), nonRegular: nonRegular.sort()};
}

export async function inspectQualifiedKit(kit) {
  const kitRoot = path.resolve(kit);
  const expected = await recordedQualifiedKitInventory();
  const scanned = await scannedAssets(kitRoot);
  const expectedPaths = Object.keys(expected).sort();
  const actualPaths = Object.keys(scanned.regular).sort();
  const missing = expectedPaths.filter(asset => !(asset in scanned.regular));
  const extra = actualPaths.filter(asset => !(asset in expected));
  const changed = expectedPaths.flatMap(asset =>
    scanned.regular[asset] === undefined || scanned.regular[asset] === expected[asset]
      ? []
      : [{asset, expected: expected[asset], actual: scanned.regular[asset]}],
  );
  return {
    qualified: missing.length === 0 && extra.length === 0 && changed.length === 0 && scanned.symlinked.length === 0 && scanned.nonRegular.length === 0,
    inventory_source: 'evidence/core-kit-qualification.md#Export inventory',
    expected_assets: expected,
    actual_assets: scanned.regular,
    missing_assets: missing,
    extra_assets: extra,
    changed_assets: changed,
    symlinked_assets: scanned.symlinked,
    non_regular_assets: scanned.nonRegular,
    supplied_kit: kitRoot,
  };
}
