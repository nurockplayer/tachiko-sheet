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
- The Rust dependency is pinned to an immutable Work revision: the Web kit's
  producer source `40d01a45` plus only the additive native bridge, whose release
  WASM build is byte-identical to its baseline. Re-pin only together with a
  qualified kit.
- Downloads (CSV/XLSX/PNG/profile) open the native Save panel, are written to a
  hidden temporary file and moved into place only on success.
- Closing the window or quitting (⌘Q) with unsaved work asks first, using the
  Sheet's own unsaved-work guard.
- Saved copies live in the app's own WebKit storage (`dev.tachiko.sheet`), not
  shared with a browser or with the e2e build (`dev.tachiko.sheet.e2e`).

## Build and test (Apple Silicon)

```bash
pnpm install --frozen-lockfile
pnpm desktop:build          # .app + .dmg under src-tauri/target/aarch64-apple-darwin/release/bundle
pnpm test:desktop-host      # host channel unit tests
pnpm test:desktop-parity    # same operations on WASM and native: identical results
pnpm desktop:build:e2e      # packaged e2e variant (adds a script channel; never shipped)
node tests/desktop/packaged-lifecycle.mjs "<path>/Tachiko Sheet E2E.app"
```

The lifecycle test launches the packaged app through LaunchServices, runs the
Sales example (price edit → summary/chart) and the 8,406 × 3 CSV/XLSX journey
(import, first/middle/last edits, Undo/Redo, Save a copy, full quit and
relaunch, reopen, CSV/XLSX export checked cell-by-cell by an independent oracle,
replace of an existing export, malformed-file refusal).

## Current limits

- **Unsigned preview.** The app is ad-hoc signed and not notarized, so
  Gatekeeper blocks a downloaded copy until it is allowed in System Settings →
  Privacy & Security. Developer ID signing and notarization need the owner's
  Apple Developer credentials.
- Apple Silicon only. No file associations or Finder "Open With".
- Opening a project folder and importing files use the system Open panel via the
  existing file inputs; there is no native menu "Open…" yet.
