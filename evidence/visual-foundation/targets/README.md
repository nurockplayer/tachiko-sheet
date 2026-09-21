# Target-state captures

- App source/build and regenerated-capture commit:
  `f96cc5161303545995bec0219cd5a4f25384f195`
- Build command: `pnpm build` (production `dist`, Vite 8.3.0)
- Captured: 2026-09-22 (Asia/Tokyo)
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
  UI interactions at the standard 1440×900 workspace. The S4D additions are
  `workbook-macbook-1512x982.png`, a 720px open grid-overflow capture, a 360px
  open Views-strip-overflow capture, and a 1024px long imported-title capture;
  each uses the normal product UI and is described in the matrix.
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
