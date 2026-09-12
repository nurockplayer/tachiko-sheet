# Target-state captures

- App source/build commit: `7bf79a72066fffd7bdfbb97bf752212862e7ef70`
- Capture harness is committed with this evidence update; screenshots were
  regenerated against the app build above.
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
  `workbook-50rows-selection.png`.
- The error/recovery target is documented in `../targets.md`; it requires an
  authoritative runtime fault/reobserve and is not fabricated by the visual
  harness. No recovery screenshot is claimed in this revision because the
  acceptance build's bounded fault call did not settle in the capture runner.
