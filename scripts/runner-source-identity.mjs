// Shared, complete committed-blob identity for the bounded #146 runners.
// The output collector is intentionally bounded; each read is sized from Git's
// object metadata and must match that exact byte count before it is hashed.
import { createHash } from 'node:crypto';

export async function readCommittedSourceIdentities({ head, files, cwd, runGit }) {
  if (typeof runGit !== 'function') throw new TypeError('runGit is required to read committed source blobs');
  const identities = [];
  for (const file of [...new Set(files)].sort()) {
    const sizeRun = await runGit(['cat-file', '-s', `${head}:${file}`], { cwd, maxOutputBytes: 1024 });
    const sizeText = sizeRun.output.trim();
    if (sizeRun.outcome !== 'EXITED' || sizeRun.code !== 0 || !/^(0|[1-9]\d*)$/.test(sizeText)) {
      throw new Error(`cannot determine complete committed source byte count for ${file}: ${sizeRun.output}`);
    }
    const expectedByteCount = Number(sizeText);
    if (!Number.isSafeInteger(expectedByteCount) || expectedByteCount >= Number.MAX_SAFE_INTEGER) {
      throw new Error(`committed source byte count is unsafe for ${file}: ${sizeText}`);
    }
    const blob = await runGit(['show', `${head}:${file}`], { cwd, maxOutputBytes: expectedByteCount + 1 });
    const capturedByteCount = blob.bytes.length;
    if (blob.outcome !== 'EXITED' || blob.code !== 0 || capturedByteCount !== expectedByteCount) {
      throw new Error(`incomplete committed source blob ${file}: expected ${expectedByteCount} bytes, captured ${capturedByteCount}; refusing candidate identity`);
    }
    identities.push({
      path: file,
      sha256: createHash('sha256').update(blob.bytes).digest('hex'),
      byteCount: expectedByteCount,
      capturedByteCount,
    });
  }
  return identities;
}
