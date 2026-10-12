# Sheet #160 kit acquisition handback

Acquired with Work's unchanged `bash scripts/export-experimental-designer-client.sh`
from the clean detached `/Users/tachikoma/Developer/tachiko-work-kit-b1560ab4`.
The dirty main Work clone was not used. Work source was not modified.

- Source: `b1560ab4331847557f04dfd6833fbffcabfc1169`
- Git tree: `438db169226f065ad8e9490891ca1bb886fc1027`
- Output: `/Users/tachikoma/Developer/tachiko-kit-build/out-b1560ab4`
- Repeated export: sibling `repro-b1560ab4`; all 25 files byte-identical.
- Node: `v26.10.0`; pnpm: `12.11.2`
- rustc: `1.97.1 (8bab26f4f 2026-07-14)`
- cargo: `1.97.1 (c980f4866 2026-06-30)`
- Both exports: PASS. Exporter frozen install, Rust/WASM and TypeScript build completed.

This acquisition receipt does not establish consumer acceptance or independent
candidate review. Those checks are reported on the candidate PR. The previous
#160 attempt failed before build because staging beside its output was denied;
this attempt used the authorized writable staging parent.

## SHA-256 inventory

The inventory includes the manifest itself. The producer manifest enumerates
all remaining files; none were edited after export.

| Path | SHA-256 |
| --- | --- |
| `README.md` | `8fdb32b2859e2e5ec0b0c494479bc7515d86c61733ce437f65379fa5eed4b646` |
| `artifact-manifest.json` | `94396e8fcd8cea32a4d120ca9087e0dde5bdd4adf2389f370eb1d6b96a2ff28a` |
| `designer_runtime.wasm` | `2b5d9c246066c61cfccd1529e3da1d331b4646b36b155d9ed385e3554ead7072` |
| `experimental-client.d.ts` | `5854750b3932bbcc87968644940182ab02d0ccb71fb68b299700ff8f6e690be9` |
| `experimental-client.js` | `dc117ed7ab28c4722e392c5c070c1eaa26596a9a22c7c33a2f63bf495e7119d4` |
| `experimental-client.worker.d.ts` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `experimental-client.worker.js` | `669f02aece146ae108033ca04ed808a633012c6b576e20b6d6bdf59f10ca003e` |
| `host/project-transfer.d.ts` | `5604bc40651eae3a0987f8e03fb2c66b8d2cea91fc2212890e2a390c3f0edea5` |
| `host/project-transfer.js` | `a16611056c03a0912e69e73e912a9db2481897365c71456e39e43ac032262d8c` |
| `notices/LICENSE-APACHE` | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `notices/LICENSE-MIT` | `8fbbe1bd4ec8eed2985f3e9d225124af632ea6a911b95b9700d3ac44c87c062d` |
| `notices/THIRD_PARTY_LICENSES.md` | `b36a66d6709929fe638ce6b472918d2fc64107d58e8ffe95b86cfb7d293536e5` |
| `package.json` | `6aed801a764caaa3cfd5d8b4bb8d5afa41616f1746d44762c63836ea63b61748` |
| `runtime/client.d.ts` | `087acb587462bdc6ce3b51b1f84c91e0f8a874f062c88ef1480b014819ddbdf1` |
| `runtime/client.js` | `9ccbdfa476c20c53d2cbbd681586f527b3afab59590867479469f34ebebc2632` |
| `runtime/interop-protocol.d.ts` | `4c688f28a390cd05d50a8a4e3673335905f8e5f576e373a9a5906466dc37014e` |
| `runtime/interop-protocol.js` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `runtime/protocol.d.ts` | `4c0b6217d4e32af801f7d1208b5bb797588ca3910da3114b95112236340cea66` |
| `runtime/protocol.js` | `090a3f5d26d2765d53ad6a3a9a4533937d34adfb99700bc3869218cccf0a1bbc` |
| `runtime/wasm-bridge.d.ts` | `114eea5a61db945ddc554050b4df34b86298acdd77500124cb85e3e06d9081f4` |
| `runtime/wasm-bridge.js` | `4ce8ff2ab09088211800861ef2404362e6913514e7ca114a7cc99fbbb3760b6e` |
| `runtime/worker-client.d.ts` | `1b29c508bfd117eec5842c4bcd00b9cedf3580aa4240a34cb6b12ace863881cb` |
| `runtime/worker-client.js` | `92acdbeead22c6b3ce275bc5c3151c24d981614c4e6a63debe510483bfbb1a89` |
| `runtime/worker-runtime.d.ts` | `657179a14c93df62c7a8d2e0718076082c3d53ed30b94f3f23b21cc8608587c3` |
| `runtime/worker-runtime.js` | `b2c0ed8e317ded0c38e1775418f8ca597b19d52062f2d131751e5b5476915bce` |
