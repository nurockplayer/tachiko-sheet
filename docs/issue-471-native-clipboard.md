# #471 native clipboard implementation checkpoint

Acceptance row: none. Linux real clipboard Paste is explicitly BLOCKED by [#541](https://github.com/nurockplayer/tachiko-sheet/issues/541).
macOS and Windows run the real clipboard checks; CI results belong on PR #540.

The lead approved option 1 on #471: the app's own native-menu internal
Windows/Linux input injection is allowed. Test-authored input injection,
constructed ClipboardEvent and navigator.clipboard stubs remain forbidden.

## Implementation

The shared packaged check seeds a 2×2 TSV through pbcopy or PowerShell
Set-Clipboard, invokes the e2e menu channel and compares all 25,218
cell values and stable targets, allowing exactly four changed values.
It replaces the two synthetic paste checks. The full macOS lifecycle also
compares its entire small fixture after a real clipboard Paste and emits PASS
only after those assertions; its previous NOT RUN report is removed.

The e2e-only native hook activates the actual installed item:

- macOS: finds the menu item's `paste:` action and calls
  `NSMenu.performActionForItemAtIndex:`. AppKit dispatches through the normal
  responder chain. No Accessibility or CGEvent automation is used.
- Windows: finds the native menu item's command ID and sends WM_COMMAND to
  the app window. Muda's installed handler owns the internal SendInput.
- Linux: emits BLOCKED with the #541 URL in stdout, its receipt and the
  smoke result JSON. It never claims clipboard PASS or attempts a replacement
  paste path. The unused GTK activation adapter was removed.

No dependency, libxdo feature enablement, package installation or install
lifecycle script was added.

## Newly established Linux blocker

The earlier checkpoint correctly described muda's conditional libxdo code,
but did not establish whether that feature was enabled. It is not enabled
in this app's locked graph:

- Tauri 2.12.0 Cargo.toml disables muda default features and selects only
  serde and gtk3. Its linux-libxdo feature separately enables muda/libxdo.
- Sheet's src-tauri/Cargo.toml does not select linux-libxdo.
- src-tauri/Cargo.lock has no libxdo package or muda dependency on libxdo.
- muda 0.20.0 src/platform_impl/gtk/mod.rs:1204–1213 gates the Paste
  delivery callback behind that feature. Activating the current installed
  Linux menu item therefore cannot deliver Paste.

Enabling the feature only for e2e would test different Paste behavior from
release builds. Substituting a WebView paste API or test key injection would
also bypass the shipping menu. Neither was done.

## Lead disposition

The lead declined enabling tauri/linux-libxdo. Shipping Linux Paste is owned
by #541 and is out of scope for PR #540. macOS/Windows clipboard coverage
continues; Linux reports BLOCKED explicitly. No e2e-only libxdo enablement
exists. Attach actual passing macOS and Windows packaged CI run IDs to
PR #540 after the runs finish.
