# #184 round-4 repair evidence

Bounded implementation of Opus's [Lead disposition after round 4](https://github.com/nurockplayer/tachiko-sheet/pull/188#issuecomment-6162657631), based on `8aea7bfafc82b9086078d11a6b1ca3db92a013c1`.

| Item | Change | Regression on 8aea7bf → repaired source |
| --- | --- | --- |
| 4-A | Remove creation recovery and identity admission. Unknown creation or initial observation failure closes via the existing runtime path and retains the configured dialog with the exact retry message. Uncertain Close reaches Reload. Retain the authoritative no-resident precheck. | `4-A-ack`, `4-A-table`, `4-A-discovery`: dialog count **0 instead of 1 → PASS**. Actual core proves absence; title/header/type and unload protection remain; no replay; explicit Create succeeds. `4-A-close`: no Reload **→ PASS**. Retained `R1-resident` proves zero creation dispatches over surviving `Old`. Retired recovery/identity regressions are replaced. |
| 4-B | Clear `openedFromWorkFile` on Close and replacement dispatch start, including import. | Two session cases, Close and replacement followed by lost acknowledgement: origin **true instead of undefined → PASS**. Supplemental normal browser `.ro` → Close → New → Save proves an ordinary copy carrier; this happy path also passes on the base. |
| 4-C | Late confirmed deletion reconciles a removed roving key to the nearest surviving row, preserving its column, even when newer intent forbids DOM focus movement. | `4-C`: **zero grid Tab stops instead of one → PASS**; newer Appearance focus stays, then actual Tab reaches the grid. Existing surviving-cell selection and deferred-focus checks pass. |
| 4-D | Separate success and Cancel closes. Success schedules first-cell/first-Add-row focus under captured intent and occurrence; Cancel returns to its trigger. | `4-D`: first Add-row field **unfocused → PASS** from both triggers; Cancel return verified. Supplemental held reply/newer persistent focus probe passes without focus theft. |

[Before/after receipt](regression-results.json) records actual baseline assertions. The baseline production build was captured before source changes. Fault injection only loses/delays actual core replies or Close dispatch; the absence probe uses the real `observe_occurrence`. No core outcome or projection is fabricated. The supplemental focus target is an external DOM button that survives replacement, isolating the completion guard from Home controls unmounting.

The final production new-table lane passes **29 groups**, including eight round-4 cases, retained draft/IME/row/Sales/default/resident checks, all-field and stable-ID saved-byte oracles, and full browser process exit/restart. [Lane receipt](result.json), [source/artifact/protected-file hashes](artifact-manifest.json).

| Actual check | Result |
| --- | --- |
| `pnpm typecheck` | PASS, exit 0 |
| `TACHIKO_TEST_SINGLE_PROCESS=1 pnpm test:unit` | PASS, 560 Vitest + 125 Node, exit 0 |
| `pnpm build` | PASS, production hook exclusion included, exit 0 |
| Production new-table lane | PASS, 29 groups / 10 screenshots, exit 0 |
| Full `pnpm acceptance:product` | NOT RUN under the explicit writer contract; Opus runs outside the sandbox |

[Commands/results and disclosed earlier attempts](validation-results.json). Logs and baseline build remain at `/private/tmp/sheet184-round4-validation/`. Historical `product-summary.json` and `visual-summary.json` describe batch 3, not current full-product/visual results. No inherited PASS is claimed.

All screenshots are freshly captured from the final production build:

| Screen | Desktop | Compact |
| --- | --- | --- |
| Home | [1400px](home-1400.png) | [800px](home-800.png) |
| Configuration | [1400px](dialog-1400.png) | [800px](dialog-800.png) |
| Expenses with rows | [1400px](table-1400.png) | [800px](table-800.png) |
| Refused Number draft | [1400px](refusal-1400.png) | [800px](refusal-800.png) |
| Unconfirmed creation with retained configuration | [1400px](unconfirmed-dialog-1400.png) | [800px](unconfirmed-dialog-800.png) |

All 62 recorded protected files are byte-identical to `8aea7bf`. Frozen #146 seeds/runners, public/core-kit and lockfiles remain unchanged. Pre-existing Serena changes are preserved/excluded. No new macOS, physical IME, hosted-gate or independent-review evidence is claimed. Review threads remain open.

w184 denied `index.lock`. Source/evidence are committed byte-identically from `/private/tmp/sheet184-round4-candidate` at the exact `8aea7bf` parent and pushed normally without force. w184 retains tested files at metadata HEAD `8aea7bf`. Opus retains full acceptance, fresh independent exact-HEAD review and integration.
