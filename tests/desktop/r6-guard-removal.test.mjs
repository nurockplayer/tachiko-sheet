// Run under tachi-run --heavy --host after the unmodified packaged lifecycle.
// Product mutations exist only in a disposable detached worktree, never this PR.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const evidence = path.resolve(process.argv[2]);
await mkdir(evidence, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), "sheet-r6-guards-"));
const checkout = path.join(temporary, "checkout");
const bundle = "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Tachiko Sheet E2E.app";
const baselineApp = path.join(temporary, "baseline.app");
await cp(path.join(root, bundle), baselineApp, { recursive: true });
const mutations = [
  {
    name: "replace-cancel-removed", file: "src/ui/SheetShell.tsx",
    from: 'onClick={cancelReplacePreview}>Cancel preview</button>',
    to: 'onClick={() => {}}>Cancel preview</button>',
    failure: "timed out waiting for R6 Cancel preview",
  },
  ...["Enter", "Escape"].map(key => ({
    name: `name-box-${key.toLowerCase()}-guard-removed`, file: "src/ui/FormulaBar.tsx",
    from: "if (isComposingEvent(event)) return;",
    to: `if (isComposingEvent(event) && event.key !== ${JSON.stringify(key)}) return;`,
    failure: `dispatched-composition ${key} preserves text, focus and selection`,
  })),
];
const receipts = [];
function run(command, args, log, env = {}) {
  const fd = openSync(log, "w");
  try {
    const result = spawnSync(command, args, {
      cwd: checkout, env: { ...process.env, ...env }, stdio: ["ignore", fd, fd],
    });
    if (result.error) throw result.error;
    assert.equal(result.signal, null, "guard-removal process must finish normally");
    return result.status;
  } finally { closeSync(fd); }
}
let registered = false;
try {
  execFileSync("rtk", ["git", "worktree", "add", "--detach", checkout, "HEAD"], { cwd: root, stdio: "inherit" });
  registered = true;
  await symlink(path.join(root, "node_modules"), path.join(checkout, "node_modules"), "dir");
  await symlink(path.join(root, "src-tauri/target"), path.join(checkout, "src-tauri/target"), "dir");
  for (const mutation of mutations) {
    // Reset both potentially mutated files to the exact candidate each time.
    for (const file of new Set(mutations.map(item => item.file))) {
      await writeFile(path.join(checkout, file), await readFile(path.join(root, file)));
    }
    const file = path.join(checkout, mutation.file);
    const source = await readFile(file, "utf8");
    assert.equal(source.split(mutation.from).length, 2, `${mutation.name}: one exact mutation site`);
    await writeFile(file, source.replace(mutation.from, mutation.to));
    const buildLog = path.join(evidence, `${mutation.name}.build.log`);
    assert.equal(run("pnpm", ["desktop:build:e2e"], buildLog), 0, `${mutation.name}: build must pass; see ${buildLog}`);
    const log = path.join(evidence, `${mutation.name}.lifecycle.log`);
    const direct = path.join(evidence, `${mutation.name}.result.json`);
    const exit = run("caffeinate", ["-dimu", "node", "tests/desktop/packaged-lifecycle.mjs", bundle], log, {
      DESKTOP_NATIVE_ONLY: "0", DESKTOP_JOURNEYS: "sales", DESKTOP_DIRECT_RESULT: direct,
      DESKTOP_KEEP_LOG: path.join(evidence, `${mutation.name}.host.log`),
    });
    assert.notEqual(exit, 0, `${mutation.name}: removed guard must fail`);
    const result = JSON.parse(await readFile(direct, "utf8"));
    assert.equal(result.status, "FAIL");
    assert.equal(result.cleanup.status, "PASS", `${mutation.name}: no leftover app process`);
    assert.ok(result.error?.includes(mutation.failure), `${mutation.name}: expected behavioral failure, got ${result.error}`);
    receipts.push({ mutation: mutation.name, exit, assertion: mutation.failure, status: "PASS" });
    await writeFile(path.join(evidence, "guard-removal.json"), JSON.stringify(receipts, null, 2));
    console.log(`PASS: ${mutation.name} rejected by packaged lifecycle: ${mutation.failure}`);
  }
} finally {
  // Keep the normal target app usable after the experiment; build mutations
  // and their logs are not baseline product artifacts or passing app evidence.
  await rm(path.join(root, bundle), { recursive: true, force: true });
  await cp(baselineApp, path.join(root, bundle), { recursive: true });
  if (registered) execFileSync("rtk", ["git", "worktree", "remove", "--force", checkout], { cwd: root, stdio: "inherit" });
  await rm(temporary, { recursive: true, force: true });
}
console.log(`PASS: all ${receipts.length} R6 guard removals rejected by packaged WebKit`);
