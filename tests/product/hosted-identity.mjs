// Binds a hosted probe to the candidate it claims to verify: the requested
// origin (no redirect elsewhere), a real 404 for missing assets (no catch-all
// rewrite), and the exact built index.html on every browser navigation.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The expected index.html digest; a hosted PASS requires one. */
export async function expectedIndexSha256() {
  if (process.env.HOSTED_EXPECTED_INDEX_SHA256) return process.env.HOSTED_EXPECTED_INDEX_SHA256;
  if (process.env.HOSTED_EXPECTED_DIST) return sha256(await readFile(path.join(process.env.HOSTED_EXPECTED_DIST, "index.html")));
  console.error("BLOCKED: set HOSTED_EXPECTED_DIST (the candidate's built dist) or HOSTED_EXPECTED_INDEX_SHA256 to bind the hosted run to a candidate.");
  process.exit(78);
}

export async function assertHostedCandidate(origin, expected) {
  const expectedOrigin = new URL(origin).origin;
  const index = await fetch(origin, { redirect: "follow" });
  assert.equal(index.status, 200, `${origin} must serve the app`);
  assert.equal(new URL(index.url).origin, expectedOrigin, `${origin} redirected to ${index.url}`);
  assert.equal(sha256(Buffer.from(await index.arrayBuffer())), expected, "deployed index.html is not the expected candidate build");
  const missing = await fetch(new URL(`/assets/tachiko-missing-${randomUUID()}.js`, expectedOrigin), { redirect: "manual" });
  assert.equal(missing.status, 404, "a missing asset must be a real 404, not the app shell");
  return { origin: expectedOrigin, indexSha256: expected };
}

/** Navigates and requires the document the browser loaded to be the candidate. */
export async function gotoCandidate(page, origin, expected) {
  const response = await page.goto(origin);
  assert.ok(response, `no document response for ${origin}`);
  assert.equal(new URL(page.url()).origin, new URL(origin).origin, `the page left ${origin} for ${page.url()}`);
  assert.equal(sha256(await response.body()), expected, "the browser loaded a document other than the expected candidate build");
}
