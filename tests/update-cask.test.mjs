import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../scripts/update-cask.sh', import.meta.url));
const oldSha = 'a'.repeat(64);
const newSha = 'b'.repeat(64);
const caskText = version => `cask "tachiko-sheet" do
  version "${version}"
  sha256 "${oldSha}"
  url "https://example.test/v#{version}/tachiko-sheet-macos-arm64.dmg"
  depends_on arch: :arm64
  caveats "Keep this warning."
  zap trash: "~/Library/Application Support/Tachiko Sheet"
end
`;

function withCask(version, run) {
  const directory = mkdtempSync(join(tmpdir(), 'update-cask-'));
  const cask = join(directory, 'tachiko-sheet.rb');
  const before = caskText(version);
  writeFileSync(cask, before);
  try {
    run({ cask, before, directory });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// Exercise the real shell entry point and its on-disk output, without a tap push.
for (const [current, requested] of [
  ['0.1.0-preview.9', '0.1.0-preview.10'],
  ['0.1.0-preview.10', '0.1.0'],
  ['0.1.0', '0.1.1-preview.1'],
  ['0.1.9', '0.1.10'],
  ['0.9.9', '0.10.0'],
  ['0.99.99', '1.0.0'],
  ['1.0.0-alpha', '1.0.0-alpha.1'],
  ['1.0.0-alpha.1', '1.0.0-alpha.beta'],
  ['1.0.0-alpha.beta', '1.0.0-beta'],
  ['1.0.0-beta.2', '1.0.0-beta.11'],
  ['1.0.0-beta.11', '1.0.0-rc.1'],
  ['1.0.0-preview.99999999999999999999', '1.0.0-preview.100000000000000000000'],
  ['1.0.0+old', '1.0.1+new'],
]) {
  test(`updates ${current} to newer ${requested}`, () => {
    withCask(current, ({ cask, before, directory }) => {
      const result = spawnSync('sh', [script, requested, newSha, cask], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const expected = before.replace(`version "${current}"`, `version "${requested}"`)
        .replace(oldSha, newSha).replace('-macos-arm64.dmg', '-macos-universal.dmg')
        .replace('  depends_on arch: :arm64\n', '');
      assert.equal(readFileSync(cask, 'utf8'), expected);
      assert.deepEqual(readdirSync(directory), ['tachiko-sheet.rb']);
    });
  });
}

for (const [current, requested] of [
  ['0.1.0-preview.10', '0.1.0-preview.9'],
  ['0.1.0-preview.10', '0.1.0-preview.10'],
  ['0.1.0', '0.1.0-preview.99'],
  ['0.1.0', '0.1.0'],
  ['0.1.10', '0.1.9'],
  ['0.10.0', '0.9.9'],
  ['1.0.0', '0.99.99'],
  ['1.0.0-alpha.1', '1.0.0-alpha'],
  ['1.0.0-alpha.beta', '1.0.0-alpha.1'],
  ['1.0.0-beta', '1.0.0-alpha.beta'],
  ['1.0.0-rc.1', '1.0.0-beta.11'],
  ['1.0.0+old', '1.0.0+new'],
  ['1.0.0-preview.10+old', '1.0.0-preview.10+new'],
]) {
  test(`rejects ${requested} against ${current} without changing cask bytes`, () => {
    withCask(current, ({ cask, before, directory }) => {
      const result = spawnSync('sh', [script, requested, newSha, cask], { encoding: 'utf8' });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /must be newer than/);
      assert.deepEqual(readFileSync(cask), Buffer.from(before));
      assert.deepEqual(readdirSync(directory), ['tachiko-sheet.rb']);
    });
  });
}

for (const requested of ['1.0', '01.0.0', '1.0.0-preview.01', '1.0.0-', '1.0.0+', '1.0.0-a..b']) {
  test(`rejects invalid requested SemVer ${requested} without changing cask bytes`, () => {
    withCask('0.1.0', ({ cask, before }) => {
      const result = spawnSync('sh', [script, requested, newSha, cask], { encoding: 'utf8' });
      assert.equal(result.status, 2, result.stderr);
      assert.deepEqual(readFileSync(cask), Buffer.from(before));
    });
  });
}

test('refuses an invalid current version without changing cask bytes', () => {
  withCask('not-semver', ({ cask, before }) => {
    const result = spawnSync('sh', [script, '1.0.0', newSha, cask], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /expected one valid SemVer/);
    assert.deepEqual(readFileSync(cask), Buffer.from(before));
  });
});
