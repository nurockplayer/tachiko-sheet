# Pinned core-kit qualification — Sheet #3

Status: **partially qualified; not Ready**. This record proves only the exact
artifact and public-entry behaviour listed below. It does not promote a runtime
or I/O contract, qualify an upstream replacement, or establish product
acceptance.

## Fixed inputs and producer

- Sheet acceptance seed: `0bb56541d3820b1197da79aa2ce36c1051093d85`
  (`codex/qualify-core-kit`), with `evidence/seed-provenance.json` unchanged.
- Original preparation source: `f264ead7a8286b0de337792b118055f13aa2c83d`,
  `planning/independent-work-client/`.
- Built upstream core pin: `8bba9b09cea3c011df383216ba3846ccd003dece` in
  `/Users/tachikoma/.codex/worktrees/sheet-core-8bba`, detached and isolated.
  The producer checkout was clean before materialization. Its only later
  untracked qualification artifact is `.qualification-kit/`.
- Read-only inspection of a newer upstream revision is deliberately excluded
  from this result. It is not an artifact upgrade or substitute for this pin.

The producer command was:

```sh
pnpm --dir apps/designer install --frozen-lockfile
bash scripts/export-experimental-designer-client.sh \
  /Users/tachikoma/.codex/worktrees/sheet-core-8bba/.qualification-kit
```

It completed successfully with Node `v24.15.0`, pnpm `11.25.0`, and stable
Rust `1.97.1`. The pinned compatibility build also passed with:

```sh
rustup run 1.85.0 cargo build \
  --manifest-path apps/designer/runtime/Cargo.toml \
  --target wasm32-unknown-unknown --release --locked
```

The producer's locked inputs had SHA-256 values `a0e05a531b2005e1d606bfe5b0c773942266d97285a38214a6023fae9a74efc6`
for `Cargo.lock` and `624d429faa350f3deeea58995a1250e9746f614934e5db88b0e35d01b6a23f19`
for `apps/designer/pnpm-lock.yaml`.

## Export inventory

The exported artifact contains 21 regular files. Its sorted path-and-digest
stream hashes to `a9408c031817b0a51f837f590ca47dd67005013093182f2865dd4fc7a23dfebc`.

| Asset | SHA-256 |
| --- | --- |
| `README.md` | `7206f1daf07e592e762c71336eb0338a20ec045d8749f1504c338bd18bf62eb2` |
| `designer_runtime.wasm` | `1fe501c3a44bafb7b18190d5c8472f06a8dff4db5652bee241a194532934adaa` |
| `experimental-client.d.ts` | `16d69e06f2910947e446c45e612d4d672fb960b50d269488e991992e89756e15` |
| `experimental-client.js` | `d635b4b5939c1efe845c480d4a9263e4f9119f79a72b97eada532644a62f819f` |
| `experimental-client.worker.d.ts` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `experimental-client.worker.js` | `669f02aece146ae108033ca04ed808a633012c6b576e20b6d6bdf59f10ca003e` |
| `host/project-transfer.d.ts` | `cfef1c51cf3f429a10ba435051d28b0126c9c9755c59ab34ff9a105ec2daf555` |
| `host/project-transfer.js` | `0849d82d43c9fdbe21200d463fe09f5c2051669d3503dd47ca7eb9ef4bba2035` |
| `package.json` | `6aed801a764caaa3cfd5d8b4bb8d5afa41616f1746d44762c63836ea63b61748` |
| `runtime/client.d.ts` | `e0c05458a635c969d35820dcd5d97ab599982357f82c7913547600f5dd26b3c1` |
| `runtime/client.js` | `9ccbdfa476c20c53d2cbbd681586f527b3afab59590867479469f34ebebc2632` |
| `runtime/interop-protocol.d.ts` | `27ee9b53a7cda8457ab2396514b849cba59dd2d75a2999fc3134bb513f9f3cc2` |
| `runtime/interop-protocol.js` | `8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881` |
| `runtime/protocol.d.ts` | `c6355bf45fa9b67b8c27dd48d74fdba8f89a1b3d9f32b1c566b0afa0ac833961` |
| `runtime/protocol.js` | `090a3f5d26d2765d53ad6a3a9a4533937d34adfb99700bc3869218cccf0a1bbc` |
| `runtime/wasm-bridge.d.ts` | `69976259dc7d5394573f388b4d391af911d8624f4d16781ddcd9506b4f1189d2` |
| `runtime/wasm-bridge.js` | `ac864bcaf65ae4b95a8b7d430587cbfcc01ce50d40009259dd07e0521d8b5cc9` |
| `runtime/worker-client.d.ts` | `7e88e21f494336761d68f344878bb07e40c8b5a1102a1f4932f72220f0f1ff63` |
| `runtime/worker-client.js` | `4bdb5fe2b66e3868dfdeb705925a0a3828531c938471011032d36069fc223f7d` |
| `runtime/worker-runtime.d.ts` | `657179a14c93df62c7a8d2e0718076082c3d53ed30b94f3f23b21cc8608587c3` |
| `runtime/worker-runtime.js` | `b63e661aea5da100495408ec8098a0cbbf5b9f10a15520a281096157e89fb4db` |

The output has no `artifact-manifest.json`, no producer-recorded source commit,
and no declared `licenseNotices` paths. `README.md` and `package.json` are the
only shipped descriptive files; neither supplies the manifest/notices contract
required by `tests/kit.mjs`. This is a producer-interface gap, not a failed
semantic scenario and not a behavioral RED.

## Actual admission and public-entry results

- `bash scripts/experimental-designer-client-smoke.sh` passed. It exported two
  deterministic kits, rejected private Designer-source imports, type-checked
  the external consumer, and passed its Chromium workflow.
- `WORK_CLIENT_URL=http://127.0.0.1:4186 pnpm exec node tests/browser.mjs --canary`
  passed against the exported kit with the seed's default `playwright-core`
  import (no `WORK_PLAYWRIGHT_MODULE` override). `pnpm exec` is required for
  reproducible package resolution; raw standalone `node` must not be claimed
  as an equivalent launcher. It admitted the 18-file supplied fixture,
  observed `5 + 5 = 10`, published `impact = 3` and observed `priority = 8`,
  rejected stale `editText` with `stale_revision` while keeping export bytes
  unchanged, and reopened the opaque export in a fresh client.
- `WORK_CLIENT_KIT=... pnpm qualification:real-kit-notes` passed. The added
  qualification-only probe used only `experimental-client.js` and the fixed
  fixture. It changed the CJK Text note to `先完成試玩回饋，再決定下一版範圍。`,
  exported 5,281 opaque bytes, created a new client, reopened a copied byte
  buffer, and observed the same changed note.
- The public observation contained no occurrence field in `OpenedProjection`,
  `BootstrapProjection`, `PublicationProjection`, `ProjectExport`, or the
  reopened projection. This probe therefore records occurrence identity as
  **unobservable through the public entry**, rather than inferring it from the
  changed values. The private protocol's `occurrence_id` is not consumer proof.
- The observed client has `exportProject`, but does not expose
  `exportCanonicalTree`, `exportRo`, or `verifyRoUsingCore`. The successful
  `exportProject` result is opaque transfer bytes; it does not prove a complete
  canonical `.roproj/v1` tree or genuine `.ro` codec output.

The browser dependencies are directly pinned as `playwright@1.62.1` for the
qualification probe and `playwright-core@1.62.1` for the imported seed's
default canary import. The real `pnpm-lock.yaml` records both packages. They
support the listed commands and do not alter the imported seed tests or their
recorded hashes. Its SHA-256 is
`cb46a39c3350f44be9ac52b705d6bb9d170356fe32237a0a84dc051d8cf89852`.
When Chromium is not already available, install the pinned browser with
`pnpm exec playwright install chromium` before the canary command. Start the
server with `WORK_CLIENT_KIT=/absolute/verified-kit pnpm exec node
scripts/serve-canary.mjs` (or the equivalent `pnpm serve:canary` script) in a
separate foreground session.

## Explicit unqualified boundaries

`tests/kit.mjs` currently fails before any assertion with `ENOENT` for the
missing `artifact-manifest.json`. `tests/storage.mjs` exits 78 because no real
storage driver was supplied, and `tests/agent.mjs` exits 78 because no trusted
agent/host driver was supplied. These are setup/interface blocks, never PASS
and never behavioral RED.

The smallest next action belongs to upstream `tachiko-work#359`: make the
producer ship an immutable-source manifest with source pin, all asset digests
and notice paths, and expose/review the required canonical-tree and genuine
`.ro` codec boundary. A Sheet-side parser, manifest fabrication, or relabeling
of opaque transfer bytes would violate the authority boundary.
