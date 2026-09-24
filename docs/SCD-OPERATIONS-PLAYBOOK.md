# SCD operational playbook

Status: **operational guidance, not authority**.

There is **no single linear authority chain**. Apply the scoped authority model from `docs/DELIVERY.md`: accepted upstream semantic/storage/authorization authority constrains Sheet; live #1 owns the Mission/product boundary; `docs/DELIVERY.md` owns Sheet-local delivery policy; the active Issue/PR owns its bounded implementation/acceptance contract inside those authorities; and #2 is **operational handoff state only** and cannot override policy, semantics, acceptance, or the owning Issue/PR. `AGENTS.md` / `docs/MVP-EXECUTION.md` are entry and execution guidance within those authorities. This playbook records repeatable operating practice learned from completed delivery work. When it conflicts with any governing authority in its scope, that authority wins.

The completed #70 / PR #83 run is the main historical case study because it exercised Figma authoring, serial worker ownership, CI failure diagnosis, multiple Final Candidate invalidations, repeated independent-review blockers, root-cause escalation, Oracle transport trouble, review-thread cleanup and normal protected merge.

## 1. Start from live state, not session memory

At intake, takeover, resume, post-merge recalibration, or after a long wait:

1. read live #1;
2. read the current #2 body;
3. read `AGENTS.md`;
4. read `docs/DELIVERY.md`;
5. read `docs/MVP-EXECUTION.md`;
6. read the active Issue/PR and relevant upstream authority;
7. verify current `main`, PR HEAD/base, open PRs, checks and review threads;
8. only then use old session logs or historical comments to explain discrepancies.

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
- a worker handback releases the current writer slot but does not by itself start another production package;
- the next package starts only after the current package is merged/closed, explicitly blocked and released, or ownership is durably transferred;
- read-only research, CI watching, Astra advice and review may overlap only if they cannot mutate the candidate;
- update #2 when ownership materially changes.

A worker handback is not automatically integration PASS. Sol still reviews the diff, checks test adequacy, resolves findings and records the durable checkpoint.

## 3. Use Figma as authority without forcing Figma-native authoring

For material UI work governed by #44, use approved editable Figma nodes as implementation authority. Authoring may be Figma-native. The render-first/import route is also valid:

```text
settled product/interaction contract
        ↓
ephemeral HTML/CSS visual harness outside product source
        ↓
browser render inspection at representative sizes/states
        ↓
qualified official Figma bridge import_html_layers (if using this route)
        ↓
editable candidate nodes in the canonical Figma file
        ↓
independent design/interaction review
        ↓
approved nodes become implementation authority
        ↓
product implementation
```

The HTML/CSS harness is disposable design tooling. It must not become product/runtime authority.

For the design review, confirm:

- the canonical file is the target;
- candidate nodes are editable and inspectable in the canonical Figma file;
- responsive/compact/short-window and protected states are represented where applicable;
- an independent reviewer returns no blocking design/interaction finding.

After approval, record the exact approved node IDs/URLs as implementation authority. When using the render-first/import route, verify the qualified bridge/plugin pair and that imported layers remain editable and inspectable. The #70 run recorded native screenshots/readback as evidence; that is an example from the case study, not a universal additional gate.

A later implementation defect may expose a genuine flaw in approved design authority. If fixing source alone would drift from the approved role/value mapping, amend Figma narrowly, review that amendment independently, then align source/tests to the amended authority. Do not weaken mapping tests merely to make a source-only repair pass.

Historical example: #72 qualified the official writable bridge; #70 then used render-first HTML/CSS, imported editable nodes, and obtained independent design approval before Phase B.

## 4. Package implementation around decisions, not around files

Before each Luna package, Sol records a compact decision when one is material:

- problem/context;
- chosen approach;
- why this is the bounded solution;
- relevant rejected alternative;
- rollback/reversal path when material.

Give Luna only the settled implementation/test package. If implementation reveals a new choice, return it to Sol to classify against the governing authority rather than letting the worker improvise. Sol decides choices inside settled engineering boundaries; product scope, specifications or material acceptance choices go to ChatGPT Steward; conflicts with Accepted semantics, storage or authorization go to the relevant upstream authority, with Steward included when product scope or acceptance is involved. Do not freeze a follow-on Luna package or declare a Final Candidate until the required outside authority resolves the question. Complete any applicable #1 Astra/Pro consultation separately; it does not replace this authority routing.

Before freezing an architecture decision or assigning Luna a package, Sol checks live #1 for mandatory Astra consultation and any conditional Pro escalation, and completes the applicable steps when a trigger applies.

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
- for material UI governed by #44, exact-build visual/interaction comparison with approved Figma;
- product-owned invariant checks;
- exact pixel/geometry checks when the defect or acceptance specifically depends on paint/geometry.

### Final Candidate

When no known material mutation, blocking finding or unresolved discretionary/Steward decision remains, and focused/affected checks are green, record `FINAL_CANDIDATE <sha>` for the exact HEAD. Then run the final gates against that SHA:

- full applicable local product acceptance;
- production build / trust-pin checks;
- required hosted checks on the exact HEAD;
- one fresh independent Oracle review.

Do not use a unit PASS to claim browser/product PASS. Do not use a browser screenshot to claim semantic or persistence PASS.

## 6. Final Candidate is disposable

`FINAL_CANDIDATE <sha>` means “this exact material HEAD is believed merge-ready.” It is not a badge that survives later evidence.

Immediately invalidate the Final Candidate when any of these happens:

- any valid blocking finding is found, regardless of label or severity;
- any material commit is added;
- a required hosted gate fails because of an actual candidate defect;

Pending required reviews or checks, and unsatisfied protection state by themselves, remain merge gates but do not invalidate the candidate. If review or protection state reveals an actual blocking finding or candidate defect, classify that finding under the rules above. Ordinary nonblocking review debt alone does not invalidate the candidate.

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
- do not grant final-review credit to anyone who authored the design, implementation, acceptance, or review evidence, materially participated in the consulted solution direction, or is merely the earlier finding author re-approving their own fix.

### Long-running review

“Running”, “streaming”, model selection, or heartbeat output is **not** a verdict. Wait for the complete response.

Do not launch duplicate final reviews merely because the first one is slow.

### Transport/tool failure

If the browser/transport loses the response, distinguish:

- **review content existed and can be recovered read-only**: inspect the complete recovered response and treat its findings normally;
- **no complete recoverable verdict exists**: mark review incomplete and keep merge blocked.

Tool failure is not `No blocking findings.`.

## 10. Convert reviewer counterexamples into regression evidence

For a valid finding with a reproducible product-behavior counterexample, use the relevant regression seam:

1. reproduce the counterexample against the current implementation and establish the incorrect behavior;
2. add a focused regression at the relevant unit/admission/runtime/browser seam;
3. add browser/runtime coverage when the defect depends on actual paint, focus, geometry, host effect or lifecycle;
4. verify a nearby valid positive case when applicable.

For documentation, governance, CI and other findings without a product-behavior counterexample, run the affected checks appropriate to the defect and governing acceptance.

This avoids “fixing the test” without proving the product boundary.

When a review finding touches design authority, verify whether the correct fix is source logic or a reviewed Figma amendment.

## 11. Clear blocking findings and satisfy protections before merge

A clean Oracle verdict is necessary but not sufficient.

Before merge, recheck:

- PR HEAD and base still match the reviewed candidate;
- all required hosted checks are SUCCESS on that HEAD;
- all valid blocking findings are resolved, and normal GitHub review/thread protections are satisfied;
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
- [ ] live `main` and all overlapping open PR/lane ownership rechecked immediately before merge;
- [ ] exact PR HEAD/base match the reviewed candidate, and any `main` movement since Final Candidate has been reconciled/requalified rather than assumed harmless;
- [ ] no active/pending source writer;
- [ ] applicable local product evidence green;
- [ ] required hosted checks SUCCESS on exact HEAD;
- [ ] fresh independent Oracle verdict is literally `No blocking findings.`;
- [ ] all valid blocking findings resolved, with normal GitHub review/thread requirements satisfied;
- [ ] no unresolved HOLD/external gate applies to this merge;
- [ ] GitHub reports normal mergeability/protections satisfied;
- [ ] no force push/admin bypass/fabricated PASS.

After merge:

1. record merge SHA and post-merge evidence where applicable;
2. verify integrated `main` at the affected boundary;
3. reconcile any surviving review debt;
4. update #2;
5. re-read live backlog;
6. continue the next genuinely Ready non-overlapping lane;
7. do not reopen a completed design/implementation gate because an old session remembers it as pending.

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
- merge with unresolved valid blocking findings or while required GitHub review/thread protections are unsatisfied;
- reopen already-merged work because the current session is stale;
- substitute synthetic/manual evidence for a physical/manual gate.

## Historical case-study pointers

These links are examples only; they do not override live policy:

- #72 writable Figma bridge qualification: https://github.com/nurockplayer/tachiko-sheet/issues/72
- #70 Interface Profile interchange design + implementation record: https://github.com/nurockplayer/tachiko-sheet/issues/70
- PR #83 final product lane: https://github.com/nurockplayer/tachiko-sheet/pull/83
- #44 continuing Figma-authority workflow: https://github.com/nurockplayer/tachiko-sheet/issues/44

For current state always return to #1, #2 and the active Issue/PR.
