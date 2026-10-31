# Tachiko Sheet for macOS (Desktop Preview)

The macOS app is the same Sheet UI bound to the **native** Tachiko Work Rust
runtime. Tauri 2 is the host only: window, OS lifecycle, the native Save
panel and the close/quit guard. It never runs the Web kit's WASM.

## Architecture

```text
Sheet UI / application (unchanged)
  → kit WorkerDesignerClient (the intact vendored kit client)
  → NativeRuntimeChannel        src/host/native-runtime.ts   (Worker-shaped)
  → Tauri binary IPC            runtime_attach / runtime_dispatch
  → RuntimeChannel              src-tauri/src/runtime_channel.rs
  → Work host_bridge::DesignerHost (tachiko-work#511, exact rev)
  → the same Rust runtime the Web kit compiles to WASM
```

- `native-runtime.ts` is a transport port of the kit's `worker-runtime.js` +
  `wasm-bridge.js`: same request bytes, same local size refusals, same receipt
  checks and reply shapes. Operations run strictly FIFO, one at a time.
- Each channel attaches a fresh host **generation**; older frames are refused.
  A transport failure or runtime panic is terminal: the resident work is
  discarded and the in-flight operation is an unknown outcome, never replayed.
- The Rust dependency is pinned to an immutable Work revision: the same `fac94ef3942c10b287b7f9df9463c1a694ee1fad` source as the
  Web kit. Each re-pin's reproducible exports and hashes are recorded on
  [#246](https://github.com/nurockplayer/tachiko-sheet/issues/246) (the first
  in [the #160 handback](160-kit-handback.md)). Re-pin only together with a
  qualified kit.
- Exports (CSV/XLSX/PNG/profile) do not use WebKit downloads. The page hands
  the bytes to the host through the `HostFiles` port (`src/host/host-files.ts`;
  the Web keeps an ordinary download), in request order; the host asks with a
  Save sheet and **creates a new file** — "Save a copy", never replacing
  anything (`src-tauri/src/saves.rs`). An existing name (file, folder, symlink,
  pipe) is refused with a clear message and left untouched; the bytes go to an
  exclusive temporary file moved into place with `RENAME_EXCL`, the name is
  checked to be that file, and the folder is flushed. The page learns whether
  the file was saved or cancelled; failures say so in the page. Saves from an
  earlier page are refused, and a transport retry of a save returns its
  original receipt. All host dialogs are sheets on the Sheet window.
- Closing the window, ⌘W, Quit (menu ⌘Q, Dock, logout) and reloading all ask
  first when work is unsaved, a change is still in progress, or an export is
  still being saved (the Sheet's own unsaved-work guard). While that is decided,
  new runtime operations and saves are held, so nothing can change the work
  after the check, and the page is frozen (`inert`) so no typing can slip in
  either. Once leaving is decided, a save still being written finishes first
  and any other save is not written.
  Termination is routed through `applicationShouldTerminate:`.
- The Sheet document is never replaced by a link: bundled license notices open
  in their own window, web links open in the default browser.
- Saved copies live in the app's own WebKit storage (`dev.tachiko.sheet`), not
  shared with a browser or with the e2e build (`dev.tachiko.sheet.e2e`).

## Build and test (Apple Silicon)

```bash
pnpm install --frozen-lockfile
pnpm desktop:build          # .app + .dmg under src-tauri/target/aarch64-apple-darwin/release/bundle
pnpm test:desktop-host      # host channel unit tests
pnpm test:desktop-parity    # same operations on WASM and native: identical results
pnpm desktop:build:e2e      # packaged e2e variant (adds a script channel; never shipped)
caffeinate -dimu node tests/desktop/packaged-lifecycle.mjs "<path>/Tachiko Sheet E2E.app"
```

The lifecycle test launches the packaged app through LaunchServices, runs the
Sales example (price edit → summary/chart), the 8,406 × 3 Text regression,
and the 320 × 2 / 1,000 × 16 mixed Text/Number CSV/XLSX journeys
(import, first/middle/last edits, Undo/Redo, Save a copy, full quit and
relaunch, reopen, CSV/XLSX export checked cell-by-cell by an independent oracle,
existing-export refusal, malformed and dimension-limit refusals), plus the close, ⌘Q,
Dock-quit (`terminate:`), reload and link guards with a scripted dialog answer.

## Current limits

- **Unsigned preview.** The app is ad-hoc signed and not notarized, so
  Gatekeeper blocks a downloaded copy until it is allowed in System Settings →
  Privacy & Security. Developer ID signing and notarization need the owner's
  Apple Developer credentials.
- Logging out or shutting down while Tachiko Sheet is open is cancelled once
  so the app can ask about unsaved work; afterwards, log out or shut down again.
- Apple Silicon only. No file associations or Finder "Open With".
- Opening a project folder and importing files use the system Open panel via the
  existing file inputs; there is no native menu "Open…" yet.

Large imports support one headered, default-style table with 1–16 Text,
finite Number, Date (1900-01-01 through 9999-12-31) or Yes/No columns, at most
8,406 data rows and 25,218 logical cells (including missing cells). Byte/XML/ZIP
limits and unsupported-feature checks also apply. Capacity formulas,
constraints, saved definitions and Dedup are excluded from the enlarged profile. Work still owns admission.

## Retained CI engineering evidence

The macOS workflow retains two repository-visible Actions artifacts for **14 days**,
with run ID and attempt in their names. `sheet-macos-production-<run>-<attempt>`
contains the production DMG, `identity.json` and an engineering notice. Production
bytes and bundled identity are staged before the separate E2E build shares Cargo
outputs; the staged DMG hash is checked again and the production artifact is
uploaded before the E2E build. A retained production artifact does not imply that
the whole CI run or lifecycle passed. The manifest binds
actual checkout commit/tree, available PR head/base, run/event, resolved native
Work/kit identity, bundled version/executable hash, Mach-O architecture and
signature verification. A pull-request merge checkout is distinct from its head.

`sheet-macos-e2e-evidence-<run>-<attempt>` contains the separate test-app identity,
run identity, direct lifecycle result, actual process exit/signal and cleanup
result, bounded combined stdout/stderr and host-log tails, and selected error
messages. Build-blocked execution says `BLOCKED` / `NOT RUN`; printed PASS alone
cannot establish success. An external hard kill can prevent final E2E evidence
from being written or uploaded. No E2E executable, profiles, downloads or temporary
workspace is retained. These artifacts are engineering evidence, not permanent
distribution, signing/notarization, or #50's physical/human qualification.

For an exact-candidate readback, download both artifacts from the intended Actions
run/attempt before expiry. Compare manifest checkout/tree and PR/run identities
with GitHub, recompute the DMG SHA-256 and size, then mount the downloaded DMG
read-only and inspect its contained app's Info.plist, executable SHA-256,
`lipo -archs`, and `codesign --verify --deep --strict` / `codesign -dv --verbose=4`
against the production manifest. Independently verify the E2E identity and final
process/direct-result/cleanup agreement. Archive digests or manifests alone do
not qualify the contained app; the separate Finder, native-panel, IME/AT and
human walkthrough obligations remain.
