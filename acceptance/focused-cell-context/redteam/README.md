# #149 red-team verification and bounded oracle repair

This directory records acceptance-tool evidence, not product acceptance. The Opus
5.5 report is independent diagnosis; accepted #129 outcomes and #142 design remain
authority. The focused-cell product component and its adapter are still absent.
No production defect, Ready state or product PASS follows from these controls.

## Exact baseline

- Remote main at intake: `0e6a052725506e8417f3c390f50de8721581ab25`.
- Published acceptance base: `81360b9031263507f043c213a4d22e720d74ae8d`.
- Retained pending repair, reconstructed and verified:
  tree `63b133400ec168c5afbda60ac9bf43e3d4f87ed6`;
  preserved commit `955cb83b87b8b4be95958bce7d6b6f0ddc7e932c`.
- `baseline-results.json`: initial Ego Chromium replay of the actual unchanged
  observer and assertion consumers. All 14 bad states incorrectly passed after
  individually passing valid controls; the original 17/2/14 controls passed.

The initial replay establishes acceptance-tool false positives. Its manufactured
DOM is intentionally not represented as a running Sheet product or a mounted
production component. Permanent controls freeze the old modules so the same
mutant can be tested against both actual oracle versions.

## Disposition of the report

| Report finding | Classification and bounded disposition |
| --- | --- |
| 1. Hidden/covered/off-screen expected text | Demonstrated acceptance-tool defect. Repair shared visual observation; keep accessibility evidence separate. The initial replay reproduced aria-hidden stale text, clipping, offscreen, opacity, clip-path, scale, font size, transparent text and covering overlay. |
| 2. Untagged stale state content | Demonstrated acceptance-tool defect. Check complete context composition and an independent no-root surface. Preserve pending orientation; neutral/unknown withhold it. |
| 3. Freshness repaired by re-click; late overwrite | Demonstrated acceptance-tool defect. Permanent controlled replay executes the verbatim frozen Undo/wait/select sequence: both stale-until-reclick and explicitly released late-overwrite states pass the old sequence and fail the new observation. Undo/Redo and reply settlement are now observed without selecting again. Finite observation cannot prove arbitrary future behavior. |
| 4. Composed location unchecked | Demonstrated acceptance-tool defect, included with visibility/composition repair. |
| 5. Keyboard selection | Insufficient evidence; source confirms mouse selection does not establish keyboard behavior. No product defect demonstrated; exact-candidate gate remains required. |
| 6. Full responsive geometry/overflow | Four manufactured-DOM escapes independently reproduced against the unchanged responsive gate: overlap, below-fold, zero-height clipping and unmarked unreachable ellipsis. The initial old control was old-oracle-valid, not fully design-compliant (140px at compact widths). Permanent replay now passes compliant 140/190px positives at all four widths before each mutation; all four mutants pass the old gate and fail the repaired gate. Real input/native comparison remain separate. |
| 7. Selection/focus/forced colors/zoom/screenshots | Insufficient evidence. Native comparison and exact-candidate interaction evidence remain required; no new visual authority or product defect claimed. |
| 8. Actual component state transitions/provenance | Four unchanged projection assertions passed an untagged Last result: 6 in failure/unavailable states. This is an acceptance-tool defect. Actual component mounting, CSS and sequential state transition coverage remain insufficient evidence because the production component/adapter is absent. |
| 9. Independent revision correlation | Coverage limitation; product-self metadata agreement alone is not independent runtime correlation. No new runtime contract or product defect inferred. |
| 10. Results values/history | Coverage limitation outside this bounded repair. Unchanged NOTE1000 and substring matching are weak evidence. No recalculation defect demonstrated. |
| 11. Control completeness only logged | Acceptance-runner defect addressed by required case identity/receipt completeness checks, rather than trusting a PASS label or count log. |

## Controlling decision and limits

[Intake](https://github.com/nurockplayer/tachiko-sheet/issues/149#issuecomment-5971374338)
and [Astra consultation / Sol disposition](https://github.com/nurockplayer/tachiko-sheet/issues/149#issuecomment-5971415693)
authorize only this reversible tooling repair. Formula source remains byte-exact.
Legitimate scrolling and old values in the workbook outside the context must not
become false failures. No-root checks cannot globally forbid bare numbers.

All tests here describe finite oracle controls. Screenshots/native comparison,
real product journeys, actual component provenance and independent exact-source
admission adequacy remain separate gates. The prior reviewer-provenance HOLD is
not cleared and no third identical Oracle request is authorized by this repair.

## Executed repair evidence

`final-controls.json` records **27 old-PASS / repaired-rejection pairs**: 21
rendered-state controls, two history/reply controls and four responsive controls.
Each mutation follows a passing valid control. Required case identities and
counts are asserted by the runner; the hosted entry now runs these controls in
an isolated context before attempting product journeys. Nine frozen source files
are checked against their byte counts, SHA-256 hashes and Git blob hashes.

Existing Node controls remain 17 negatives / two pending positives / 14 pending
negatives. `existing-browser-final.json` records nine positive, five hidden-node,
13 diagnostic and 32 state controls, all passing on the repaired helpers.
Additional positives retain legitimate old content outside the context, numeric
saved-copy names, and byte-exact long formula text in a scroll viewport.

Replay using the qualified Ego transport (supply the existing TaskSpace ID during
an active task; omission creates and finishes one standalone TaskSpace):

```sh
node acceptance/focused-cell-context/redteam/run-ego.mjs 2 /tmp/sheet-context-controls.json
```

`source-manifest.json` binds the repaired source files to these receipts.
JavaScript parse checks, `pnpm build:acceptance`, `pnpm verify:core-kit`, and
`git diff --check` passed. Product source, fixtures, Work pin, dependency manifests
and CI configuration were not changed. This branch is retained tooling work,
not a Final Candidate or a protected-merge request.

### Explicitly uncredited evidence

- Visibility uses finite text-fragment geometry, clipping, opacity and hit-test
  samples, with separate accessible text checks. It is not universal pixel proof.
- Freshness samples immediately, after explicit reply settlement, and four times
  across 200ms. Arbitrarily late mutations are outside that bounded claim.
- The long-formula positive establishes the scroll viewport and exact source
  bytes only. An attempted Ego keyboard scroll did not prove reachability and
  receives no credit. The responsive gate requires separate actual input/end/Tab
  exit evidence for clipped text and fails closed when it is absent.
- An optional normal Home → Sales → Save/Close integration probe could not open
  Sales: the UI displayed “Couldn’t open sales example. Nothing was changed. You
  can try again.” The wait for an open workbook timed out; core-kit integrity
  subsequently passed. Real Home/Recovery composition integration remains
  unverified; no product diagnosis or repair follows from this setup failure.
- One replay encountered an Ego evaluation timeout. After inspecting the live
  page and navigating the same task-owned page to a fresh document, the complete
  27-case replay passed. The interrupted attempt receives no PASS credit.
- Actual component mounting/adapter, full product journeys, hosted candidate
  gates and independent admission review were not established. The report's
  remaining keyboard/focus/forced-colors/native comparison, provenance,
  independent runtime correlation and Results-history gaps remain open.
