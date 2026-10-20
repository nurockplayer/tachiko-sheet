# #228 Work kit handback — 375da29f

This successor supersedes the d0198466 acquisition recorded in commit 8a5fbcd.
It includes Work #559 structural spreadsheet export for imported tables, under
ADR-0045 and the lead's decided reconciliation for #228 / slice (a) of #227.

## Separate writer reproduction

- Clean detached source: `~/Developer/tachiko-kit-build/work-375da29f-writer`.
- Exact HEAD: `375da29f7c67ed74bace7d214ef23716d2e2237b`.
- Dirty files: **0 before and 0 after** export (including untracked files).
- Unchanged exporter command, run from that source checkout:

```sh
PATH=/opt/homebrew/bin:$PATH TMPDIR=/private/tmp /opt/homebrew/bin/bash scripts/export-experimental-designer-client.sh ~/Developer/tachiko-kit-build/out-375da29f-writer/kit
```

Exit **0**. Output `sourceCommit` is the exact source above. All **25** files
match every path and SHA-256 in the [separate lead reproduction receipt](https://github.com/nurockplayer/tachiko-sheet/issues/228#issuecomment-6288021040).
The complete file sets were compared, including the manifest itself; no extra
or missing files. Manifest SHA-256:
`43910ca78d2ac037215770a97f0bf4dc88d4114bbfa6b2ce5e64c868ddd075e3`.

The source checkout was not modified. Only the exact reproduced output was
copied into `public/core-kit`. Acquisition does not establish product acceptance,
hosted checks, native-host qualification, or independent candidate review.
Actual Sheet checks and any remaining gaps are in untracked `HANDBACK-228.md`.

## SHA256SUMS (writer and lead, identical)

```text
d5257c7979b0b9fd5751ded85f47984cbb89caaf3236c7ef74b250dc842ec783  README.md
43910ca78d2ac037215770a97f0bf4dc88d4114bbfa6b2ce5e64c868ddd075e3  artifact-manifest.json
3d3159d3d250f5588311e7a81bcc492acb9fea9d2c4db1ec4bcf93af71330b03  designer_runtime.wasm
5e1633faa5dafab2fc769ed84010eed2eb3a08732dc715f7e4c6547d00aa3ff4  experimental-client.d.ts
bd53c548b64db958ea78efe421141b5056a089921c1541b1d29c63f22b043391  experimental-client.js
8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881  experimental-client.worker.d.ts
669f02aece146ae108033ca04ed808a633012c6b576e20b6d6bdf59f10ca003e  experimental-client.worker.js
5604bc40651eae3a0987f8e03fb2c66b8d2cea91fc2212890e2a390c3f0edea5  host/project-transfer.d.ts
603a95431d3483e5668bd7a065e4d04c69d5c4c988eeab920303f914ce097d07  host/project-transfer.js
c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4  notices/LICENSE-APACHE
8fbbe1bd4ec8eed2985f3e9d225124af632ea6a911b95b9700d3ac44c87c062d  notices/LICENSE-MIT
b36a66d6709929fe638ce6b472918d2fc64107d58e8ffe95b86cfb7d293536e5  notices/THIRD_PARTY_LICENSES.md
6aed801a764caaa3cfd5d8b4bb8d5afa41616f1746d44762c63836ea63b61748  package.json
df7af27be28cb6f71c1777f5cdc478a9eab6bff9f449c21d73567765ed63589f  runtime/client.d.ts
9ccbdfa476c20c53d2cbbd681586f527b3afab59590867479469f34ebebc2632  runtime/client.js
43fa356263fb148c9088ebd0ba8880976516d8573e327d3a837430d045b13e00  runtime/interop-protocol.d.ts
8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881  runtime/interop-protocol.js
418d0c2eccc7337a400d316ebf07bbe570b2d83907852fb6858d005214836467  runtime/protocol.d.ts
090a3f5d26d2765d53ad6a3a9a4533937d34adfb99700bc3869218cccf0a1bbc  runtime/protocol.js
114eea5a61db945ddc554050b4df34b86298acdd77500124cb85e3e06d9081f4  runtime/wasm-bridge.d.ts
4ce8ff2ab09088211800861ef2404362e6913514e7ca114a7cc99fbbb3760b6e  runtime/wasm-bridge.js
10d05912423cf1005260597c8420dcb5f5d121170c9a1f0d690097a6df9591dd  runtime/worker-client.d.ts
2f137f2160a65c67dfbdd6b6d9502037a9c09bc76247712ce3410572f462cdb8  runtime/worker-client.js
657179a14c93df62c7a8d2e0718076082c3d53ed30b94f3f23b21cc8608587c3  runtime/worker-runtime.d.ts
b2c0ed8e317ded0c38e1775418f8ca597b19d52062f2d131751e5b5476915bce  runtime/worker-runtime.js
```
