# Target-state captures

- App source/build commit: `84c9c08a904568450510001aa557bade8f36b8b1`
- Capture harness/evidence commit: `1b1b4173aead3fb31aeb6497723fc93c57b3b9e4`;
  screenshots were generated from the production tree at the source/build
  commit above.
- The production UI tree (`src/ui`, `src/App.tsx`, `src/ui/sheet-shell.css`)
  has no diff between the source/build and capture commits. Later
  metadata-only corrections after the capture commit do not claim that
  screenshots were regenerated.
- Build command: `pnpm build` (production `dist`, Vite 8.3.0)
- Captured: 2026-09-13 (Asia/Tokyo)
- Browser: Playwright Chromium 1.62.1, headless; host macOS Darwin 24.6.0 arm64
- Font: platform system stack (`system-ui`, `-apple-system`, Hiragino Sans,
  Noto Sans TC, Microsoft JhengHei); no remote font
- CSS workspace matrix: 1440×900, 1280×800, 1024×768, FHD 1920×1080,
  QHD 2560×1440, 4K 3840×2160, all at `deviceScaleFactor: 1` (DPR 1) and
  document zoom 100%, plus a 720×450 CSS viewport with document zoom 200%.
  The 200% case is `document.documentElement.style.zoom = "2"` in headless
  Chromium, not a browser-UI zoom preference; native browser zoom remains a
  separate gate. See [`../production-matrix.md`](../production-matrix.md) for
  the complete state/artifact table and assumptions.
- Runtime: production preview (`pnpm exec vite preview --host 127.0.0.1`)
- Captures: Home and actual-core populated workbook states at every matrix
  workspace, plus `workbook-50rows-selection.png`,
  `workbook-50rows-japanese-edit.png`, and `save-dialog-final.png` from normal
  UI interactions at the standard 1440×900 workspace.
- `recovery-acceptance-fault.png` is a genuine acceptance-build-only capture:
  the existing bounded `failNextOpenProjection()` fault was armed after real
  edits and the UI reached `Refresh required` / `Needs refresh`. Acceptance
  hooks are not shipped in production `dist`.

## Evidence boundaries

The wireframes in `../targets.md` are design targets; the PNGs in this folder
are actual builds. The Japanese capture proves glyph rendering through the
normal editor and does not claim native IME composition. These captures are
deterministic headless/emulated browser evidence, not native macOS/iPad/#16
evidence, and do not claim full CJK/IME coverage or #7 completion.
