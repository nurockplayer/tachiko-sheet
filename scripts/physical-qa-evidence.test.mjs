import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('./physical-qa-evidence.mjs', import.meta.url));

function validInput(overrides = {}) {
  return {
    sheetSha: '0123456789abcdef0123456789abcdef01234567',
    hardware: 'MacBook Pro',
    panelNativeResolution: '3024 × 1964',
    osVersion: 'macOS 15.6',
    displayScalingMode: 'Default',
    dpr: 2,
    browserVersion: 'Safari 18.6',
    viewportCssPx: { width: 1512, height: 823 },
    browserZoomPercent: 100,
    orientationWindowState: 'Landscape, maximized',
    inputMode: 'Physical keyboard',
    taskResult: 'Passed',
    unresolvedFindings: [],
    ...overrides,
  };
}

function runCli(input) {
  return spawnSync(process.execPath, [cliPath], {
    input,
    encoding: 'utf8',
  });
}

function runJson(value) {
  return runCli(JSON.stringify(value));
}

function assertValidationFailure(result) {
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^physical-qa-evidence: /);
}

test('valid zero-finding input has exact deterministic stdout', () => {
  const expected = [
    '### Physical QA evidence',
    '',
    '- Sheet SHA: `0123456789abcdef0123456789abcdef01234567`',
    '- Hardware: MacBook Pro',
    '- Panel native resolution: 3024 × 1964',
    '- OS: macOS 15\\.6',
    '- Display/scaling mode: Default',
    '- DPR: 2',
    '- Browser: Safari 18\\.6',
    '- Viewport CSS px: 1512 × 823',
    '- Browser zoom: 100%',
    '- Orientation/window state: Landscape\\, maximized',
    '- Input mode: Physical keyboard',
    '- Task result: Passed',
    '- Unresolved findings: none',
    '',
  ].join('\n');
  const input = validInput({ ignored: 'not emitted' });
  const first = runJson(input);
  const second = runJson(input);

  assert.equal(first.status, 0);
  assert.equal(first.stderr, '');
  assert.equal(first.stdout, expected);
  assert.equal(second.status, 0);
  assert.equal(second.stdout, expected);
});

test('valid multiple findings are emitted in order', () => {
  const result = runJson(validInput({ unresolvedFindings: ['First finding', 'Second finding'] }));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /- Unresolved findings:\n  - First finding\n  - Second finding\n$/);
});

test('surrounding string whitespace is trimmed before output', () => {
  const result = runJson(validInput({
    sheetSha: '  ABCDEF0123456789ABCDEF0123456789ABCDEF01  ',
    hardware: '  hardware  ',
    panelNativeResolution: '\tresolution\t',
    osVersion: '  os  ',
    displayScalingMode: ' scaling ',
    browserVersion: ' browser ',
    orientationWindowState: ' orientation ',
    inputMode: ' input ',
    taskResult: ' result ',
    unresolvedFindings: ['  finding  '],
  }));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /- Sheet SHA: `ABCDEF0123456789ABCDEF0123456789ABCDEF01`/);
  assert.match(result.stdout, /- Hardware: hardware\n/);
  assert.match(result.stdout, /- Panel native resolution: resolution\n/);
  assert.match(result.stdout, /- Unresolved findings:\n  - finding\n$/);
});

test('malformed JSON exits 2 with prefixed stderr and empty stdout', () => {
  assertValidationFailure(runCli('{"hardware":'));
});

test('missing required field exits 2', () => {
  const input = validInput();
  delete input.hardware;
  assertValidationFailure(runJson(input));
});

test('bad SHA exits 2', () => {
  assertValidationFailure(runJson(validInput({ sheetSha: 'not-a-sha' })));
});

test('invalid DPR exits 2', () => {
  assertValidationFailure(runJson(validInput({ dpr: 0 })));
});

test('invalid viewport width or height exits 2', () => {
  for (const viewportCssPx of [{ width: 0, height: 823 }, { width: 1512.5, height: 823 }, { width: 1512, height: -1 }]) {
    assertValidationFailure(runJson(validInput({ viewportCssPx })));
  }
});

test('invalid browser zoom exits 2', () => {
  assertValidationFailure(runJson(validInput({ browserZoomPercent: 0 })));
});

test('non-string findings exit 2', () => {
  assertValidationFailure(runJson(validInput({ unresolvedFindings: ['valid', 42] })));
});

test('hostile newlines and Markdown structure remain inert literal evidence', () => {
  const result = runJson(validInput({
    hardware: '<tag>\n- injected field',
    taskResult: 'done\r\n> quote\n1. item\n# heading',
    unresolvedFindings: [' - nested\nsecond', '2. nested'],
  }));

  assert.equal(result.status, 0);
  assert.equal(result.stdout, [
    '### Physical QA evidence',
    '',
    '- Sheet SHA: `0123456789abcdef0123456789abcdef01234567`',
    '- Hardware: \\<tag\\>\\\\n\\- injected field',
    '- Panel native resolution: 3024 × 1964',
    '- OS: macOS 15\\.6',
    '- Display/scaling mode: Default',
    '- DPR: 2',
    '- Browser: Safari 18\\.6',
    '- Viewport CSS px: 1512 × 823',
    '- Browser zoom: 100%',
    '- Orientation/window state: Landscape\\, maximized',
    '- Input mode: Physical keyboard',
    '- Task result: done\\\\r\\\\n\\> quote\\\\n1\\. item\\\\n\\# heading',
    '- Unresolved findings:',
    '  - \\- nested\\\\nsecond',
    '  - 2\\. nested',
    '',
  ].join('\n'));
  assert.doesNotMatch(result.stdout, /\n- injected field/);
  assert.doesNotMatch(result.stdout, /\n> quote/);
  assert.doesNotMatch(result.stdout, /\n1\. item/);
});
