# Draft receipt for Sheet #246 (do not post)

Work range: `5f2b0718f5e62eb29ddd0aa1db9634a74df14404..4fcb06c359d8267f2b611884991da92d7146c630` (18 commits):

```text
4fcb06c3 Working-size XLSX and CSV export at 10,000 rows (#678) (#803)
aee33df5 An exact LOOKUP node in the engine and v3 (#668) (#798)
b3e1e128 A column's alignment, wrap and width are set through the kit (#668) (#796)
42d0624b Preserve blank Date cell formats in working-size exports (#789) (#794)
c375e3b8 YEAR, MONTH, DAY, WEEKDAY and DAYS over Date fields (#668) (#797)
c4cbdd7c IFERROR in formulas, A1 entry and XLSX (#668) (#795)
4d8051d3 Tracker and Budget open in working size too (#668) (#792)
7f06cf9b ABS, ROUNDUP and ROUNDDOWN in formulas, A1 entry and XLSX (#668) (#793)
2a58cb7e A style-only change advances the revision and keeps the caches (#668) (#791)
e8b9c763 Working-size imports carry metadata version 2 without rows, styles or widths (#668) (#788)
8154ea4b XLSX import puts bold, fill, border and per-cell number formats in the store (#668) (#786)
78d029a7 XLSX import puts date format, alignment, wrap and width in the store (#668) (#783)
c72cd6a1 XLSX export takes date format, alignment, wrap and width from the store (#668) (#781)
75d76fbd A column's date format is set through the kit and shown (#668) (#780)
ba1a6929 Date fields carry an optional date format (#668) (#773)
0f369d8f A table can be deleted or added through the kit (#668) (#775)
dd74cbbc A table can be renamed through the kit (#668) (#772)
1d645afa Column widths are stored in the table presentation record (#668) (#771)
```

Two clean detached source-derived exports matched byte for byte in the isolated
orb-test container (2026-11-12 17:45 JST). Manifest SHA256:
`c96674f9889814cf45196f8f0e78f23c5cb519d5b2587f3f6c4fc11b6aa329c3`.

Kit inventory (24 payload files plus the manifest):

| File | SHA256 |
| --- | --- |
| `README.md` | `eee673dc96b26e0b0df04882157d912b59413000660e363523d5c1b979f28190` |
| `designer_runtime.wasm` | `f4c7e2c735d76772201254fc93f728929bab421af8b084fc9f3fa2ed46a4e961` |
| `experimental-client.d.ts` | `bcba17a981147ed5b832199213510248845c87056c238e967157a972177d6fa1` |
| `experimental-client.js` | `01fe7bd705a1294ebe50c7a903ae856df68dc68dfe75e86dbcd9d3ca6b6d8dcf` |
| `experimental-client.worker.d.ts` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `experimental-client.worker.js` | `669f02aece146ae108033ca04ed808a633012c6b576e20b6d6bdf59f10ca003e` |
| `host/project-transfer.d.ts` | `5604bc40651eae3a0987f8e03fb2c66b8d2cea91fc2212890e2a390c3f0edea5` |
| `host/project-transfer.js` | `c2bfec1f4c3ded1fab5f413be504198670dc614adfa2e6c1dec1821d7e77e97c` |
| `notices/LICENSE-APACHE` | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `notices/LICENSE-MIT` | `8fbbe1bd4ec8eed2985f3e9d225124af632ea6a911b95b9700d3ac44c87c062d` |
| `notices/THIRD_PARTY_LICENSES.md` | `b36a66d6709929fe638ce6b472918d2fc64107d58e8ffe95b86cfb7d293536e5` |
| `package.json` | `6aed801a764caaa3cfd5d8b4bb8d5afa41616f1746d44762c63836ea63b61748` |
| `runtime/client.d.ts` | `25eaa574fe0a024d86f887fd9a800e5f0c2fa1a578dbe1facc4afaf43ae48c61` |
| `runtime/client.js` | `9ccbdfa476c20c53d2cbbd681586f527b3afab59590867479469f34ebebc2632` |
| `runtime/interop-protocol.d.ts` | `c2b6d20d313c2bd538f689a5b9cedf767516c3de02f5c0df2a173de4bc03a265` |
| `runtime/interop-protocol.js` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `runtime/protocol.d.ts` | `98737dca07b2acada6f6986b8c3cfea18e6af95ce79330e830b3f09aaa14efe3` |
| `runtime/protocol.js` | `96806eb07b9a8880e6f2958de0dd051c12321727f1f0268af8551bd04a0196d0` |
| `runtime/wasm-bridge.d.ts` | `478e4bc48fe01866c4a94345e77c70a947d42243c44feb8b8bb14901ab3cfd59` |
| `runtime/wasm-bridge.js` | `e975adeef89e87ffbaad59f7cd37cabdc6853e566fb7b40e62b9272458ca0d34` |
| `runtime/worker-client.d.ts` | `e72d7b7313cab94c75e232a3cf2157a2c780eade188e2aa9c7afc243d7740813` |
| `runtime/worker-client.js` | `bae5b34ec9b04763f87d8fdb0b35bd7e89ff40083a8ef8c46362f86e168315dc` |
| `runtime/worker-runtime.d.ts` | `657179a14c93df62c7a8d2e0718076082c3d53ed30b94f3f23b21cc8608587c3` |
| `runtime/worker-runtime.js` | `38c7a386425897ad5ae3b01d0cb3cef19ba2d034ad7510b94a0a1aa4be38123f` |

Sheet adaptations and their producer causes:

- `core-kit.lock.json`, `public/core-kit/**`, `scripts/verify-core-kit.mjs`,
  `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `docs/DESKTOP.md`,
  `tests/qualification/j4-public-composition.mjs`,
  `acceptance/j3-interop/corpus.json`, `THIRD_PARTY_LICENSES.md` and
  `public/THIRD_PARTY_LICENSES.md`: coordinated producer re-pin for the full
  range above (Work #771–#803). The notice files change only the Work hash.
- `src/ui/capacity-message.ts` and its test: cover the new typed file-size,
  unpacked-size, XML, serialized-source and output bounds (Work #788/#803).
- `src/ui/interop-copy.ts` and its test: plain copy for stored column
  presentation exported by Work #781, unsupported date formatting from #783,
  and bounded cell presentation from #786.

Cargo.lock package additions/removals: none. Work's only Cargo.toml change in
this range adds a development-only dependency already in Sheet's graph.
Host-generated third-party notices were not regenerated.

New kit capabilities not adopted by Sheet: renameTable, deleteTable, addTable
(including last_table/table_referenced refusals); setColumnDateFormat,
setColumnAlignment, setColumnWrap, setColumnWidth and per-column style reply;
working-size inspect/import/open of spreadsheets (10,000 rows/100,000 cells),
working-size Tracker/Budget creation and working-size CSV/XLSX export at
10,000 rows. No new methods or profiles are requested by Sheet. Existing
import/export calls receive the producer's updated presentation handling.
Formula additions (ABS/ROUNDUP/ROUNDDOWN, IFERROR, Date functions and LOOKUP)
are available in the producer; this re-pin adds no Sheet UI for them.

Validation: pending prescribed container test. Product acceptance and native
platform checks remain CI gates on PR #374; no merge or acceptance PASS claimed.
