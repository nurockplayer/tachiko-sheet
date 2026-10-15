# #195 producer adoption handback

Sole bounded implementation/test writer. Opus 5.5 remains Mission Lead/integrator. No Work source changes, merge, deployment or review-thread resolution.

## Producer provenance

Exact Work `16545c55e49dfb4de5b55fd46e2260fd82ff4a58`, clean detached checkout `/Users/tachikoma/Developer/tachiko-kit-build/work-16545c55`.

Unchanged exporter command from that checkout:

```sh
PATH=/opt/homebrew/bin:$PATH TMPDIR=/private/tmp /opt/homebrew/bin/bash scripts/export-experimental-designer-client.sh /Users/tachikoma/Developer/tachiko-kit-build/out-16545c55/kit
```

Repeated to `out-16545c55-rebuild/kit`; all 25 files match byte for byte. First output vendored intact in `public/core-kit`. Manifest sourceCommit and all manifest-listed hashes verified. Same toolchain/physical TMPDIR as required by #178 reproducibility. Manifest SHA-256: `41f452f2d24d022e650124c27ad5bbc82865a1ee56f7bf86c5043228a31c07a7`.

Web lock and all seven native Work Cargo entries pin the same exact source. Cargo.lock changes only seven Work source references; pnpm dependency lock unchanged. [Writer acquisition receipt](https://github.com/nurockplayer/tachiko-sheet/issues/195#issuecomment-6182811855) explicitly leaves independent lead artifact reproduction/review pending. No independent final-review credit. Initial Apple Bash 3.2 attempt failed parsing `[[ -v ]]`; installed Bash 5.3 via PATH fixed the environment without producer changes.

## Behavior and routing

Native UI labels use Work's effective display_name: grid, row entry, table selector, summary pickers, Brief facts, cleanup review. Existing import source labels retain their presentation role. Operations still use keys/IDs. New table sends untouched strings to Work; typed input locators drive inline plain-language refusals. Sheet does not duplicate Work spelling/trim/uniqueness/key-allocation rules.

Acknowledged New table carries ephemeral requiresPortableSave host evidence through edit/history/Refresh. Save, Save a copy, bound Save and Close→Save use the existing work-file carrier and Work portable bytes. Reopened copies use existing portable admission. No new envelope, host record member, database version or codec; no existing record rewrites. Other canonical/opaque/Date/Sales/import routing stays unchanged. Download .ro uses existing portable export.

Summary creation retains the Work publication receipt for local history knowledge. Undo/Redo reads the complete current Work definition inventory, allowing creation Undo to remove its definition. Scalar edit partial-summary observations still fail closed.

Rollback to a pre-name-capable Work pin cannot reopen name-bearing v3/.ro records (ADR-0043). Preserve them; never down-convert or rewrite.

## Regression evidence

New production-browser lane first failed on the base ASCII rule. Candidate covers empty/duplicate/over-long/control refusals with draft retention; spaces/case/CJK; every cell; allocated keys/stable IDs; lost post-publication projection→Refresh without replay; Save before summary; summary creation/edit Undo/Redo; Q4 Save→real browser PID exit→same-profile reopen; bound Save; Close→Save; Save a copy; .ro Download→Open→Save. Separate public Work-client oracle opens persisted bytes and checks every projected name/key/ID/value and summary against fixed expected values.

The one native table supplies both ID-bound sides of the actual cross-table definition: Item Name lookup/product key, 項目 category, Amount quantity/price. Expected outputs: 16/9, then 25/9 after edit. No fixture/private runtime hook/frontend calculation supplies product results.

Existing new-table tests retain focus/row/recovery/replay assertions. Intended expectation updates are typed-case labels, raw dispatch, producer-owned invalid-name refusals and portable Save. Old ASCII-only refusal examples Bad name and _Bad are valid now; whitespace/control examples retain the refusal coverage.

## Inventory

| File | SHA-256 |
| --- | --- |
| `README.md` | `d5257c7979b0b9fd5751ded85f47984cbb89caaf3236c7ef74b250dc842ec783` |
| `artifact-manifest.json` | `41f452f2d24d022e650124c27ad5bbc82865a1ee56f7bf86c5043228a31c07a7` |
| `designer_runtime.wasm` | `4a4b6a57b84c754e640c103932f9ed889c2097051dfe2c89a8ec23eee9a7624e` |
| `experimental-client.d.ts` | `aa4d5309e39008e07712ce525e7c07e2b85311d16e0617159e27c16da4d70198` |
| `experimental-client.js` | `bd53c548b64db958ea78efe421141b5056a089921c1541b1d29c63f22b043391` |
| `experimental-client.worker.d.ts` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `experimental-client.worker.js` | `669f02aece146ae108033ca04ed808a633012c6b576e20b6d6bdf59f10ca003e` |
| `host/project-transfer.d.ts` | `5604bc40651eae3a0987f8e03fb2c66b8d2cea91fc2212890e2a390c3f0edea5` |
| `host/project-transfer.js` | `8b489f3a7ca1c5a814ddd1754b746592a0bc11d0d13a6434c41586c137257531` |
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
