# #215 producer adoption handback

Sole bounded implementation/test writer, requested GPT-6.1 Sol/high, in `sheet-215-repin`, branch `opus/215-repin-3d071daf`, from Sheet `221a6ed2534c0a8a1ab974c21d4aee45f3d09bec`. Claude Opus 5.5 owns lead/integration under #208, push, PR, hosted qualification, full product acceptance, independent candidate review and merge. This is a local-only re-pin; no Work source edits or Sheet product source changes.

## Producer provenance

Exact Work `3d071dafc3166cd490b9ac03a67a7f4ec5dbafcf`, clean detached checkout `/Users/tachikoma/Developer/tachiko-kit-build/work-3d071daf-writer`. Verified exact HEAD, detached state, and zero staged, unstaged or untracked files before and after export. The exporter and producer sources were unchanged.

```sh
PATH=/opt/homebrew/bin:$PATH TMPDIR=/private/tmp /opt/homebrew/bin/bash scripts/export-experimental-designer-client.sh /Users/tachikoma/Developer/tachiko-kit-build/out-3d071daf/kit
diff -qr /Users/tachikoma/Developer/tachiko-kit-build/out-3d071daf/kit /Users/tachikoma/Developer/tachiko-kit-build/lead-repro-3d071daf/kit
diff -qr /Users/tachikoma/Developer/tachiko-kit-build/out-3d071daf/kit public/core-kit
WORK_CLIENT_KIT=/Users/tachikoma/Developer/tachiko-kit-build/out-3d071daf/kit WORK_CORE_COMMIT=3d071dafc3166cd490b9ac03a67a7f4ec5dbafcf node tests/kit.mjs
```

All commands PASS, exit 0. Writer output, prior independent lead output and the intact vendor directory match byte for byte across all 25 files. Manifest SHA-256: `a1c0a40798d541b620d6afe1a6bfd6671622ab39026d87ab00e2eb1596a721d7`. `runtime/protocol.d.ts` contains public `edit_cells`. Relative to the prior kit only `artifact-manifest.json`, `designer_runtime.wasm` and `runtime/protocol.d.ts` change. Both directory comparisons were repeated successfully after the gates.

[Existing independent lead build receipt](https://github.com/nurockplayer/tachiko-sheet/issues/215#issuecomment-6256396104): Opus built separately from its clean detached checkout before this writer build. The new verifier tuple and lock cite this actual receipt for both producer acquisition and independent reproduction provenance. No separate writer-acquisition comment was published; the writer proof is recorded here. The qualified status is direct, as authorized for #215. This producer receipt is separate from product acceptance and independent exact-candidate review. The `abc2be6c` rollback tuple and all older verifier entries remain byte-for-byte intact.

## Adoption and regression

Web lock and all seven native Work Cargo entries pin the same exact source. Byte comparison against the baseline confirms Cargo.lock changes only seven source references (14 occurrences of the exact rev, in `rev=` and resolved fragments); all other bytes are identical. Cargo.toml changes only its Work rev. pnpm lockfile, package.json and workflows are unchanged. J3 corpus changes only `core_source` and `core_manifest_sha256`; J4 changes only the two corresponding qualification constants. No new tests or product implementation were added. Frozen #146 runners/drivers and every product runner remain untouched. Existing compatibility and user-record preservation boundaries remain in force.

The seven focused lanes exercise the shipped kit through the existing product. Clipboard still reports its imported-table paste refusal as expected by the unchanged runner; enabling that product behavior belongs to the successor slice, not #215.

## Actual gates

Exact commands, exit codes, elapsed time, per-command minimum/maximum free bytes and complete output: `/private/tmp/sheet-215/results.jsonl` and adjacent `.log` files. Commands ran serially. `df -h ~` ran before each logged command; an external monitor sampled free disk every second and would terminate its command process group below 3 GiB. Builds were run before unit/provenance checks while the optional canonical handback-URL clarification was pending; all checks used the final material source/pins relevant to that command. No subsequent product, runner or pin mutation occurred.

| Command (literal) | Actual result |
| --- | --- |
| `PATH=/opt/homebrew/bin:$PATH TMPDIR=/private/tmp /opt/homebrew/bin/bash scripts/export-experimental-designer-client.sh /Users/tachikoma/Developer/tachiko-kit-build/out-3d071daf/kit` | PASS; exit 0 |
| `WORK_CLIENT_KIT=/Users/tachikoma/Developer/tachiko-kit-build/out-3d071daf/kit WORK_CORE_COMMIT=3d071dafc3166cd490b9ac03a67a7f4ec5dbafcf node tests/kit.mjs` | PASS; exit 0; C1 sourceCommit and all 24 manifest-listed hashes |
| `pnpm typecheck` | PASS; exit 0 |
| `pnpm build` | PASS; exit 0; Production hook exclusion PASS, 85 files |
| `pnpm build:acceptance` | PASS; exit 0 |
| `TACHIKO_TEST_SINGLE_PROCESS=1 WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell WORK_DIST=dist  node tests/product/v3-folder-save-local.mjs` | PASS; exit 0; 4 reported groups; 12 recorded browser exits |
| `TACHIKO_TEST_SINGLE_PROCESS=1 WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell WORK_DIST=dist  node tests/product/display-names-local.mjs` | PASS; exit 0; 6 reported groups; 2 recorded browser exits |
| `TACHIKO_TEST_SINGLE_PROCESS=1 WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell WORK_DIST=dist  node tests/product/save-update-local.mjs` | PASS; exit 0; 18 reported groups; 20 recorded browser exits |
| `TACHIKO_TEST_SINGLE_PROCESS=1 WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell WORK_DIST=dist-acceptance  node tests/product/work-file-save-local.mjs` | PASS; exit 0; 11 reported groups; 5 recorded browser exits |
| `TACHIKO_TEST_SINGLE_PROCESS=1 WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell WORK_DIST=dist-acceptance CLIPBOARD_OUT=/private/tmp/sheet-215/clipboard node tests/product/clipboard-local.mjs` | PASS; exit 0; 13 reported groups; 2 recorded browser exits |
| `TACHIKO_TEST_SINGLE_PROCESS=1 WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell WORK_DIST=dist-acceptance COLUMNS_OUT=/private/tmp/sheet-215/columns node tests/product/columns-local.mjs` | PASS; exit 0; 12 reported groups; 3 recorded browser exits |
| `TACHIKO_TEST_SINGLE_PROCESS=1 WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell WORK_DIST=dist-acceptance TABLE_ROWS_OUT=/private/tmp/sheet-215/rows node tests/product/new-table-rows-local.mjs` | PASS; exit 0; 44 reported groups; 2 recorded browser exits |
| `TACHIKO_TEST_SINGLE_PROCESS=1 pnpm test:unit` | PASS; exit 0; 715/715 Vitest tests (43 files), 145/145 Node tests |
| `pnpm verify:core-kit` | PASS; exit 0; Qualified producer tuple and complete C1 inventory |
| `WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell pnpm qualification:j3-public-composition` | PASS; exit 0; PASS_COMPOSITION_SUBSET_ONLY; normal UI, host durability and browser restart NOT_TESTED; fullJ3 NOT_PASS |
| `WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell pnpm qualification:j4-public-composition` | PASS; exit 0; PASS_PREPARATION_CORE_BOUNDARY_ONLY; normal UI, host durability and real IME/accessibility NOT_TESTED |
| `CARGO_TARGET_DIR=/Users/tachikoma/Developer/tachiko-work/target cargo test --locked --manifest-path src-tauri/Cargo.toml` | NOT RUN: disk threshold; NOT RUN: 4.147 GiB free, below the required 5 GiB admission threshold |
| `diff -qr /Users/tachikoma/Developer/tachiko-kit-build/out-3d071daf/kit /Users/tachikoma/Developer/tachiko-kit-build/lead-repro-3d071daf/kit` | PASS; exit 0 |
| `diff -qr /Users/tachikoma/Developer/tachiko-kit-build/out-3d071daf/kit public/core-kit` | PASS; exit 0 |
| `rtk git diff --check` | PASS; exit 0 |


The two directory comparisons above initially passed before vendoring/adoption and were repeated in the table. Additional bounded scope/byte checks PASS: all 25 file hashes match the lead receipt; native/J3/J4 exact substitutions only; previous verifier tuples unchanged; pnpm package/lock unchanged; no product/workflow/frozen-runner changes. `git diff --check` is also repeated after writing this handback before commit.

Sampled disk minimum: **3908980736 bytes (3.641 GiB)**; sampled maximum: **7208960000 bytes (6.714 GiB)** across the logged commands. Initial intake `df -h ~` separately reported 7.7 GiB free (rounded, before monitored commands). The 3 GiB stop was never reached. Native Cargo was **NOT RUN**, because its admission check found 4.147 GiB free, below 5 GiB. The target already had 143 entries in `debug/incremental`; no native test was started and no existing incremental directory or other file was deleted.

All **46** recorded focused-lane browser PIDs were independently rechecked absent; the runners also recorded their actual exits. Readback: `/private/tmp/sheet-215/process-exits.json`. All runner invocations supplied the requested `WORK_CHROMIUM`; the unchanged `save-update-local.mjs` does not consume that override and uses Playwright's default headless executable. A supplemental attempt to inspect Playwright's internal default registry path failed with `ERR_MODULE_NOT_FOUND` (`lib/server/registry/index.js` is absent in this installed package); this was a diagnostic failure, not a product-gate result. The supported `pnpm exec playwright install --dry-run chromium` then succeeded and confirmed the default headless-shell revision 1234 and installation directory match the requested shell. No browser was launched or downloaded by this diagnostic; no runner or package changed. A scope-check assertion initially treated RTK's `Changes:` presentation header as a filename; normalizing only that header/blank lines resolved the diagnostic and the exact staged allowlist passed. Initial zsh startup emitted an fnm multishell permission warning; subsequent commands used `/bin/bash`.

Full `pnpm acceptance:product`, native Cargo test, hosted Web/macOS, fresh independent exact-candidate review, integration, merge and deployment are not claimed. Remaining lead work: native host gate when disk permits, full product/hosted gates and fresh independent candidate review before integration. `.serena/project.yml` is a preserved pre-existing change, excluded from the commit. `HANDBACK-215.md` remains untracked by request. No push or PR is created.

## Commit handoff

Scoped changes are committed locally with message `chore(kit): re-pin to Work 3d071daf for public edit_cells (#215)`. The final commit SHA and precise remaining work are recorded in untracked `HANDBACK-215.md` after commit. This document does not self-award Final Candidate status or independent review.

## Inventory

All paths are relative to `public/core-kit`; the manifest is included in this 25-file inventory.

| File | SHA-256 |
| --- | --- |
| `README.md` | `d5257c7979b0b9fd5751ded85f47984cbb89caaf3236c7ef74b250dc842ec783` |
| `artifact-manifest.json` | `a1c0a40798d541b620d6afe1a6bfd6671622ab39026d87ab00e2eb1596a721d7` |
| `designer_runtime.wasm` | `2d5ca856eda577a8d5d4f0da7f0229755067eec8d9cf67840a03f313eb3ee8dc` |
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
| `runtime/protocol.d.ts` | `8aa2dd853140aaee31946b1f7d2243e62b776982cba493b24bffde122b84fdf7` |
| `runtime/protocol.js` | `090a3f5d26d2765d53ad6a3a9a4533937d34adfb99700bc3869218cccf0a1bbc` |
| `runtime/wasm-bridge.d.ts` | `114eea5a61db945ddc554050b4df34b86298acdd77500124cb85e3e06d9081f4` |
| `runtime/wasm-bridge.js` | `4ce8ff2ab09088211800861ef2404362e6913514e7ca114a7cc99fbbb3760b6e` |
| `runtime/worker-client.d.ts` | `facd3465a4b946d1327e176f93b39c3b02a3b129f8715671acca47e9d82bb82f` |
| `runtime/worker-client.js` | `73c9cf3b935b18332bb63f1095cfe6adb902ccd301c9a18db0f1ed87b5d00ea0` |
| `runtime/worker-runtime.d.ts` | `657179a14c93df62c7a8d2e0718076082c3d53ed30b94f3f23b21cc8608587c3` |
| `runtime/worker-runtime.js` | `b2c0ed8e317ded0c38e1775418f8ca597b19d52062f2d131751e5b5476915bce` |
