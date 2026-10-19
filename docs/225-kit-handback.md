# #225 producer adoption handback

## Current producer — PR #226 round-2 inventory repair

Bounded re-pin writer: GPT-6.1 Sol/high; lead/integrator: Claude Opus 5.5 under #208. One new commit is appended to Sheet `ab5c7f32acef86d0cf5c3471d567e3d5d11a554c` on `opus/225-native-export`; no history rewrite, push, or product source change is part of this repair. This current producer section supersedes the historical initial adoption below.

### Provenance and reproduction

Exact Work `353c6e948b78eeee07f6e77bd350a54070c1c280`, from clean detached checkout `/Users/tachikoma/Developer/tachiko-kit-build/work-353c6e94-writer`. Exact HEAD, detached state and zero staged/unstaged/untracked files verified before export; exact HEAD and zero dirty files verified again afterward. The exporter is byte-identical to the prior Work `4e6b2c9d` exporter. No Work source changes.

```sh
PATH=/opt/homebrew/bin:$PATH TMPDIR=/private/tmp /opt/homebrew/bin/bash scripts/export-experimental-designer-client.sh /Users/tachikoma/Developer/tachiko-kit-build/out-353c6e94/kit
diff -qr /Users/tachikoma/Developer/tachiko-kit-build/out-353c6e94/kit /Users/tachikoma/Developer/tachiko-kit-build/lead-repro-353c6e94/kit
diff -qr /Users/tachikoma/Developer/tachiko-kit-build/out-353c6e94/kit public/core-kit
```

Export and comparisons PASS, exit 0. All 25 files match the [independent lead reproduction](https://github.com/nurockplayer/tachiko-sheet/issues/225#issuecomment-6273009850) byte for byte and are vendored intact. Manifest SHA-256: `a680af0a7f230b84e735fa2075360362c510139b49d5021f0101498c0d1268c3`. Against the previous vendor only `artifact-manifest.json` and `designer_runtime.wasm` change.

The manifest adds all seven previously omitted methods: `exportNativeTablesSpreadsheet`, `newTable`, `explainField`, `openImportedProject`, `duplicateCollection`, `createKeyedGroupedSum`, `queryKeyedGroupedSum`. Work #548/#549 provides the producer repair and parity guard; this Sheet writer claims byte reproduction and the actual Sheet gates below, not a separately executed producer parity test.

The lock and new verifier tuple cite the new lead receipt. All prior verifier tuples, including `4e6b2c9d` and `3d071daf`, remain byte-identical for rollback. Native Cargo files change only the Work rev (seven Cargo.lock sources). J3 changes only `core_source` and `core_manifest_sha256`; J4 changes only the matching two constants. Product source, other tests/drivers, frozen #146 files, workflows, package.json and pnpm lockfile remain unchanged. Independent kit reproduction is separate from independent exact-candidate review.

### Actual gates and remaining lead work

All requested local gates PASS, exit 0; commands ran serially. Full logs, elapsed times and disk samples: `/private/tmp/sheet-225-repin-353c6e94/results.jsonl` and adjacent named logs. No material source/pin change followed these checks.

| Literal command | Actual result |
| --- | --- |
| `PATH=/opt/homebrew/bin:$PATH TMPDIR=/private/tmp /opt/homebrew/bin/bash scripts/export-experimental-designer-client.sh /Users/tachikoma/Developer/tachiko-kit-build/out-353c6e94/kit` | PASS; exit 0; unchanged exporter; exact clean detached Work source; 25 files match lead |
| `pnpm typecheck` | PASS; exit 0 |
| `TACHIKO_TEST_SINGLE_PROCESS=1 pnpm test:unit` | PASS; exit 0; 739/739 Vitest in 45 files; 145/145 Node |
| `pnpm verify:core-kit` | PASS; exit 0 |
| `PYTHONDONTWRITEBYTECODE=1 NODE_OPTIONS=--import=/private/tmp/sheet-225-repin-353c6e94/chromium-single-process.mjs WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell pnpm qualification:j3-public-composition` | PASS; exit 0; PASS_COMPOSITION_SUBSET_ONLY; fullJ3 NOT_PASS; normal UI/host durability/restart NOT_TESTED |
| `PYTHONDONTWRITEBYTECODE=1 NODE_OPTIONS=--import=/private/tmp/sheet-225-repin-353c6e94/chromium-single-process.mjs WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell pnpm qualification:j4-public-composition` | PASS; exit 0; PASS_PREPARATION_CORE_BOUNDARY_ONLY; normal UI/host durability/real IME/accessibility NOT_TESTED |
| `pnpm build` | PASS; exit 0; production hook exclusion PASS (85 files) |
| `pnpm build:acceptance` | PASS; exit 0 |
| `TACHIKO_TEST_SINGLE_PROCESS=1 WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell WORK_DIST=dist node tests/product/native-export-local.mjs` | PASS; exit 0 |
| `TACHIKO_TEST_SINGLE_PROCESS=1 WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell WORK_DIST=dist-acceptance COLUMNS_OUT=/private/tmp/sheet-225-repin-353c6e94/columns node tests/product/columns-local.mjs` | PASS; exit 0 |
| `TACHIKO_TEST_SINGLE_PROCESS=1 WORK_CHROMIUM=/Users/tachikoma/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell WORK_DIST=dist-acceptance node tests/product/j4-imported-attachment-local.mjs` | PASS; exit 0 |
| `rtk git diff --check` | PASS; exit 0 |

J3/J4 use the same external, launch-only single-process preload as the initial writer run; their driver code/assertions and the exact requested Chromium executable are unchanged. `PYTHONDONTWRITEBYTECODE=1` prevents generated Python cache files. Product browser lanes use their existing single-process support. Qualification scopes above are not full product/host qualification.

`df -h ~` ran before each monitored step; minimum sampled free space: **12,902,400,000 bytes (12.016 GiB)**. The monitor's 3 GiB stop was never reached. No native Cargo, packaged host, full product runner, hosted CI or fresh independent round-3 review was run for this re-pin; these are not claimed. Opus owns hosted gates, the new exact-candidate review, push and integration. `HANDBACK-225.md` stays untracked.

### Current inventory

All paths are relative to `public/core-kit`; manifest included.

| File | SHA-256 |
| --- | --- |
| `README.md` | `d5257c7979b0b9fd5751ded85f47984cbb89caaf3236c7ef74b250dc842ec783` |
| `artifact-manifest.json` | `a680af0a7f230b84e735fa2075360362c510139b49d5021f0101498c0d1268c3` |
| `designer_runtime.wasm` | `44db5a240b613e755ad34746b679ecd53261918f220444bc7dd62726d63dcb5b` |
| `experimental-client.d.ts` | `60b3aa9c35f8a5753e91d024b3483f21df5c3e45e0a80f36a1c185baa182ae37` |
| `experimental-client.js` | `bd53c548b64db958ea78efe421141b5056a089921c1541b1d29c63f22b043391` |
| `experimental-client.worker.d.ts` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `experimental-client.worker.js` | `669f02aece146ae108033ca04ed808a633012c6b576e20b6d6bdf59f10ca003e` |
| `host/project-transfer.d.ts` | `5604bc40651eae3a0987f8e03fb2c66b8d2cea91fc2212890e2a390c3f0edea5` |
| `host/project-transfer.js` | `603a95431d3483e5668bd7a065e4d04c69d5c4c988eeab920303f914ce097d07` |
| `notices/LICENSE-APACHE` | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `notices/LICENSE-MIT` | `8fbbe1bd4ec8eed2985f3e9d225124af632ea6a911b95b9700d3ac44c87c062d` |
| `notices/THIRD_PARTY_LICENSES.md` | `b36a66d6709929fe638ce6b472918d2fc64107d58e8ffe95b86cfb7d293536e5` |
| `package.json` | `6aed801a764caaa3cfd5d8b4bb8d5afa41616f1746d44762c63836ea63b61748` |
| `runtime/client.d.ts` | `4bd166087dad85e4b67cc036a6d8aa60e3cd6800f4376af4328a3b59f21a85f9` |
| `runtime/client.js` | `9ccbdfa476c20c53d2cbbd681586f527b3afab59590867479469f34ebebc2632` |
| `runtime/interop-protocol.d.ts` | `43fa356263fb148c9088ebd0ba8880976516d8573e327d3a837430d045b13e00` |
| `runtime/interop-protocol.js` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `runtime/protocol.d.ts` | `8aa2dd853140aaee31946b1f7d2243e62b776982cba493b24bffde122b84fdf7` |
| `runtime/protocol.js` | `090a3f5d26d2765d53ad6a3a9a4533937d34adfb99700bc3869218cccf0a1bbc` |
| `runtime/wasm-bridge.d.ts` | `114eea5a61db945ddc554050b4df34b86298acdd77500124cb85e3e06d9081f4` |
| `runtime/wasm-bridge.js` | `4ce8ff2ab09088211800861ef2404362e6913514e7ca114a7cc99fbbb3760b6e` |
| `runtime/worker-client.d.ts` | `e366b31d8ebfcffc31c7690fd4df8c3608859799cc44b86d3d654fc28390dfaa` |
| `runtime/worker-client.js` | `481b6e79a381da80efdad3a6c28ab90d248900e517cf234b54324345347b8f52` |
| `runtime/worker-runtime.d.ts` | `657179a14c93df62c7a8d2e0718076082c3d53ed30b94f3f23b21cc8608587c3` |
| `runtime/worker-runtime.js` | `b2c0ed8e317ded0c38e1775418f8ca597b19d52062f2d131751e5b5476915bce` |

---

## Historical initial adoption — Work 4e6b2c9d

The remainder records the original two-commit implementation intake and its earlier producer. It is historical; the current pin and gates are above.


Sole bounded implementation/test writer: GPT-6.1 Sol/high, branch `opus/225-native-export`, from Sheet `2ecdf02de22c97f9ae66625cfe7d660c8a984aec`. Claude Opus 5.5 owns lead/integration under #208, hosted qualification, independent candidate review and merge. This first commit contains the re-pin only; the product follows separately.

## Producer provenance

Exact Work `4e6b2c9d6aec069a0f5291fa0a1298d9fa095b6f`, clean detached checkout `/Users/tachikoma/Developer/tachiko-kit-build/work-4e6b2c9d-writer`. Exact HEAD and zero staged, unstaged or untracked files verified before and after export; symbolic-ref confirms detached HEAD. Work sources and exporter are unchanged.

```sh
PATH=/opt/homebrew/bin:$PATH TMPDIR=/private/tmp /opt/homebrew/bin/bash scripts/export-experimental-designer-client.sh /Users/tachikoma/Developer/tachiko-kit-build/out-4e6b2c9d/kit
diff -qr /Users/tachikoma/Developer/tachiko-kit-build/out-4e6b2c9d/kit /Users/tachikoma/Developer/tachiko-kit-build/lead-repro-4e6b2c9d/kit
diff -qr /Users/tachikoma/Developer/tachiko-kit-build/out-4e6b2c9d/kit public/core-kit
pnpm verify:core-kit
```

All four commands PASS, exit 0. All 25 files match the independent lead build byte for byte and are vendored intact. Manifest SHA-256: `fd7d2655b53655a8022ecd0bcba0f8cd80dac43bc8fb1f7a59d3c68868abe180`. Public declarations expose `exportNativeTablesSpreadsheet`.

[Independent lead reproduction receipt](https://github.com/nurockplayer/tachiko-sheet/issues/225#issuecomment-6267426558) supplies the acquisition and independent build provenance. The lock and new verifier tuple cite that actual receipt. The `3d071daf` rollback tuple and all older verifier tuples remain unchanged. Producer reproduction is separate from product acceptance and independent exact-candidate review.

## Adoption and regression

Web lock and seven native Cargo Work entries pin the same source. Cargo.toml/Cargo.lock change Work rev strings only. J3 corpus changes only `core_source` and `core_manifest_sha256`; J4 changes only the matching two constants. No product source, Work source, frozen #146 drivers, workflow, pnpm dependencies or lockfile changes belong to this commit. Existing compatibility and record-preservation boundaries remain.

## Actual gates and remaining work

Export output: `/private/tmp/sheet-225/export.log`. Pin verifier log: `/private/tmp/sheet-225/pin-verification.log`; literal command, exit, elapsed and disk sample: `/private/tmp/sheet-225/results.jsonl`. `df -h ~` before export reported 6.7 GiB free; during export a subsequent check reported 6.6 GiB. Verifier admission/free sample: 7,199,244,288 bytes. No under-3-GiB condition observed. Full requested gates follow the product commit and are recorded in untracked `HANDBACK-225.md`; this document makes no unrun qualification, native-host, hosted, final-review or merge claim.

Pre-existing `.serena/project.yml` change is preserved and excluded. No push or PR creation is assigned to this writer.

## Inventory

All paths are relative to `public/core-kit`; manifest included.

| File | SHA-256 |
| --- | --- |
| `README.md` | `d5257c7979b0b9fd5751ded85f47984cbb89caaf3236c7ef74b250dc842ec783` |
| `artifact-manifest.json` | `fd7d2655b53655a8022ecd0bcba0f8cd80dac43bc8fb1f7a59d3c68868abe180` |
| `designer_runtime.wasm` | `7745c04cfd3e7e928fcdc818b39afc98d006e394039363213175a05809cdfe37` |
| `experimental-client.d.ts` | `60b3aa9c35f8a5753e91d024b3483f21df5c3e45e0a80f36a1c185baa182ae37` |
| `experimental-client.js` | `bd53c548b64db958ea78efe421141b5056a089921c1541b1d29c63f22b043391` |
| `experimental-client.worker.d.ts` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `experimental-client.worker.js` | `669f02aece146ae108033ca04ed808a633012c6b576e20b6d6bdf59f10ca003e` |
| `host/project-transfer.d.ts` | `5604bc40651eae3a0987f8e03fb2c66b8d2cea91fc2212890e2a390c3f0edea5` |
| `host/project-transfer.js` | `603a95431d3483e5668bd7a065e4d04c69d5c4c988eeab920303f914ce097d07` |
| `notices/LICENSE-APACHE` | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `notices/LICENSE-MIT` | `8fbbe1bd4ec8eed2985f3e9d225124af632ea6a911b95b9700d3ac44c87c062d` |
| `notices/THIRD_PARTY_LICENSES.md` | `b36a66d6709929fe638ce6b472918d2fc64107d58e8ffe95b86cfb7d293536e5` |
| `package.json` | `6aed801a764caaa3cfd5d8b4bb8d5afa41616f1746d44762c63836ea63b61748` |
| `runtime/client.d.ts` | `4bd166087dad85e4b67cc036a6d8aa60e3cd6800f4376af4328a3b59f21a85f9` |
| `runtime/client.js` | `9ccbdfa476c20c53d2cbbd681586f527b3afab59590867479469f34ebebc2632` |
| `runtime/interop-protocol.d.ts` | `43fa356263fb148c9088ebd0ba8880976516d8573e327d3a837430d045b13e00` |
| `runtime/interop-protocol.js` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `runtime/protocol.d.ts` | `8aa2dd853140aaee31946b1f7d2243e62b776982cba493b24bffde122b84fdf7` |
| `runtime/protocol.js` | `090a3f5d26d2765d53ad6a3a9a4533937d34adfb99700bc3869218cccf0a1bbc` |
| `runtime/wasm-bridge.d.ts` | `114eea5a61db945ddc554050b4df34b86298acdd77500124cb85e3e06d9081f4` |
| `runtime/wasm-bridge.js` | `4ce8ff2ab09088211800861ef2404362e6913514e7ca114a7cc99fbbb3760b6e` |
| `runtime/worker-client.d.ts` | `e366b31d8ebfcffc31c7690fd4df8c3608859799cc44b86d3d654fc28390dfaa` |
| `runtime/worker-client.js` | `481b6e79a381da80efdad3a6c28ab90d248900e517cf234b54324345347b8f52` |
| `runtime/worker-runtime.d.ts` | `657179a14c93df62c7a8d2e0718076082c3d53ed30b94f3f23b21cc8608587c3` |
| `runtime/worker-runtime.js` | `b2c0ed8e317ded0c38e1775418f8ca597b19d52062f2d131751e5b5476915bce` |
