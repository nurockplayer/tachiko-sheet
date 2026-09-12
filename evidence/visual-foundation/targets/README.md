# Target-state captures

- App source/build commit: `6d3b30af57e54c519be89f599daa2edf8986a807`
- Capture harness/evidence commit: `73b186e89582bc2e1ad6883d9633346739104035`;
  screenshots were regenerated against the app build above.
- Build command: `pnpm build` (production `dist`, Vite 8.3.0)
- Captured: 2026-09-13 (Asia/Tokyo)
- Browser: Playwright Chromium 1.62.1, headless; host macOS Darwin 24.6.0 arm64
- Font: platform system stack (`system-ui`, `-apple-system`, Hiragino Sans,
  Noto Sans TC, Microsoft JhengHei); no remote font
- Viewports: 1440×900, 1280×800, 1024×768 CSS px at device scale factor 1,
  plus a 720×450 CSS viewport with document zoom 200% (`home-200-percent.png`).
  The 200% case uses document zoom emulation in headless Chromium, not a
  browser-UI zoom preference; native browser zoom remains a separate gate.
- Runtime: production preview (`pnpm exec vite preview --host 127.0.0.1`)
- Captures: `home.png`, `home-1280x800.png`, `home-1024x768.png`,
  `home-200-percent.png`, `workbook.png`, `selection.png`, `save-dialog.png`,
  plus actual-core populated captures `workbook-50rows-1440x900.png`,
  `workbook-50rows-1280x800.png`, `workbook-50rows-1024x768.png`, and
  `workbook-50rows-selection.png`, plus `workbook-50rows-japanese-edit.png`
  and `save-dialog-final.png` from normal UI interactions.
- `recovery-acceptance-fault.png` is a genuine acceptance-build-only capture:
  the existing bounded `failNextOpenProjection()` fault was armed after real
  edits and the UI reached `Refresh required` / `Needs refresh`. Acceptance
  hooks are not shipped in production `dist`.

## Evidence boundaries

The wireframes in `../targets.md` are design targets; the PNGs in this folder
are actual builds. The Japanese capture proves glyph rendering through the
normal editor and does not claim native IME composition. These captures do not
claim full CJK/IME coverage, macOS native-host acceptance, or #7 completion.
