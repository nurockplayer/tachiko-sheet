# SCD operational playbook

Status: **operational guidance, not authority**.

The authority order remains live **#1 → #2 → `AGENTS.md` → `docs/DELIVERY.md` → active Issue/PR → required upstream authority**. This playbook records repeatable operating practice learned from completed delivery work. When it conflicts with live authority, live authority wins.

The completed #70 / PR #83 run is the main historical case study because it exercised Figma authoring, serial worker ownership, CI failure diagnosis, multiple Final Candidate invalidations, repeated independent-review blockers, root-cause escalation, Oracle transport trouble, review-thread cleanup and normal protected merge.

## 1. Start from live state, not session memory

At intake, takeover, resume, post-merge recalibration, or after a long wait:

1. read live #1;
2. read the current #2 body;
3. read `AGENTS.md` and `docs/DELIVERY.md`;
4. read the active Issue/PR;
5. verify current `main`, PR HEAD/base, open PRs, checks and review threads;
6. only then use old session logs or historical comments to explain discrepancies.

Historical transcripts are **audit evidence**, not current instructions. A previous session saying “design pending” or “review running” does not override a later merged PR or closed Issue.

Keep #2 short enough to recover the mission quickly. Detailed history belongs on the owning Issue/PR.

## 2. Preserve one serial implementation owner

The normal production pattern is:

```text
GPT-6 Sol Mission Lead / integrator
        ↓
one bounded GPT-6 Luna writer package
        ↓
Sol integration / affected validation
        ↓
next bounded package, or Final Candidate
```

Rules:

- one active production writer/worktree for the current package;
- Sol remains the engineering decision-maker and integrator;
- Sol does not concurrently edit the same source while Luna owns the package;
- the next writer starts only after the current writer returns/releases ownership;
- read-only research, CI watching, Astra advice and review may overlap only if they cannot mutate the candidate;
- update #2 when ownership materially changes.

A worker handback is not automatically integration PASS. Sol still reviews the diff, checks test adequacy, resolves findings and records the durable checkpoint.

## 3. Use Figma as authority without forcing Figma-native authoring

For material UI work governed by #44, prefer the proven render-first workflow:

```text
settled product/interaction contract
        ↓
ephemeral HTML/CSS visual harness outside product source
        ↓
browser render inspection at representative sizes/states
        ↓
qualified official Figma bridge import_html_layers
        ↓
editable canonical Figma nodes + native screenshots/readback
        ↓
independent design/interaction review
        ↓
APPROVED nodes become implementation authority
        ↓
product implementation
```

The HTML/CSS harness is disposable design tooling. It must not become product/runtime authority.

Before calling a design gate PASS, prove:

- the canonical file is the target;
- the qualified bridge/plugin pair is connected;
- imported content is editable nodes, not a flattened image;
- exact node IDs and native screenshots/readback are recorded;
- responsive/compact/short-window and protected states are represented where applicable;
- an independent reviewer returns no blocking design/interaction finding.

A later implementation defect may expose a genuine flaw in approved design authority. If fixing source alone would drift from the approved role/value mapping, amend Figma narrowly, review that amendment independently, then align source/tests to the amended authority. Do not weaken mapping tests merely to make a source-only repair pass.

Historical example: #72 qualified the official writable bridge; #70 then used render-first HTML/CSS, imported editable nodes, and obtained independent design approval before Phase B.

## 4. Package implementation around decisions, not around files

Before each Luna package, Sol records a compact decision when one is material:

- problem/context;
- chosen approach;
- why this is the bounded solution;
- relevant rejected alternative;
- rollback/reversal path when material.

Give Luna only the settled implementation/test package. If implementation reveals a new architecture, product, semantic, storage, security, data-integrity or acceptance choice, return it to Sol rather than letting the worker improvise.

Prefer packages that can be independently checked, for example:

- pure parser/admission logic;
- preference/storage adapter;
- host file/download effect;
- UI wiring;
- visual/interaction repair.

Do not split work into arbitrary micro-packages merely to create activity.

## 5. Validation progresses from focused to affected to whole product

Use the cheapest evidence that can answer the current question:

### Inner loop

- focused unit tests;
- typecheck;
- narrow browser probe;
- diff/whitespace checks.

### Integration checkpoint

- affected unit/integration tests;
- real browser journey for the changed boundary;
- product-owned invariant checks;
- exact visual/pixel checks where the defect is paint/geometry related.

### Final Candidate

Only after no known mutation/finding remains:

- full applicable local product acceptance;
- production build / trust-pin checks;
- required hosted checks on the exact HEAD;
- fresh independent Oracle review.

Do not use a unit PASS to claim browser/product PASS. Do not use a browser screenshot to claim semantic or persistence PASS.

## 6. Final Candidate is disposable

`FINAL_CANDIDATE <sha>` means “this exact material HEAD is believed merge-ready.” It is not a badge that survives later evidence.

Immediately invalidate the Final Candidate when any of these happens:

- a valid P1/P2 blocker is found;
- a material source/test/acceptance commit is added;
- the review shows the candidate violates accepted authority;
- a required hosted gate fails for a real candidate defect;
- previously unresolved review debt still applies.

After invalidation:

1. record that the old candidate and its review receipt are stale;
2. collect the complete known finding set;
3. classify the findings;
4. form one coherent bounded repair batch;
5. run affected evidence;
6. only then establish a new Final Candidate and redo exact-head gates/review.

Never carry a prior Oracle PASS across a material commit.

## 7. Stop patching when the same defect family repeats

If the same defect/failure family survives two bounded repair cycles, stop sending high-cost final reviews and perform a root-cause checkpoint.

The root-cause checkpoint should answer:

- what common model/coverage assumption was wrong;
- which real rendered/runtime consumers exist;
- which candidate checks were measuring the wrong state;
- which adjacent cases are real versus hypothetical;
- what bounded rule/change fixes the family without broadening the contract unnecessarily.

Use real browser/runtime evidence to classify adjacent concerns. Do not add global restrictions that reject valid built-ins unless the actual product rendering requires them.

The #70 contrast sequence is the reference example: repeated blockers around profile colors eventually required an actual-use consumer inventory and gradient/focus analysis, rather than another one-pair patch.

## 8. Hosted CI failure is evidence, not automatic code failure

When local full acceptance passes but a required hosted gate fails:

1. keep merge closed;
2. inspect the exact failed job/log;
3. identify whether the failure is:
   - product behavior,
   - test/harness defect,
   - platform/geometry difference,
   - transient/infrastructure failure;
4. repair only the proven cause.

A retry of the **same unchanged HEAD** is acceptable when the failure has been diagnosed as transient/flaky/environmental and the retry is itself recorded. A retry must not erase the original failure from the evidence trail.

If source/test behavior changes, establish a new HEAD and rerun the applicable exact-head gates.

## 9. Oracle is a final reviewer, not a linter or progress meter

Use one fresh, independent Oracle latest Extra High session only after the candidate is stable.

Required behavior:

- attach the exact HEAD/base and complete relevant diff/context;
- require concrete P1/P2 findings with trigger/file/line when applicable;
- require literal terminal verdict `No blocking findings.` only when there are no blockers;
- keep Oracle read-only;
- do not let a design/implementation/acceptance author receive final-review credit.

### Long-running review

“Running”, “streaming”, model selection, or heartbeat output is **not** a verdict. Wait for the complete response.

Do not launch duplicate final reviews merely because the first one is slow.

### Transport/tool failure

If the browser/transport loses the response, distinguish:

- **review content existed and can be recovered read-only**: inspect the complete recovered response and treat its findings normally;
- **no complete recoverable verdict exists**: mark review incomplete and keep merge blocked.

Tool failure is not `No blocking findings.`.

## 10. Convert reviewer counterexamples into regression evidence

For every valid blocker:

1. reproduce the reviewer counterexample against the current implementation;
2. prove the old implementation incorrectly accepted/rendered it;
3. add the narrow unit/admission regression;
4. add a real browser/runtime regression when the defect depends on actual paint, focus, geometry, host effect or lifecycle;
5. verify a nearby valid positive case still works.

This avoids “fixing the test” without proving the product boundary.

When a review finding touches design authority, verify whether the correct fix is source logic or a reviewed Figma amendment.

## 11. Resolve review debt before merge

A clean Oracle verdict is necessary but not sufficient.

Before merge, recheck:

- PR HEAD and base still match the reviewed candidate;
- all required hosted checks are SUCCESS on that HEAD;
- all valid review threads are resolved;
- stale PR descriptions/status text no longer point at an invalidated candidate;
- worktree/branch state is clean/recoverable;
- GitHub reports the PR mergeable under normal protections.

Reply to old findings with the repair evidence before resolving them. Never use admin bypass to skip review-thread or protection state.

## 12. Handoff discipline

Use #2 as a **recoverable snapshot**, not a diary.

A good #2 state contains only:

- current Mission Lead;
- current writer/worktree/branch, or “no active writer”;
- exact main and candidate refs;
- current stage;
- active blocker/review debt;
- next recoverable action;
- important HOLD/external gates.

Put detailed decisions, test commands, screenshots, findings and historical candidate failures on the owning Issue/PR.

When a candidate becomes invalid, update #2 so a later session cannot mistake the stale HEAD for merge-ready state.

## 13. Waiting discipline

Pending CI/review/worker is not completion.

While waiting:

- do not mutate the exact candidate;
- do not repeatedly rerun already-green full suites;
- use event/blocking waits when available;
- if polling is necessary, follow repository cadence;
- do not start a duplicate writer or duplicate Oracle review;
- use the time only for non-mutating evidence inspection that cannot invalidate independence.

If the waiting system itself fails, record the tool/transport failure separately from product findings.

## 14. Protected merge checklist

Immediately before Sol executes the normal merge:

- [ ] live #1/#2/Issue/PR re-read;
- [ ] exact PR HEAD/base match the reviewed candidate;
- [ ] no active/pending source writer;
- [ ] applicable local product evidence green;
- [ ] required hosted checks SUCCESS on exact HEAD;
- [ ] fresh independent Oracle verdict is literally `No blocking findings.`;
- [ ] all valid review threads resolved;
- [ ] no unresolved HOLD/external gate applies to this merge;
- [ ] GitHub reports normal mergeability/protections satisfied;
- [ ] no force push/admin bypass/fabricated PASS.

After merge:

1. record merge SHA and post-merge evidence where applicable;
2. update #2;
3. re-read live backlog;
4. continue the next genuinely Ready non-overlapping lane;
5. do not reopen a completed design/implementation gate because an old session remembers it as pending.

## 15. Anti-patterns

Do not:

- treat a raw session transcript as current authority;
- make #2 a historical log;
- let Sol and Luna write the same worktree concurrently;
- launch Oracle against WIP;
- preserve Final Candidate status after a material commit;
- repeatedly ask Oracle to find the next bug one patch at a time;
- retry failing CI without diagnosing the first failure;
- weaken an accepted Figma/source mapping test to accommodate an unreviewed visual change;
- treat Oracle transport silence as PASS;
- merge with unresolved valid review threads;
- reopen already-merged work because the current session is stale;
- substitute synthetic/manual evidence for a physical/manual gate.

## Historical case-study pointers

These links are examples only; they do not override live policy:

- #72 writable Figma bridge qualification: https://github.com/nurockplayer/tachiko-sheet/issues/72
- #70 Interface Profile interchange design + implementation record: https://github.com/nurockplayer/tachiko-sheet/issues/70
- PR #83 final product lane: https://github.com/nurockplayer/tachiko-sheet/pull/83
- #44 continuing Figma-authority workflow: https://github.com/nurockplayer/tachiko-sheet/issues/44

For current state always return to #1, #2 and the active Issue/PR.
