# Prepared acceptance seed

The executable seed is on `acceptance/sheet-foundation`, not main. Exact refs and commands are recorded in #2 and that branch's evidence/. This main-branch guide is an entry point, not a PASS certificate.

## Commands on the seed branch

```sh
node --test tests/harness.test.mjs
node --check tests/browser.mjs
WORK_CLIENT_KIT=/absolute/verified-kit WORK_CORE_COMMIT=EXACT_SHA node tests/kit.mjs
WORK_CLIENT_KIT=/absolute/verified-kit node scripts/serve-canary.mjs
WORK_CLIENT_URL=http://127.0.0.1:4174 node tests/browser.mjs --canary
WORK_CLIENT_URL=http://127.0.0.1:4173 node tests/browser.mjs
WORK_STORAGE_DRIVER=/absolute/reviewed-driver.mjs node tests/storage.mjs
WORK_AGENT_DRIVER=/absolute/reviewed-driver.mjs node tests/agent.mjs
WORK_CLIENT_URL=http://127.0.0.1:4173 node tests/browser.mjs --agent
```

Use separate foreground sessions for the test server and runner. Install actual compatible Playwright/browser tools with pnpm, pin their versions and lockfile, and record the environment. No package-manager install is needed for dependency-free harness checks. Missing required kit/URL/driver is BLOCKED, not passed or qualified behavioral RED. A helper must not delete/recreate an existing fixture to succeed.

## Mapping and limits

- 30 harness tests validate six observation oracles with 24 deliberately bad observations. They exercise no real UI or runtime.
- kit.mjs: one complete artifact inventory/source-pin/digest test.
- storage.mjs: four real codec/runtime cases: full canonical v1 tree; genuine .ro (not relabeled transfer); edited source defeats old cache; rejected input retains current work.
- browser.mjs --canary: real exported kit admission, 5/10 -> 3/8, Text notes, stale rejection and fresh-runtime round trip. Not host durability.
- browser.mjs: six human journeys for linked Table/auxiliary Brief, process-restart persistence, invalid edit/draft, IME, failed save, unknown Execute, keyboard/cancel/dirty Close.
- agent.mjs: eight trusted lifecycle cases: nonmutating proposal/preview, no unapproved publication, exact approval and replay, changed base, revocation, disclosure, tampering, reopened occurrence.
- browser.mjs --agent: three review UI cases: explicit apply with genuine receipt, reject with no change, stale review requires a new proposal.

These are 23 integration checks, not 23 product PASS results. Extra driver wiring is not automatically semantic evidence. The full Driver Common Profile and native-host acceptance require additional concrete coverage, tracked by #5/#7 and PRODUCT-ACCEPTANCE.md. Do not make those disappear because the first slice passes.

## Test-only wiring

Preserve original source and use docs/TEST-WIRING.md on the seed branch for exact marker/driver descriptions extracted from the original Steward seed. Test hooks may observe genuine canonical/runtime/storage state or inject a bounded host/transport failure; never provide fixture answers, approve, mutate product state, manufacture receipts or classify publication as denial. Independent review must inspect the hook/driver, not trust its booleans. Hooks must be absent from release builds.

Snapshot observations are allowed at this explicit debug boundary; normal client editing still uses bounded semantic operations. A real browser restart and a fresh runtime must actually happen; same-process export/open is insufficient. Synthetic composition events are not real Japanese/Chinese IME or screen-reader evidence. Exact test inputs/expected values remain fixed unless Steward approves a material correction.

Astra records conditional Ready under DELIVERY.md after actual qualification and independent assessment. This supersedes the original Sheet-local automatic-stop instruction, not the required evidence or upstream restrictions. Final product gates do not pass until actually executed on the relevant artifact.
