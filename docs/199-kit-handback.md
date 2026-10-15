# #199 producer adoption handback

Sole bounded implementation/test writer in `w199`, branch `codex/199-repin-abc2be6c`, from Sheet `9d957a2918bb19db989955fe4a9a5b9f1c1d7e21` (PR #198). Opus 5.5 owns integration, push, PR, independent reproduction, full product acceptance, review and merge. No Work source or other worktree edits.

## Producer provenance

Exact Work `abc2be6c5813771ea7b6c5b4a3292e9c72396b33`, clean detached checkout `/Users/tachikoma/Developer/tachiko-kit-build/work-abc2be6c`, verified with zero staged, unstaged or untracked files before and after both exports. Includes Work #539's root-folder backslash fix and #540's CI/test changes.

Unchanged Work exporter, run from that checkout:

```sh
PATH=/opt/homebrew/bin:$PATH TMPDIR=/private/tmp /opt/homebrew/bin/bash scripts/export-experimental-designer-client.sh /Users/tachikoma/Developer/tachiko-kit-build/out-abc2be6c/kit
PATH=/opt/homebrew/bin:$PATH TMPDIR=/private/tmp /opt/homebrew/bin/bash scripts/export-experimental-designer-client.sh /Users/tachikoma/Developer/tachiko-kit-build/out-abc2be6c-rebuild/kit
diff -qr /Users/tachikoma/Developer/tachiko-kit-build/out-abc2be6c/kit /Users/tachikoma/Developer/tachiko-kit-build/out-abc2be6c-rebuild/kit
```

Both exporter commands and `diff -qr` PASS. All 25 files match byte for byte; first output vendored intact in `public/core-kit` and verified by a second `diff -qr`. Each output passed unchanged `tests/kit.mjs` with `WORK_CLIENT_KIT` set to its absolute output path and `WORK_CORE_COMMIT=abc2be6c5813771ea7b6c5b4a3292e9c72396b33`: matching sourceCommit and all 24 manifest-listed hashes. Physical TMPDIR is `/private/tmp`, as in #197. Manifest SHA-256: `a98552ac69c9a33005f89d72b997a9b3afc0409937b217947e23e93e95ebe38f`.

[Writer acquisition / lead independent reproduction pending placeholder](https://github.com/nurockplayer/tachiko-sheet/issues/199#issuecomment-6200958431). These are two writer builds, not independent reproduction or review. The new verifier entry and lock review URL cite this placeholder; the lock deliberately records `lead independent reproduction pending; product acceptance separate`, so provenance qualification fails closed. After actual independent reproduction, the lead must replace both review references, restore the qualified status and update the notes before rerunning dependent gates. The `d5dc6b8b` rollback entry and its actual receipts remain intact.

## Adoption and regression

Web lock and all seven native Work Cargo entries pin the same exact source. A byte comparison against the baseline confirms Cargo.lock changes only seven source references. pnpm lockfile unchanged. J3 corpus changes only `core_source` and `core_manifest_sha256`; J4 changes only the two corresponding qualification constants. No Sheet product source changes or acceptance-runner changes. Frozen #146 runners untouched. Existing compatibility and user-record preservation boundaries remain in force; no down-conversion or record rewrite.

Added one Node unit regression in existing `tests/dev-core-kit.test.mjs`, included by `pnpm test:unit`. It extracts the real existing `constrained-v3.hex` canonical payload (19 files, manifest version 3), supplies FileList-shaped selection in reverse order under `Forecast\Final.roproj`, and compares all decoded canonical paths and bytes. The same test rejects a backslash inside a relative entity path.

The focused regression fails behaviorally against the old `d5dc6b8b` kit (`Select the complete .roproj directory, not individual files.`), then passes with the intact `abc2be6c` kit. An earlier pre-install invocation failed at missing Vite, not behavior; a disposable standalone probe also initially lacked FileList.item. Both setup issues were corrected before the recorded behavioral old/new comparison.

## Actual gates

Exact commands, exit codes, elapsed time, minimum free bytes and logs: `/private/tmp/sheet-199/results.jsonl` and adjacent `.log` files. Commands ran serially. Every heavy command monitors free space and stops below 3 GiB.

| Command | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS; pnpm 12.11.2, lockfile unchanged |
| `pnpm typecheck` | PASS |
| `TACHIKO_TEST_SINGLE_PROCESS=1 pnpm test:unit` | FAIL CLOSED: 631/631 Vitest pass; 143/145 Node pass. The two failures below await lead reproduction |
| `pnpm build` | PASS; production hook exclusion passes (85 files) |
| `pnpm build:acceptance` | PASS |
| `WORK_CLIENT_KIT=public/core-kit WORK_CORE_COMMIT=abc2be6c5813771ea7b6c5b4a3292e9c72396b33 node tests/kit.mjs` | PASS; C1 sourceCommit and 24 asset hashes |
| `pnpm verify:core-kit` | FAIL CLOSED; lock qualificationStatus explicitly awaits lead reproduction |
| `WORK_DIST=dist TACHIKO_TEST_SINGLE_PROCESS=1 node tests/product/v3-folder-save-local.mjs` | PASS; all 4 ordinary-selection v3 scenarios; 12 actual browser exits |
| `WORK_DIST=dist TACHIKO_TEST_SINGLE_PROCESS=1 pnpm acceptance:display-names` | PASS; 6 groups; 2 actual browser exits |
| `WORK_DIST=dist TACHIKO_TEST_SINGLE_PROCESS=1 node tests/product/save-update-local.mjs` | PASS; 17 groups; 19 actual browser exits |
| `WORK_DIST=dist-acceptance TACHIKO_TEST_SINGLE_PROCESS=1 node tests/product/work-file-save-local.mjs` | PASS; 11 groups; 5 actual browser exits |
| `CARGO_TARGET_DIR=/Users/tachikoma/Developer/tachiko-work/target cargo test --locked --manifest-path src-tauri/Cargo.toml` | PASS; 13 native host tests |

The exact pending-provenance failures in `tests/verify-core-kit-provenance.test.mjs` are:

- `CLI verifies the shipped lock and complete C1 inventory`.
- `CLI delegates asset integrity and rejects altered bytes under an intact manifest`.

Both stop at the lock's pending qualification status before inventory delegation. Do not count them as PASS or substitute the writer's builds for the lead receipt. All 631 Vitest tests, the other 143 Node tests and the new focused regression pass.

Full `pnpm acceptance:product` intentionally not run; Opus runs it. No independent reproduction, fresh independent exact-candidate review, hosted Web/macOS result, full product acceptance, integration, merge or deployment claimed. `.serena/project.yml` and `evidence/` excluded from the commit.

Native target: `/Users/tachikoma/Developer/tachiko-work/target`. Its `debug/incremental` directory was removed after the Cargo build/test and absence verified. Minimum recorded free space was 16.12 GiB; final free space 16.17 GiB. The 3 GiB stop was not reached. All 38 recorded focused-lane browser PIDs were independently rechecked absent; their runners also recorded actual exits. Unit-test Vite servers closed. No other browser/server started.

Diff, JSON, source/pin and intact-vendor checks pass. Remaining lead work: independent exporter reproduction and real review receipt; restore lock qualification status; rerun provenance/unit/J3/J4 and required full product/hosted gates; fresh independent candidate review, integration and merge.

## Commit handoff

**Uncommitted.** The scoped `git add` failed before staging or committing: `fatal: Unable to create '/Users/tachikoma/Developer/tachiko-sheet/.git/worktrees/w199/index.lock': Operation not permitted`. No retry or permissions workaround; requested source/doc changes remain in this worktree for Opus. Requested commit message: `chore(kit): re-pin to Work abc2be6c so backslash root folders open (#199)`. No push or PR created.

## Inventory

All paths below are relative to `public/core-kit`; the manifest itself is included in this 25-file inventory.

| File | SHA-256 |
| --- | --- |
| `README.md` | `d5257c7979b0b9fd5751ded85f47984cbb89caaf3236c7ef74b250dc842ec783` |
| `artifact-manifest.json` | `a98552ac69c9a33005f89d72b997a9b3afc0409937b217947e23e93e95ebe38f` |
| `designer_runtime.wasm` | `ea784375def1a45fbe7c286515448a007b13dbe2bab900d92dac6301d6fc2ebd` |
| `experimental-client.d.ts` | `aa4d5309e39008e07712ce525e7c07e2b85311d16e0617159e27c16da4d70198` |
| `experimental-client.js` | `bd53c548b64db958ea78efe421141b5056a089921c1541b1d29c63f22b043391` |
| `experimental-client.worker.d.ts` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `experimental-client.worker.js` | `669f02aece146ae108033ca04ed808a633012c6b576e20b6d6bdf59f10ca003e` |
| `host/project-transfer.d.ts` | `5604bc40651eae3a0987f8e03fb2c66b8d2cea91fc2212890e2a390c3f0edea5` |
| `host/project-transfer.js` | `603a95431d3483e5668bd7a065e4d04c69d5c4c988eeab920303f914ce097d07` |
| `notices/LICENSE-APACHE` | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `notices/LICENSE-MIT` | `8fbbe1bd4ec8eed2985f3e9d225124af632ea6a911b95b9700d3ac44c87c062d` |
| `notices/THIRD_PARTY_LICENSES.md` | `b36a66d6709929fe638ce6b472918d2fc64107d58e8ffe95b86cfb7d293536e5` |
| `package.json` | `6aed801a764caaa3cfd5d8b4bb8d5afa41616f1746d44762c63836ea63b61748` |
| `runtime/client.d.ts` | `beecf184ca568cae750daf0676b041951cba1c77a065ce4398a8b8664eb46397` |
| `runtime/client.js` | `9ccbdfa476c20c53d2cbbd681586f527b3afab59590867479469f34ebebc2632` |
| `runtime/interop-protocol.d.ts` | `4c688f28a390cd05d50a8a4e3673335905f8e5f576e373a9a5906466dc37014e` |
| `runtime/interop-protocol.js` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `runtime/protocol.d.ts` | `869ae6ddbe9c4d763ee2071dd0bf64c52c22538f065fb5fc7d1e2edd88d9f903` |
| `runtime/protocol.js` | `090a3f5d26d2765d53ad6a3a9a4533937d34adfb99700bc3869218cccf0a1bbc` |
| `runtime/wasm-bridge.d.ts` | `114eea5a61db945ddc554050b4df34b86298acdd77500124cb85e3e06d9081f4` |
| `runtime/wasm-bridge.js` | `4ce8ff2ab09088211800861ef2404362e6913514e7ca114a7cc99fbbb3760b6e` |
| `runtime/worker-client.d.ts` | `facd3465a4b946d1327e176f93b39c3b02a3b129f8715671acca47e9d82bb82f` |
| `runtime/worker-client.js` | `73c9cf3b935b18332bb63f1095cfe6adb902ccd301c9a18db0f1ed87b5d00ea0` |
| `runtime/worker-runtime.d.ts` | `657179a14c93df62c7a8d2e0718076082c3d53ed30b94f3f23b21cc8608587c3` |
| `runtime/worker-runtime.js` | `b2c0ed8e317ded0c38e1775418f8ca597b19d52062f2d131751e5b5476915bce` |
