# Exact-final-head production visual matrix

Source/build commit: `84c9c08a904568450510001aa557bade8f36b8b1`.
Capture/evidence commit: `1b1b4173aead3fb31aeb6497723fc93c57b3b9e4`.

This matrix was regenerated from that exact production head with:

```text
pnpm build
pnpm exec vite preview --host 127.0.0.1
WORK_CLIENT_URL=http://127.0.0.1:4174 pnpm evidence:visual-foundation-final
```

The capture runtime is Playwright Chromium 1.62.1 in headless mode on macOS
Darwin 24.6.0 arm64. Every entry passes an explicit CSS viewport and
`deviceScaleFactor: 1` (DPR 1); no OS display scale or browser-UI zoom is
assumed. FHD/QHD/4K are representative effective CSS workspaces, not physical
monitor certification. The 200% case uses a 720×450 CSS viewport with
`document.documentElement.style.zoom = "2"`, so its effective layout scale is
200% while DPR remains 1. This is deterministic headless/emulated browser
evidence, not native macOS, iPad, physical-device, or #16 evidence.

| State | Workspace | CSS viewport | DPR / document zoom | Versioned capture |
|---|---|---:|---:|---|
| Home | Standard | 1440×900 | 1 / 100% | `targets/home.png` |
| Home | Standard | 1280×800 | 1 / 100% | `targets/home-1280x800.png` |
| Home | Standard | 1024×768 | 1 / 100% | `targets/home-1024x768.png` |
| Home | FHD | 1920×1080 | 1 / 100% | `targets/home-fhd-1920x1080.png` |
| Home | QHD | 2560×1440 | 1 / 100% | `targets/home-qhd-2560x1440.png` |
| Home | 4K | 3840×2160 | 1 / 100% | `targets/home-4k-3840x2160.png` |
| Home | 200% zoom | 720×450 | 1 / 200% | `targets/home-200-percent.png` |
| Populated actual-core Tracker | Standard | 1440×900 | 1 / 100% | `targets/workbook-50rows-1440x900.png` |
| Populated actual-core Tracker | Standard | 1280×800 | 1 / 100% | `targets/workbook-50rows-1280x800.png` |
| Populated actual-core Tracker | Standard | 1024×768 | 1 / 100% | `targets/workbook-50rows-1024x768.png` |
| Populated actual-core Tracker | FHD | 1920×1080 | 1 / 100% | `targets/workbook-50rows-fhd-1920x1080.png` |
| Populated actual-core Tracker | QHD | 2560×1440 | 1 / 100% | `targets/workbook-50rows-qhd-2560x1440.png` |
| Populated actual-core Tracker | 4K | 3840×2160 | 1 / 100% | `targets/workbook-50rows-4k-3840x2160.png` |
| Populated actual-core Tracker | 200% zoom | 720×450 | 1 / 200% | `targets/workbook-50rows-200-percent.png` |
| Focused selection / edit / save dialog | Standard | 1440×900 | 1 / 100% | `targets/workbook-50rows-selection.png`, `targets/workbook-50rows-japanese-edit.png`, `targets/save-dialog-final.png` |

The final capture command reported seven rendered CJK cells and zero mojibake
cells at each populated workbook workspace. It also checked complete title
access for a long cell value; the 1024px case checked deliberate horizontal
grid overflow. The executable visual regression separately confirms exact
full-value title access for Latin and CJK cells, actual clipping, and the
forced-colors focus style change. The exact-build comparison
`git diff --stat 84c9c08a904568450510001aa557bade8f36b8b1 1b1b4173aead3fb31aeb6497723fc93c57b3b9e4 -- src/ui src/App.tsx src/ui/sheet-shell.css`
returned no output. These observations remain headless/emulated and do not
substitute for the pending physical Mac walkthrough.
