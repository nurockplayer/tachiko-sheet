# #197 producer adoption handback

Sole bounded implementation/test writer in `w197`, branch `codex/197-repin-d5dc6b8b`, from Sheet `0cdefcd9d98b9ab7db6d7c5546c1192a789977f5` (PR #196). Opus 5.5 remains Mission Lead/integrator. No Work source changes, merge, deployment or review-thread resolution.

## Producer provenance

Exact Work `d5dc6b8b48b14623f4acacd414c660f91b002e2f`, clean detached checkout `/Users/tachikoma/Developer/tachiko-kit-build/work-d5dc6b8b`. This is the merged Work PR #537 producer fixing browser folder ordering (#536).

Unchanged Work exporter, run from that checkout:

```sh
PATH=/opt/homebrew/bin:$PATH TMPDIR=/private/tmp /opt/homebrew/bin/bash scripts/export-experimental-designer-client.sh /Users/tachikoma/Developer/tachiko-kit-build/out-d5dc6b8b/kit
PATH=/opt/homebrew/bin:$PATH TMPDIR=/private/tmp /opt/homebrew/bin/bash scripts/export-experimental-designer-client.sh /Users/tachikoma/Developer/tachiko-kit-build/out-d5dc6b8b-rebuild/kit
```

All 25 files match byte for byte. First output vendored intact in `public/core-kit`; sourceCommit and all manifest-listed hashes verified. Same toolchain/physical TMPDIR as #196 (WASM bytes depend on TMPDIR: Work #521). Manifest SHA-256: `0e021a9ca97b2b8a599f941f26db9bc8a8d86e9b169b871facb6f215c2b5d603`.

[Writer acquisition receipt](https://github.com/nurockplayer/tachiko-sheet/issues/197#issuecomment-6186203372). These are two writer builds, not independent reproduction/review. The initial wrapper invocation failed before the exporter because PATH was unquoted; the corrected invocation above succeeded twice.

[Lead independent reproduction pending](https://github.com/nurockplayer/tachiko-sheet/issues/197#issuecomment-6186194480). The verifier's candidate entry points at that placeholder comment; the lock's artifact-review URL is intentionally null. Opus must reproduce the artifact independently, replace both review references with its actual receipt and update the notes. No independent artifact or final-candidate review credit is claimed; provenance verification fails closed pending that handback.

## Adoption and regression

Web lock and all seven native Work Cargo entries pin the same exact source. Cargo.lock changes only seven source references; pnpm lockfile unchanged. J3 corpus changes only `core_source` and `core_manifest_sha256`. The existing `16545c55` verifier tuple remains for explicit rollback. Older producers cannot reopen name-bearing v3/.ro records (ADR-0043); preserve records, never down-convert or rewrite them.

Removed `V3_ORDERED_SELECTION` and its diagnostic FileList rewrite. The v3-folder-save lane uses the ordinary Home folder selection and is now an ordinary step in `scripts/run-product-acceptance.mjs`; its result gates both runner branches. Frozen #146 runners unchanged. No Sheet product source changes needed.

All four v3 variants PASS on the production build: named table with summary added through UI; Date; existing summary; Date plus summary. Each uses a real complete 19-file producer folder, ordinary Open folder, edit, Save a copy, actual browser PID exit, same-profile Home reopen, bound Save, Close→Save, another actual process exit/reopen, and separate Work-client readback of every saved name/key/identity/type/value and summary. All 12 v3 browser PIDs exited.

## Actual gates

Logs and machine-readable command results: `/tmp/sheet-197/` (`results.jsonl`). Heavy commands monitored free space and stop below 3 GiB.

| Command | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm typecheck` | PASS |
| `TACHIKO_TEST_SINGLE_PROCESS=1 pnpm test:unit` | FAIL overall: 631/631 Vitest PASS; 142/144 Node PASS. Two CLI provenance tests fail at the intentionally absent lead review URL (shipped-lock verification; altered-asset delegation cannot reach its digest assertion). No tests weakened. |
| `pnpm build` | PASS, including production hook exclusion |
| `pnpm build:acceptance` | PASS |
| `pnpm verify:core-kit` | FAIL / pending lead independent artifact reproduction URL; no qualification PASS |
| `pnpm qualification:j3-public-composition` | FAIL_OR_UNQUALIFIED at the same provenance prerequisite, before behavioral composition; no J3 PASS |
| `WORK_CLIENT_KIT=public/core-kit WORK_CORE_COMMIT=d5dc6b8b48b14623f4acacd414c660f91b002e2f node tests/kit.mjs` | PASS: C1 integrity, 24 manifest-listed assets; does not confer review credit |
| `WORK_DIST=dist TACHIKO_TEST_SINGLE_PROCESS=1 node tests/product/v3-folder-save-local.mjs` | PASS: 4 ordinary-selection scenarios; no diagnostic flag |
| `WORK_DIST=dist TACHIKO_TEST_SINGLE_PROCESS=1 pnpm acceptance:display-names` | PASS: 6 groups |
| `WORK_DIST=dist TACHIKO_TEST_SINGLE_PROCESS=1 node tests/product/save-update-local.mjs` | PASS: 17 groups |
| `WORK_DIST=dist-acceptance TACHIKO_TEST_SINGLE_PROCESS=1 node tests/product/work-file-save-local.mjs` | PASS: 11 groups |
| `CARGO_TARGET_DIR="$HOME/Developer/tachiko-work/target" cargo test --locked --manifest-path src-tauri/Cargo.toml` | PASS: 13 native host tests |
| `CARGO_TARGET_DIR="$HOME/Developer/tachiko-work/target" cargo build --locked --example frame_harness --manifest-path src-tauri/Cargo.toml` | PASS: debug native harness |
| `CARGO_TARGET_DIR="$HOME/Developer/tachiko-work/target" FRAME_HARNESS="$HOME/Developer/tachiko-work/target/debug/examples/frame_harness" pnpm exec vitest run tests/desktop/native-parity.test.ts` | PASS: 2/2 tests, 197.15 seconds including harness execution (debug native harness) |

Diff/parse/pin checks passed; all 38 recorded focused-lane browser PIDs are absent. Unit-test Vite servers closed and native parity owns no server. Final free space about 4.7 GiB; the 3 GiB stop was not reached.

Full product acceptance skipped as instructed; lead runs it. Hosted/macOS job, fresh independent exact-candidate review, integration and deployment are not claimed. Lead must finish artifact qualification and rerun the dependent unit/J3/verifier gates before integration. `.serena/project.yml` and `evidence/` excluded from the candidate.

## Inventory

| File | SHA-256 |
| --- | --- |
| `README.md` | `d5257c7979b0b9fd5751ded85f47984cbb89caaf3236c7ef74b250dc842ec783` |
| `artifact-manifest.json` | `0e021a9ca97b2b8a599f941f26db9bc8a8d86e9b169b871facb6f215c2b5d603` |
| `designer_runtime.wasm` | `86d1298d16dd7cee0e4f1f0a29b359d0531eca3dc7f48241b1f68651cefeb9f7` |
| `experimental-client.d.ts` | `aa4d5309e39008e07712ce525e7c07e2b85311d16e0617159e27c16da4d70198` |
| `experimental-client.js` | `bd53c548b64db958ea78efe421141b5056a089921c1541b1d29c63f22b043391` |
| `experimental-client.worker.d.ts` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `experimental-client.worker.js` | `669f02aece146ae108033ca04ed808a633012c6b576e20b6d6bdf59f10ca003e` |
| `host/project-transfer.d.ts` | `5604bc40651eae3a0987f8e03fb2c66b8d2cea91fc2212890e2a390c3f0edea5` |
| `host/project-transfer.js` | `dd38dbe690dd574d50d328f8cfbb51e4acca887a920e535b05d3a60a7f3c6b5a` |
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
