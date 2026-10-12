// Binds a hosted probe to the candidate it claims to verify: the requested
// origin (no redirect elsewhere), a real 404 for missing assets (no catch-all
// rewrite), and optionally the exact built index.html.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function assertHostedCandidate(origin) {
  const expectedOrigin = new URL(origin).origin;
  const index = await fetch(origin, { redirect: "follow" });
  assert.equal(index.status, 200, `${origin} must serve the app`);
  assert.equal(new URL(index.url).origin, expectedOrigin, `${origin} redirected to ${index.url}`);
  const indexHash = sha256(Buffer.from(await index.arrayBuffer()));
  const missing = await fetch(new URL(`/assets/tachiko-missing-${randomUUID()}.js`, expectedOrigin), { redirect: "manual" });
  assert.equal(missing.status, 404, "a missing asset must be a real 404, not the app shell");
  let expected = process.env.HOSTED_EXPECTED_INDEX_SHA256 ?? null;
  if (!expected && process.env.HOSTED_EXPECTED_DIST) {
    expected = sha256(await readFile(path.join(process.env.HOSTED_EXPECTED_DIST, "index.html")));
  }
  if (expected) assert.equal(indexHash, expected, "deployed index.html is not the expected candidate build");
  return { origin: expectedOrigin, indexHash, candidateBound: Boolean(expected) };
}

export function assertOnOrigin(page, origin) {
  assert.equal(new URL(page.url()).origin, new URL(origin).origin, `the page left ${origin} for ${page.url()}`);
}
