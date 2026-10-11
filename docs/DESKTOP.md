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
- Exports (CSV/XLSX/PNG/profile) do not use WebKit downloads. The page hands
  the bytes to the host through the `HostFiles` port (`src/host/host-files.ts`;
  the Web keeps an ordinary download), in request order; the host asks with a
  Save sheet and writes a new, exclusively created file beside the chosen one,
  then renames it into place (`src-tauri/src/saves.rs`). The page learns
  whether the file was saved or cancelled, and a failure says so in the page;
  it never leaves a partial file or replaces an existing one. A save from an
  earlier page (before a reload) is refused. All host dialogs are sheets on
  the Sheet window, and none opens inside a WebKit callback.
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
Sales example (price edit → summary/chart) and the 8,406 × 3 CSV/XLSX journey
(import, first/middle/last edits, Undo/Redo, Save a copy, full quit and
relaunch, reopen, CSV/XLSX export checked cell-by-cell by an independent oracle,
replace of an existing export, malformed-file refusal), plus the close, ⌘Q,
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
