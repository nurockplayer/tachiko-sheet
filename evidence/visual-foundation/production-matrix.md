# Exact-final-head production visual matrix

Source/build commit: `37d254ec51ea7e4a10ec9598181ac6b47db6c405`.

This matrix was regenerated from that exact production head with:

```text
pnpm build
WORK_CLIENT_URL=http://127.0.0.1:4173 pnpm evidence:visual-foundation-final
```

The capture runtime is Playwright Chromium 1.62.1 in headless mode with
emulated CSS viewports on macOS Darwin 24.6.0 arm64. It is browser evidence,
not native macOS, iPad, physical-device, or #16 evidence.

| State | Viewport / emulation | Versioned capture |
|---|---|---|
| Home | 1440×900 CSS px | `targets/home.png` |
| Home | 1280×800 CSS px | `targets/home-1280x800.png` |
| Home | 1024×768 CSS px | `targets/home-1024x768.png` |
| Home | 720×450 CSS px with document zoom 200% | `targets/home-200-percent.png` |
| Populated actual-core Tracker | 1440×900 CSS px | `targets/workbook-50rows-1440x900.png` |
| Populated actual-core Tracker | 1280×800 CSS px | `targets/workbook-50rows-1280x800.png` |
| Populated actual-core Tracker | 1024×768 CSS px | `targets/workbook-50rows-1024x768.png` |
| Focused selection / edit / save dialog | 1440×900 CSS px | `targets/workbook-50rows-selection.png`, `targets/workbook-50rows-japanese-edit.png`, `targets/save-dialog-final.png` |

The final capture command reported seven rendered CJK cells and zero mojibake
cells at each workbook viewport. The executable visual regression additionally
confirmed exact full-value title access for both Latin and CJK cells, actual
cell clipping, horizontal scroll at 1024px, and the forced-colors focus style
change. These are deterministic headless/emulated observations only.
