# Test-only wiring contracts

Extracted unchanged from the original Steward acceptance guide at `f264ead7a8286b0de337792b118055f13aa2c83d`. C1/M1/M2 refer to test groups, not a second Mission or dispatch policy. Follow the live Sheet DELIVERY.md for readiness; these descriptions do not override it. Brief is auxiliary Sheet notes/reporting.

## M1 integration wiring contract (test-only)

The UI test language is English; fixture notes/titles are CJK. Stable test markers
identify semantic targets rather than DOM layout or React internals:

- `open-project`: normal directory file input; `project-ready`: real open complete.
- `cell:{entity}:{field}`: rendered Table value (focusable editable grid cell where
  applicable); `brief:{entity}:{field}`: rendered linked Brief fact.
- Each rendered fact carries opaque `data-work-occurrence`, `data-work-revision`,
  `data-work-entity`, `data-work-currentness`. These are observations, not permission.
- Table and Brief tabs; the labeled Edit cell and Decision notes text controls;
  Apply notes, Save a copy, Copy name, Create copy, Close project controls.
- Save status “Saved on this device” only after host commit; operation outcome
  “Outcome unknown” during the injected ambiguous-publication scenario.
- Unsaved work dialog with Keep editing; saved sample action Open saved review-copy.

Use accessible roles and names. Mechanical locator repairs can follow governance;
removing scenarios, changing expected values or replacing a real boundary cannot.
Tabs express the contracted view-switch action, not a required pixel layout.

The reviewed test build provides `window.__tachikoAcceptance`:

`observe()` returns deterministic {occurrence, revision, entity, impact, priority,
notes, canonicalHash} from the actual production runtime and explicit debug
snapshot/codec boundary, not the projection cache or fixture constants.
`savedHash(name)` reads actual durable saved bytes, returning null if absent.
`failNextSave()` fails the next real host save before commit. It must not supply
replacement semantic data. `loseNextExecuteReply()` loses a response only after
real dispatch; `executeRequestCount()` observes the real transport.
`settleFaultWindow()` waits for that bounded failure/recovery experiment, not an
arbitrary sleep or a test-triggered retry. `saveObservation()` and
`unknownObservation()` must read the actual rendered status/currentness, not set
outcome fields. `lastReceipt()` observes the last actual trusted execution receipt;
it must not fabricate delegated provenance or successful publication. No hook may publish semantic state, substitute calculation
results, approve a proposal, fabricate receipts or directly set product success.

The driver is delivery-owned mechanical wiring subject to independent review.
Test hooks must be absent from the distributable build. Observation snapshots are
allowed at this explicit debug boundary; ordinary product editing still uses
bounded queries. Do not convert test driver names into a stable public API.

## M2 driver contract (test-only)

`createDriver({fixture})` creates a fresh real runtime and trusted authorization
domain per case. `observe()` is a Human-authorized deterministic query/debug
snapshot, including canonical hash, revision and the tested current values.
`propose`, `preview`, `execute` act through a Delegated occurrence. `approveAsHuman`
is a separate trusted Human action, not renderer-supplied `approved:true`.
`editAsHuman`, `revokeDelegatedAuthority`, `revokeQueryAuthority`, `reopenFixture`
exercise the genuine owner boundaries; `executeAltered` tests rejected tampering.
`externalEffectCount` observes attempted host effects. `close` cleans up every case.

The driver normalizes result categories to published/denied/etc only for tests;
it cannot normalize a real successful mutation into denial. `preview` after Query
revocation returns disclosure-safe denial with empty disclosedSubjects/Values.
Broader owner-crate tests must also audit indirect leaks through messages/metadata.

## C1 artifact/storage wiring (test-only)

`artifact-manifest.json` declares sourceRepository, exact sourceCommit, experimental
stability, the public experimental entry, required asset paths with SHA-256 digests,
and licenseNotices paths. All kit files except the manifest are declared exactly
once; no symbolic links, traversal or undeclared asset is accepted. This packaging
manifest is provisional and does not stabilize a client SDK or wire protocol.

The storage `createDriver({fixture})` creates a real consumer/core occurrence.
`editImpact`, `editNotes`, `exportCanonicalTree`, `exportRo`, and
`verifyRoUsingCore` must call the real semantic/storage boundaries.
`reopenCanonicalWithOldPresentationCache` starts a fresh occurrence with the supplied
canonical tree while retaining the old disposable view cache. `tryOpenCanonical`
exercises the production admission/replacement boundary; rejection preserves the
previous work. `observe` uses the actual core and `close` releases the host.
The test edits exported fixture bytes only to independently challenge persistence;
that is not permission for the production frontend to parse or mutate the format.

## #146 Save closure acceptance wiring

`pnpm acceptance:save-closure` and `pnpm acceptance:production-lifecycle` are
separate required, ordered gates in `product.yml`. The first builds the
acceptance artifact, serves the existing qualification routes over HTTP,
requires all seven real producer/adapter prerequisites, then runs all eleven
current Save closure cases. The existing production build step clears and then
records a candidate-bound inventory receipt around the single `pnpm build`.
The second consumes those exact candidate-bound PASS receipts and that freshly
recorded `dist`, serves it over HTTP, and runs the hook-free
Save/reopen/full-browser-process-restart/download canary. No disk
route fulfillment, acceptance hook, test fixture substitution, or browser
fallback is part of the production lifecycle.

The workflow sets the shared `TACHIKO_SAVE_CLOSURE_EVIDENCE_DIR` to a fresh
runner-temp directory. For direct invocation, set the same variable, then run
`pnpm acceptance:save-closure`, record one freshly built production artifact,
then run `pnpm acceptance:production-lifecycle`:

```sh
pnpm acceptance:save-closure
node scripts/run-production-lifecycle.mjs --clear-build-receipt
pnpm build
node scripts/run-production-lifecycle.mjs --record-build
pnpm acceptance:production-lifecycle
```

The first gate writes
`save-closure/prerequisites.json`, `save-closure/current-save-closure.json`,
their raw seed receipts, logs, and `save-closure-summary.json`. The production
runner removes and recreates only `production-lifecycle/`, requires those exact
candidate-bound receipts and raw seed hashes, and verifies the fresh build
receipt and current `dist` inventory before serving it. The build receipt is
cleared before the workflow build step and records the complete artifact
inventory and candidate identity afterward. The lifecycle gate writes its
receipt/logs and updates the root `summary.json` aggregate.

Receipts bind base, candidate HEAD, committed and dirty/untracked changed-path
hashes, and all three frozen seed hashes. Candidate identity is for evidence
association; changed-path scope remains a separate review concern outside test
execution. The aggregate records pinned source/adapter/producer
identities, exact expected-case registries and outcomes, artifact manifests,
process/profile identities, diagnostics, and receipt/log paths. Missing cases
remain `NOT RUN` or `BLOCKED`; no missing row becomes `PASS`. Outcomes are
`PASS`, `BEHAVIORAL_RED`, `BLOCKED`, or `NOT RUN`, and aggregate success requires
both gate receipts to pass for the same candidate.

The workflow always uploads the shared evidence directory with the immutable
`actions/upload-artifact` v4.6.2 commit pin, including on failed gates. It keeps
the aggregate and raw seed receipts, build/artifact inventories, runner logs,
production process evidence, diagnostics, and downloaded PNG for 14 days. If
the job fails before writing evidence, the upload step warns when the directory
is empty and preserves the original failure result.

The hosted `product.yml` gate provisions the locked Playwright Chromium on
`ubuntu-24.04`. A system Chromium diagnostic or a failed official Playwright
browser download is not managed-browser qualification. On pull requests, after
the clean gates pass, the serial M1–M6 qualification records each disposable
fault separately; the lifecycle seed's blank-PNG negative control remains its
fixed oracle check and does not replace those probes.
# Issue #146 save-closure mutation qualification

The existing `scripts/run-save-closure-mutations.mjs` wires the accepted M1–M6 fault contract to the frozen Save closure and production acceptance oracles. The product workflow runs it only for pull requests, after the unchanged clean prerequisite/current Save closure and production lifecycle gates pass. It verifies the PR head against the fixed authorized candidate and base before creating any disposable worktree.

Mutations run serially, one fault per detached worktree. Each worktree receives a link to the already-installed dependencies; no package or product source is committed as a fault. Raw source preimages, patch bytes and hashes, per-command output, seed receipts, candidate identities, assertions, and restoration proofs are retained under the workflow evidence directory. Every fault is restored and checked against original source hashes before the clean 7 prerequisite and 11 current cases are rerun. A timeout, navigation/setup failure, incomplete receipt, or unrelated blocked case remains `BLOCKED` and stops further fault runs.

M1’s separate controls execute the frozen wait predicate and explicit Saved assertion. They cover immediate Saved, actual Save failed, stale Saved with the dialog open, missing and indefinitely Saving states, plus navigation and transport failures; controls remain separate from product receipts. M2–M5 require the contract’s existing whole-work refusal, producer-dispatch, Date edit, or source-preservation assertion, including M5b’s earliest existing source-name assertion. M6 first runs unchanged `pnpm acceptance:product` against the same production-only loader mutant, archives the raw output, and restores only its generated product-acceptance evidence paths. It then obtains fresh 7/11 receipts and a production build under the unchanged mutant identity. A bounded hosted locked-Playwright probe independently qualifies production HTTP, the managed browser, CDP and cold Home; the frozen `pnpm acceptance:production-lifecycle` must then fail at its exact Home/Open runtime assertion with no unrelated HTTP, request or page errors. Timeouts and setup failures remain BLOCKED. After restoring M6, the clean acceptance and production lifecycle gates run again.

The hosted mutation runner archives the clean `acceptance:product` step’s generated `evidence/product-acceptance/` outputs, restores their committed preimages, and verifies a clean candidate checkout before reading clean-gate receipts or creating any mutation worktree. Its clean-gate comparison requires identical base, HEAD, and committed source hashes; receipt-only dirty paths are accepted only when each path and hash matches the archived output. Mutation worktrees and post-restore reruns bind to the reconciled clean candidate identity. Product source and acceptance history remain untouched.

The mutation stage stays within the workflow’s existing 20-minute job timeout and reserves time for owned-process cleanup, evidence writes, and artifact upload. It does not change frozen seed files, Work pin, manifest, fixtures, workflow permissions, dependencies, or acceptance rules. No Mac browser is launched; M6 uses only the existing hosted Ubuntu Playwright installation.
