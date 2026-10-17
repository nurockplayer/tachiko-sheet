import { readFileSync } from 'node:fs';

const REQUIRED_FREE_TEXT_FIELDS = [
  'hardware',
  'panelNativeResolution',
  'osVersion',
  'displayScalingMode',
  'browserVersion',
  'orientationWindowState',
  'inputMode',
  'taskResult',
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function invalid(message) {
  throw new Error(message);
}

function requireTrimmedString(input, field) {
  if (typeof input[field] !== 'string') {
    invalid(`${field} must be a non-empty string`);
  }

  const value = input[field].trim();
  if (value.length === 0) {
    invalid(`${field} must be a non-empty string`);
  }

  return value;
}

function requireFinitePositiveNumber(input, field) {
  if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || input[field] <= 0) {
    invalid(`${field} must be a finite number greater than 0`);
  }

  return input[field];
}

function requirePositiveInteger(input, field) {
  if (!Number.isInteger(input[field]) || input[field] <= 0) {
    invalid(`${field} must be a positive integer`);
  }

  return input[field];
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n|\r|\n/g, (lineEnding) => {
    if (lineEnding === '\r\n') return '\\r\\n';
    if (lineEnding === '\r') return '\\r';
    return '\\n';
  });
}

function escapeFreeText(value) {
  const normalized = normalizeLineEndings(value.trim());
  let escaped = '';

  for (const character of normalized) {
    const codePoint = character.codePointAt(0);
    const isCommonMarkEscapablePunctuation = (codePoint >= 0x21 && codePoint <= 0x2f)
      || (codePoint >= 0x3a && codePoint <= 0x40)
      || (codePoint >= 0x5b && codePoint <= 0x60)
      || (codePoint >= 0x7b && codePoint <= 0x7e);
    escaped += isCommonMarkEscapablePunctuation ? `\\${character}` : character;
  }

  return escaped;
}

function validateInput(input) {
  if (!isPlainObject(input)) {
    invalid('top level must be a plain JSON object');
  }

  if (typeof input.sheetSha !== 'string') {
    invalid('sheetSha must be exactly 40 hexadecimal characters');
  }
  const sheetSha = input.sheetSha.trim();
  if (!/^[0-9a-fA-F]{40}$/.test(sheetSha)) {
    invalid('sheetSha must be exactly 40 hexadecimal characters');
  }

  const freeText = Object.fromEntries(
    REQUIRED_FREE_TEXT_FIELDS.map((field) => [field, requireTrimmedString(input, field)]),
  );
  const dpr = requireFinitePositiveNumber(input, 'dpr');
  const browserZoomPercent = requireFinitePositiveNumber(input, 'browserZoomPercent');

  if (!isPlainObject(input.viewportCssPx)) {
    invalid('viewportCssPx must be a plain object');
  }
  const viewportWidth = requirePositiveInteger(input.viewportCssPx, 'width');
  const viewportHeight = requirePositiveInteger(input.viewportCssPx, 'height');

  if (!Array.isArray(input.unresolvedFindings)
    || input.unresolvedFindings.some((finding) => typeof finding !== 'string')) {
    invalid('unresolvedFindings must be an array of strings');
  }

  return {
    sheetSha,
    ...freeText,
    dpr,
    viewportWidth,
    viewportHeight,
    browserZoomPercent,
    unresolvedFindings: input.unresolvedFindings.map((finding) => finding.trim()),
  };
}

function renderEvidence(evidence) {
  const lines = [
    '### Physical QA evidence',
    '',
    `- Sheet SHA: \`${evidence.sheetSha}\``,
    `- Hardware: ${escapeFreeText(evidence.hardware)}`,
    `- Panel native resolution: ${escapeFreeText(evidence.panelNativeResolution)}`,
    `- OS: ${escapeFreeText(evidence.osVersion)}`,
    `- Display/scaling mode: ${escapeFreeText(evidence.displayScalingMode)}`,
    `- DPR: ${evidence.dpr}`,
    `- Browser: ${escapeFreeText(evidence.browserVersion)}`,
    `- Viewport CSS px: ${evidence.viewportWidth} × ${evidence.viewportHeight}`,
    `- Browser zoom: ${evidence.browserZoomPercent}%`,
    `- Orientation/window state: ${escapeFreeText(evidence.orientationWindowState)}`,
    `- Input mode: ${escapeFreeText(evidence.inputMode)}`,
    `- Task result: ${escapeFreeText(evidence.taskResult)}`,
  ];

  if (evidence.unresolvedFindings.length === 0) {
    lines.push('- Unresolved findings: none');
  } else {
    lines.push('- Unresolved findings:');
    for (const finding of evidence.unresolvedFindings) {
      lines.push(`  - ${escapeFreeText(finding)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    process.stdout.write(renderEvidence(validateInput(input)));
  } catch (error) {
    const message = error instanceof SyntaxError
      ? 'invalid JSON input'
      : error instanceof Error ? error.message : 'validation failed';
    process.stderr.write(`physical-qa-evidence: ${message}\n`);
    process.exitCode = 2;
  }
}

main();
