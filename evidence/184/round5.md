# Round-5 bounded repair evidence

Base: `f5320aa979e680f9faf650ad9abd2da387142004`. Contract: Opus's **Lead disposition after round 5** on PR #188; 5-A and 5-B only.

- **5-A:** move origin clearing from replacement start to the unknown-outcome catches. Existing acknowledged-open/import and Close clearing remain. The new parameterized session regression opens `.ro`, forces a trusted open/import refusal without replacing the occurrence, then checks the identical read and retained origin through an edit. Both cases fail against unchanged base production source because `openedFromWorkFile: true` disappears; both pass repaired. The adjacent lost-reply test also covers import, ensuring unknown replacement still clears origin. Session tests use the existing injected public-client fake; they are adapter unit evidence, not real-WASM refusal proof.
- **5-B:** trim table and column names at dialog dispatch. The production browser regression enters `' Expenses '` and `' Item '`, checks the actual `new_table` request is trimmed and dispatched once, then verifies the real-core table/column keys. It fails against the exact-base production build with actual `' Expenses '` versus expected `'Expenses'` (the observed column was also padded), and passes repaired. This case is included in the existing new-table root-cause runner and its complete lane.

[Machine-readable commands, before/after results, hashes and full lane receipt](round5-results.json).

Actual final checks: typecheck PASS; single-process unit PASS (**563 Vitest + 125 Node**); production build and hook exclusion PASS; focused session **80/80** PASS; focused production trim case PASS; complete production new-table lane **30 groups** PASS, including all retained repair cases, independent saved-byte/value/stable-ID oracle and full browser process exit/restart. Full `acceptance:product` was **not run**, per writer contract; Opus owns it. No independent approval or integration claimed.

All 62 manifest-protected files match the base byte-for-byte. Frozen #146 seeds/runners, `public/core-kit`, lockfiles and the existing Serena modification are excluded from this repair. Historical screenshots and earlier evidence remain unchanged. Logs and the exact-base production build: `/private/tmp/sheet184-round5-validation/`.
