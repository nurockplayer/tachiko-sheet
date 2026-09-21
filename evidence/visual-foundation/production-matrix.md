# Exact-final-head production visual matrix

Source/build and regenerated-capture commit: `f96cc5161303545995bec0219cd5a4f25384f195`.

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
| Populated actual-core Tracker | MacBook workspace | 1512×982 | 1 / 100% | `targets/workbook-macbook-1512x982.png` |
| Populated actual-core Tracker | FHD | 1920×1080 | 1 / 100% | `targets/workbook-50rows-fhd-1920x1080.png` |
| Populated actual-core Tracker | QHD | 2560×1440 | 1 / 100% | `targets/workbook-50rows-qhd-2560x1440.png` |
| Populated actual-core Tracker | 4K | 3840×2160 | 1 / 100% | `targets/workbook-50rows-4k-3840x2160.png` |
| Populated actual-core Tracker | 200% zoom | 720×450 | 1 / 200% | `targets/workbook-50rows-200-percent.png` |
| Focused selection / edit / save dialog | Standard | 1440×900 | 1 / 100% | `targets/workbook-50rows-selection.png`, `targets/workbook-50rows-japanese-edit.png`, `targets/save-dialog-final.png` |
| Grid horizontal overflow opened | 200% zoom | 720×450 | 1 / 200% | `targets/workbook-grid-overflow-open-720x450.png` |
| Views-strip horizontal overflow opened | Narrow workspace | 360×800 | 1 / 100% | `targets/workbook-views-overflow-open-360x800.png` |
| Long imported document title | Standard | 1024×768 | 1 / 100% | `targets/workbook-long-title-1024x768.png` |
| Retained unknown draft / recovery | Standard | 1440×900 | 1 / 100% | `targets/recovery-acceptance-fault.png` |

The final capture command reported seven rendered CJK cells and zero mojibake
cells at each populated workbook workspace. It also checked complete title
access for a long cell value. The explicit 720px grid check measured 704px
client width against 1024px scroll width and panned from 0px to 320px; the
360px Views strip measured 344px client width against 492px scroll width and
panned from 0px to 148px. The long imported document title measured 594px
client width against 1357px scroll width without displacing its commands.
The executable visual regression separately confirms exact full-value title
access for Latin and CJK cells, actual clipping, and the forced-colors focus
boundary: after focus it is a solid 3px `Highlight` outline against the white
selected-cell surface. The recovery capture uses the existing acceptance-only
fault after real edits and reports `Needs refresh` with zero stale grid cells.
These observations remain headless/emulated and do not substitute for the
pending physical Mac walkthrough.
