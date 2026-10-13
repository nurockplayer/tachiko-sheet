# Sheet #131 / #134 shared kit acquisition handback

Acquired with Work's unchanged `bash scripts/export-experimental-designer-client.sh`
from the clean detached `/Users/tachikoma/Developer/tachiko-work-qual`.
The exporter materialized exact captured source and built under `/private/tmp`;
Work source was not modified.

- Source: `d60fc65bc0e6b78ceab5ddeff9afbc241f42fc1e`
- Git tree: `6238761e2c6305dd91f39ea14eefd3b0244da0c0`
- Output: `/private/tmp/sheet-repin-d60fc65b/export-a`
- Repeated export: sibling `export-b`; all 25 files byte-identical.
- Node: `v26.10.0`; pnpm: `12.11.2`
- rustc: `1.97.1 (8bab26f4f 2026-07-14)`
- cargo: `1.97.1 (c980f4866 2026-06-30)`
- Both exports: PASS. Frozen pnpm install, locked Rust/WASM and TypeScript build completed.

The exact local artifact received a [fresh independent read-only provenance
review and handback](https://github.com/nurockplayer/tachiko-sheet/issues/131#issuecomment-6149346076): no blocking findings within artifact provenance.
The reviewer checked clean exact source, all 850 source blobs/modes, exporter
provenance, all 25 files, every manifest hash and source notices. Generic
Codex/GPT-6 identity is exposed; exact variant/effective effort is unexposed.
This receipt establishes neither independent final candidate approval nor
consumer product acceptance. Actual consumer commands/results belong on the PR.

## SHA-256 inventory

The inventory includes the manifest itself. The producer manifest enumerates
all remaining files; none were edited after export.

| Path | SHA-256 |
| --- | --- |
| `README.md` | `0f243a4762d7bcf5edfc24f1f7110ba12bc54616b2b4a022a891d81a4a18128e` |
| `artifact-manifest.json` | `a374ba5d043b3e534f90ab1c34c5076bc8c05822eac3deddb737448d6af605b1` |
| `designer_runtime.wasm` | `dc78c4cfc8f8edd63722cb082954025c25a8f5898adbf01f422d63263bdd8290` |
| `experimental-client.d.ts` | `aa4d5309e39008e07712ce525e7c07e2b85311d16e0617159e27c16da4d70198` |
| `experimental-client.js` | `dc117ed7ab28c4722e392c5c070c1eaa26596a9a22c7c33a2f63bf495e7119d4` |
| `experimental-client.worker.d.ts` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `experimental-client.worker.js` | `669f02aece146ae108033ca04ed808a633012c6b576e20b6d6bdf59f10ca003e` |
| `host/project-transfer.d.ts` | `5604bc40651eae3a0987f8e03fb2c66b8d2cea91fc2212890e2a390c3f0edea5` |
| `host/project-transfer.js` | `a16611056c03a0912e69e73e912a9db2481897365c71456e39e43ac032262d8c` |
| `notices/LICENSE-APACHE` | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `notices/LICENSE-MIT` | `8fbbe1bd4ec8eed2985f3e9d225124af632ea6a911b95b9700d3ac44c87c062d` |
| `notices/THIRD_PARTY_LICENSES.md` | `b36a66d6709929fe638ce6b472918d2fc64107d58e8ffe95b86cfb7d293536e5` |
| `package.json` | `6aed801a764caaa3cfd5d8b4bb8d5afa41616f1746d44762c63836ea63b61748` |
| `runtime/client.d.ts` | `beecf184ca568cae750daf0676b041951cba1c77a065ce4398a8b8664eb46397` |
| `runtime/client.js` | `9ccbdfa476c20c53d2cbbd681586f527b3afab59590867479469f34ebebc2632` |
| `runtime/interop-protocol.d.ts` | `4c688f28a390cd05d50a8a4e3673335905f8e5f576e373a9a5906466dc37014e` |
| `runtime/interop-protocol.js` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `runtime/protocol.d.ts` | `7b3c86f5cce90395c71bb6e2ac060126ab6fc5af152f7532173649731d946dee` |
| `runtime/protocol.js` | `090a3f5d26d2765d53ad6a3a9a4533937d34adfb99700bc3869218cccf0a1bbc` |
| `runtime/wasm-bridge.d.ts` | `114eea5a61db945ddc554050b4df34b86298acdd77500124cb85e3e06d9081f4` |
| `runtime/wasm-bridge.js` | `4ce8ff2ab09088211800861ef2404362e6913514e7ca114a7cc99fbbb3760b6e` |
| `runtime/worker-client.d.ts` | `523bb14954fdf8ff72aefa4f6962d485d44f5531d0821f144580d2ed0e3f0563` |
| `runtime/worker-client.js` | `d31196add79f99596a0d6080f00ef84e5d84aa1183e30b166d31d14c1103a616` |
| `runtime/worker-runtime.d.ts` | `657179a14c93df62c7a8d2e0718076082c3d53ed30b94f3f23b21cc8608587c3` |
| `runtime/worker-runtime.js` | `b2c0ed8e317ded0c38e1775418f8ca597b19d52062f2d131751e5b5476915bce` |

## Consumer coordination and rollback

The intact Web kit and all seven native Work packages are pinned together at
`d60fc65b`, including Work #516 ExplainField and #520 portable `.ro` package v1
on `.roproj/v3`. No product UI or native transport adaptation is introduced.
The exporter capability list omits ExplainField; actual inherited client types,
Worker dispatch and WASM supply it. The real-kit qualification calls the method
on the release-plan priority field, checks formula source/direct inputs and
scalar downstream impact, and refuses a stale revision without changing the
occurrence, exported bytes or Undo history.

J3 changes only the source/manifest tuple. The explicitly authorized J4 oracle
retains canonical-v1 refusal, fixture hashes, private format-2 round trips and
all prior definition/result/diagnostic assertions. It adds portable export,
verification and fresh-client reopen, identical definition bindings and complete
stored values, and explicit v3 export inspection of the reopened definition.
A portable-opened v3 occurrence uses explicit `exportProjectV3`; legacy Save and
private-copy readers are unchanged. Frozen #146 seeds/runners, Date+summary
guard, Save routing and capacity behavior remain consumer gates.

Rollback must retain the b1560ab4-compatible mixed-capacity reader for existing
local copies. A future producer of portable-v1/v3 files needs a d60fc65b-compatible
reader; b1560ab4 is not qualified to reopen those files. This slice creates no
new user-file path, stored data migration or frontend semantic owner. Opus owns
candidate integration/review; signing, notarization and human native-dialog/IME
qualification remain separate owner boundaries.
