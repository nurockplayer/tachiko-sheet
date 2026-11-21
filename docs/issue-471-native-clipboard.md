# #471 native clipboard test blocker

Recorded 2026-11-21 18:02 JST against
`743cb0edf073dce17c9034ee6497fbdca5c99b56`.
Acceptance row: none. This records a blocked implementation, not clipboard PASS.

The existing checks in `tests/desktop/paste-races.mjs` construct a
`ClipboardEvent` and replace `navigator.clipboard`. They do not prove OS
clipboard delivery. The real-clipboard NOT RUN report in
`tests/desktop/packaged-lifecycle.mjs` remains accurate.

## Why the existing menu channel cannot meet the constraint

- `src-tauri/src/lib.rs:780` preserves the predefined native Paste item;
  only Undo and Redo are replaced with page commands.
- `menu_command_hook` checks that an item exists, then calls
  `run_menu_command`. Its page-command route only forwards `PAGE_COMMANDS`,
  which excludes Paste. Invoking the predefined Paste ID through the
  current hook would therefore do nothing.
- `src-tauri/Cargo.lock` pins `muda` to `0.20.0`. In that version's
  `src/platform_impl/windows/mod.rs:1151`, predefined Paste calls
  `EditCommand::Paste.run()`. Lines 1202–1229 construct Ctrl+V keyboard
  inputs and call `SendInput`.
- In the same version's `src/platform_impl/gtk/mod.rs:1193`, Paste maps to
  `ctrl+v`; lines 1204–1213 deliver it with
  `libxdo::XDo::send_keysequence`. This also uses synthetic OS input.

These dependency source paths are relative to the locked `muda` crate,
inspected in the local Cargo registry. Thus activating the actual native
Edit > Paste item on Windows/Linux would itself use synthetic input,
even if the test added no external keyboard automation. No input injection
or OS clipboard mutation was attempted on this Mac.

## Lead decision needed

1. Permit the existing native menu implementation's internal input injection
   on Windows/Linux, while keeping macOS free of Accessibility/CGEvent
   automation. Add OS clipboard setup and a native menu activation hook;
   retain full target/untouched-cell comparisons in the packaged checks.
2. Authorize changing the product's native Paste implementation to an
   input-free path, then test that new shared user/test entry. This expands
   the task beyond the current test gap.
3. Keep the strict constraint and retain the explicit blocked native coverage.

Recommendation: option 1, since it exercises the shipping native Paste
implementation with the smallest product impact. It requires explicit
approval under this brief's synthetic-input stop condition. No dependency,
workflow, product, or test behavior was changed while awaiting that decision.

## Validation and continuation

No executable code changed and no tests were run for this documentation-only
checkpoint. No CI run ID proves OS clipboard paste on any platform yet.
After the lead chooses an option, implement the selected path and obtain
packaged macOS, Windows and Linux results; attach those actual run IDs to
the implementation PR. Until then #471 remains unresolved.
