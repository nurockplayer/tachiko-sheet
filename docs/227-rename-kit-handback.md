# #227 imported Rename kit writer proof

Work source: `4e51942a6b8c83bb691bef4308b264d9104a18a5`; clean detached checkout
`~/Developer/tachiko-kit-build/work-4e51942a-writer`.
`git status --porcelain=v1 --untracked-files=all`: 0 dirty files before and after
export; `git rev-parse --abbrev-ref HEAD`: `HEAD` (detached). Source was not edited.

Unchanged exporter, run from that checkout:

```sh
PATH=/opt/homebrew/bin:$PATH TMPDIR=/private/tmp /opt/homebrew/bin/bash scripts/export-experimental-designer-client.sh ~/Developer/tachiko-kit-build/out-4e51942a-writer/kit
```

Exit 0. Build log: `/private/tmp/227-kit-build.log`.
Independent lead receipt: https://github.com/nurockplayer/tachiko-sheet/issues/227#issuecomment-6292194963.
Python SHA-256 comparison against the complete inventory in that live receipt:
**25/25 files byte-identical**, identical complete path sets, no missing/extra files.
Manifest SHA-256: `d4c4bb7da05f906075bd93ecb99c1a4b64d348d0ed7130f3ce1b5f37c2a111b8`.
Vendored `public/core-kit` is copied directly from that writer output.
The runtime manifest exposes `columnDisplayNameExplicit`; the public TS
`ColumnProjection` exposes `display_name_explicit?: true`.
This is producer acquisition evidence, not product acceptance or final review.

## Complete receipt-matching inventory

```text
d5257c7979b0b9fd5751ded85f47984cbb89caaf3236c7ef74b250dc842ec783  README.md
d4c4bb7da05f906075bd93ecb99c1a4b64d348d0ed7130f3ce1b5f37c2a111b8  artifact-manifest.json
64ed5e8fd47f4fe97ab9c5ffde6ec9eb8dc4ac7dd328d903980282e85c41ee20  designer_runtime.wasm
af2e847c76acee9bfd2fe22610c8ff55f46471dd17c4eed574dd5b5a9d10f5e3  experimental-client.d.ts
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
12e730e7fa8fadf6dff22264183e3688ffdc64a4ec7ad7d21a4780cc76e0402f  runtime/protocol.d.ts
090a3f5d26d2765d53ad6a3a9a4533937d34adfb99700bc3869218cccf0a1bbc  runtime/protocol.js
114eea5a61db945ddc554050b4df34b86298acdd77500124cb85e3e06d9081f4  runtime/wasm-bridge.d.ts
4ce8ff2ab09088211800861ef2404362e6913514e7ca114a7cc99fbbb3760b6e  runtime/wasm-bridge.js
10d05912423cf1005260597c8420dcb5f5d121170c9a1f0d690097a6df9591dd  runtime/worker-client.d.ts
44bd2c1337b758386dc5693ac8393396f47ffc5b6d325f785ac0fea3b29d57a8  runtime/worker-client.js
657179a14c93df62c7a8d2e0718076082c3d53ed30b94f3f23b21cc8608587c3  runtime/worker-runtime.d.ts
b2c0ed8e317ded0c38e1775418f8ca597b19d52062f2d131751e5b5476915bce  runtime/worker-runtime.js
```
