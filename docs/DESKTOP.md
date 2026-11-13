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
- The Rust dependency is pinned to an immutable Work revision: the same `2da87c09c7f7d4fca3ac89c7459ecceb86ad4c0d` source as the
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

## Third-party notices

Each installer carries `THIRD_PARTY_LICENSES.md`: the locked normal dependency
closure of the three desktop targets, plus the page's production JavaScript
packages. License and notice text comes byte-for-byte from `cargo vendor` and
each package's LICENSE file. The footer links the app's notices beside Work's
kit notices. Regenerate after changing `src-tauri/Cargo.lock`,
`src-tauri/Cargo.toml`, `package.json` or `pnpm-lock.yaml`, with Rust installed:

```bash
node scripts/generate-third-party-licenses.mjs
```

The generator fails rather than omit a package or ship a license outside its
allow-list; `--check` fails on any difference from the checked-in file, and CI
runs it.

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

## Install with Homebrew

```sh
brew install --cask nurockplayer/tap/tachiko-sheet
```

The cask lives in [nurockplayer/homebrew-tap](https://github.com/nurockplayer/homebrew-tap).
Publishing a `v*` release runs `.github/workflows/update-cask.yml`, which checks the
DMG against `SHA256SUMS.txt` and points the cask at it. The run needs the
`TAP_DEPLOY_KEY` secret (a write deploy key on the tap only) and fails visibly
without it. The DMG must be named `Tachiko-Sheet-<tag>-macos-universal.dmg`. To
re-run it for an existing release with a universal DMG, start the workflow by hand
with the tag.

Homebrew does not change the Gatekeeper limit below.

## Release

A `v*` tag whose version matches `src-tauri/tauri.conf.json` runs
`.github/workflows/release.yml`, which builds all three platforms and creates a
**draft** GitHub Release with the installers and `SHA256SUMS.txt`. Publishing
that draft by hand is what runs the cask update above; nothing is published
automatically. The release body comes from `docs/release-notes.md`.

## Build on Windows and Linux

The desktop host builds on Windows and Linux as well. CI
(`.github/workflows/desktop-platforms.yml`) runs the host unit tests and builds
the bundles on every pull request and push to `main` that touches the host or
`tests/desktop/`, and retains them as a 7-day artifact. It then builds the same
app as the packaged e2e variant (`--no-bundle --features e2e`) and starts that
executable on each OS with `tests/desktop/packaged-smoke.mjs`, under `xvfb-run`
on Linux. That run proves the packaged app starts and serves the page from its
own origin (`http://tauri.localhost` on Windows, `tauri://localhost` on Linux),
imports a CSV through the native runtime and shows it, publishes a cell edit,
asks about unsaved work on both Close and Quit and keeps the app, window and
edit when the answer is Cancel, writes a CSV export through the host's
create-new-file save, refuses an existing export name without touching the
file, and exits with code 0 when the answer is Discard.

What CI still does not prove on Windows and Linux: a real install from the NSIS
installer or AppImage, a real close/quit dialog a person operates (the answer is
scripted), and real menus (the test reaches the same host paths through the e2e
channel). On the matching OS, build locally with:

```bash
pnpm desktop:build:windows   # NSIS installer under src-tauri/target/x86_64-pc-windows-msvc/release/bundle
pnpm desktop:build:linux     # AppImage + .deb under src-tauri/target/x86_64-unknown-linux-gnu/release/bundle
```

These bundles are **unsigned**: Windows SmartScreen and the Linux package
tools show an unknown-publisher warning, and there is no code signing.

## Current limits

- **Unsigned preview.** The app is ad-hoc signed and not notarized, so
  Gatekeeper blocks a downloaded copy until it is allowed in System Settings →
  Privacy & Security. Developer ID signing and notarization need the owner's
  Apple Developer credentials. The Windows installer and the Linux packages are
  unsigned too, so SmartScreen and the Linux package tools warn about an
  unknown publisher.
- Logging out or shutting down while Tachiko Sheet is open is cancelled once
  so the app can ask about unsaved work; afterwards, log out or shut down again.
- File > Open, double-click and Open With take .ro, .xlsx and .csv files (File > Open
  also .tsv and .txt). The host reads the file; the page never names a path. While
  work is open, the page asks to close it first and drops the file. Installers
  register .xlsx and .csv as well as .ro; on Windows that may make the app their
  default unless the person has already chosen one. Windows and Linux start a new
  process per double-click, each with its own window.
- Opening a project folder uses the system Open panel via the existing file input.
- File has New Table, Open, Save, Save a Copy and Print; Edit's Undo and Redo reach the
  table's history, and a text field's own Undo while one has focus. They are always
  enabled: a command that can't run does nothing or says why on the page.

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
