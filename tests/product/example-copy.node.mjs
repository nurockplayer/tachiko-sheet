// The Home example must load the unchanged seed fixture as opaque bytes.
// This checks the generated public copy byte-for-byte; it parses nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const seeds = path.join(root, "tests", "fixtures", "release-plan.roproj");
const generated = path.join(root, "public", "examples", "release-plan");
const inventory = [
  "manifest.json",
  "schemas.json",
  ...Array.from("0123456789abcdef", (shard) => `entities/${shard}.jsonl`),
];

test("the generated example copy is byte-identical to the unchanged seed fixture", async () => {
  const copy = spawnSync(process.execPath, [path.join(root, "scripts", "copy-example-fixture.mjs")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(copy.status, 0, copy.stderr);
  for (const entry of inventory) {
    const source = await readFile(path.join(seeds, entry));
    const target = await readFile(path.join(generated, entry));
    assert.ok(source.equals(target), `example copy differs from the seed fixture: ${entry}`);
  }
});
