# Continuous Mission delivery

The operating mode is called **Stewarded Continuous Delivery (SCD)**; see the
[naming reference](https://github.com/nurockplayer/tachiko-work/blob/main/docs/governance/project-governance.md#repository-delivery-workflow).
This document remains Sheet's local delivery authority. Sharing the name does
not import upstream permissions or change the existing clauses below.

Status: founder-authorized Sheet-local delivery policy, 2026-09-10, recorded by ChatGPT Steward under #1. It changes the old *client planning* dispatch limits, not Tachiko Work semantic authority or upstream delivery policy. The 2026-09-23 Sol-led amendment in #77 supersedes the 2026-09-22 Astra-led amendment in #73, the 2026-09-12 Terra single-lead amendment and the 2026-09-20 Oracle-only routing amendment.

## Authority and roles

Upstream Product Constitution, foundational principles and relevant Accepted semantic/storage/authorization ADRs/specs constrain this client. Sheet #1 owns the finite product goal; this policy owns local dispatch; active children own their bounded implementation. Evidence is not architecture authority. Issue #2 is operational state only.

ChatGPT Steward owns product scope, specifications, acceptance outcomes and material acceptance decisions. The **Mission Lead** is delegated **Sheet delivery stewardship**: sequence work, verify evidence, record qualified Ready decisions, integrate and merge eligible Sheet PRs. This is not power to invent missing semantic contracts, change product goals, waive acceptance, or turn implementation-authored tests into independent acceptance. Other roles follow actual global configuration, not old repo-specific model mappings.

**Sol-led amendment (2026-09-23 / #77):** exactly one GPT-6 Sol Mission Lead/session is active after the transition is merged, recorded in #2 with exact branch/HEAD and writer ownership. Confirm previous writers have stopped or explicitly transferred before takeover. Sol is the sole Sheet coordinator/integrator and the highest engineering decision authority inside already-settled product/specification/semantic/storage/acceptance boundaries. GPT-6 Luna supplies bounded implementation and unit-test capacity.

### Sol-led serial delivery, Astra advice and Oracle review

Default to one production implementation lane at a time. There is one Sol Mission Lead and one active production writer/worktree for the current package. Luna receives one settled package at a time. A second production package starts only after the current package is merged/closed, explicitly blocked and released, or ownership is durably transferred. Read-only research, CI, Astra consultation, Oracle review and ChatGPT stewardship may overlap only when they create no competing writer.

Sol owns sequencing, decomposition, architecture/implementation strategy, bounded technical tradeoffs, worker packages, repair-batch decisions, integration, Final Candidate declaration and protected merge execution after all gates pass. Sol does not need founder approval for ordinary engineering choices already inside accepted authority. It cannot independently change Mission scope, Accepted Tachiko Work semantics/storage/authorization contracts, Steward-owned acceptance outcomes, explicit HOLDs or founder/external/public/commercial gates.

For each material engineering choice, record a compact decision on the owning Issue/PR: problem/context, chosen approach, key rationale/tradeoff, relevant rejected alternative, and rollback/reversal path when material. This is durable reporting, not an approval gate.

For a genuinely difficult problem, high-risk architecture choice or unclear cross-boundary design, Sol may request bounded read-only **Astra** advice. Astra receives no writer/integrator/merge ownership and cannot change accepted product/semantic/acceptance authority. If consulted, record the useful advice and Sol's final disposition. Sol remains the final engineering decision-maker. Do not invoke Astra for routine implementation or mechanical repair.

At a stable Final Candidate, use a fresh independent **Oracle latest Extra High** exact-HEAD review. Oracle is read-only and must not have participated in the candidate's design, implementation or acceptance/evidence preparation. Required merge verdict: `No blocking findings.` Oracle does not promote Ready, clear HOLD, write code or merge. A material commit after the receipt invalidates it.

Record meaningful GitHub stages on the owning Issue/PR: INTAKE, PLAN/DECISION, IMPLEMENTED, VALIDATED, `FINAL_CANDIDATE <sha>`, ORACLE REVIEW and MERGED/BLOCKED/HANDOFF. Keep #2 as the concise recoverable state. After qualified closeout Sol re-reads live authority/ownership and continues the next genuinely Ready serial successor without waiting for a founder prompt.

## Three-level SCD loop and Final Candidate

Use this cadence without weakening Conditional Ready, acceptance ownership, independent-review eligibility, exact-head validation or normal merge protections:

1. **Inner loop:** implementation and mechanical repair already covered by authority may use granular local commits and focused local tests. Do not request fresh independent Oracle final review for a WIP head or rerun full hosted gates solely because a small repair commit exists.
2. **Repair-batch checkpoint:** collect the complete currently known finding set and classify it together. Batch all mechanical findings inside already-authorized bounds into one coherent repair. Scope, durable-product, acceptance or authority conflicts return to ChatGPT Steward. After the batch, run affected regression/integration checks. Push at coherent checkpoint boundaries when practical; local commits may remain granular. Do not manually request final review for intermediate WIP heads.
3. **Final Candidate:** the lane may record `FINAL_CANDIDATE <sha>` only when no known code mutation remains, no blocking finding or discretionary/Steward decision remains unresolved, applicable focused and affected-regression checks are green, and the PR is otherwise believed merge-ready under existing authority. Only then run full applicable hosted gates and obtain one fresh independent exact-HEAD review from an eligible fresh Oracle latest Extra High session.

A material commit after Final Candidate invalidates that status and requires the applicable exact-head gates and review again. If final review fails, collect the complete finding set first, invalidate Final Candidate, classify once, make one bounded repair batch, and then establish a new Final Candidate; no high-cost reviewer is a linter for each small fix. If the same defect/failure family survives two bounded repair batches, stop patching and perform a root-cause checkpoint before another high-cost final-review cycle.

Keep #2 as one concise current handoff replaced in place. Historical checkpoints and detailed evidence belong in the owning Issue or PR rather than accumulating in #2.

## Conditional Ready; no ceremonial stop

For each child the lead records, in that Issue, the exact baseline/seed/core-artifact refs, risk and write owner, acceptance-to-requirement map and actual qualification results. Ready requires:

1. The work is inside #1, with sufficient Accepted semantics and only bounded reversible client choices unresolved.
2. Steward-authored acceptance exists, its intended outcomes are preserved, and a reviewer independent of acceptance/production authorship has assessed adequacy for the concrete boundary.
3. Fixtures reach the real core boundary; required runtime/host/artifact prerequisites are actually available. Setup failures are not behavioral RED.
4. The child is coherent, independently reviewable and does not compete with a live writer/PR.
5. Applicable unit tests, integration checks, manual/platform evidence and merge gates are identified. An exception is explicit, narrow and does not waive another applicable class.

**Greenfield evidence plan:** before a UI exists, qualify its fixture and real kit, parse/load the test code and review the fixed user oracles. Record the absent UI as an unverified product seam, not a fake behavioral RED. This bounded preparation route permits implementation after the above independent assessment; final merge still requires the real browser journeys and applicable host evidence to pass. No mock success, skipped tests or setup-error RED substitutes for that final gate.

Once these conditions hold, the lead records Ready and continues, without an extra founder message merely to repeat permission. There is no mandatory stop after #3, a material checkpoint or a completed PR. Missing independent review, actual acceptance or durable authority remains a real blocker; work on independent eligible lanes can continue. Do not call every optional question a blocker.

## Acceptance ownership and changes

Preserve the imported test source/hash and existing expected outcomes. Implementers add unit tests and may repair disclosed mechanical wiring without changing scenario, oracle or boundary. Material changes, new missing acceptance and authority contradictions return to ChatGPT Steward. A reviewer cannot silently promote their preferred product design into scope. The initial seed does not cover every full-profile or macOS requirement; those need concrete acceptance, not an exemption inferred from the Mission.

## PR and merge authority

Use one coherent product slice per PR; acceptance and implementation normally share its eventual lane. Keep unqualified seed work off main. Do not split work into cosmetic micro-PRs or turn the full Mission into one giant PR. Production implementation is serial: one active production implementation lane and one active writer/worktree unless a separately founder-authorized policy changes that bound.

For **tachiko-sheet only**, the lead may execute a merge when all of these are proven for the exact final material HEAD:

- live Issue, main, PR and overlap state have been rechecked;
- applicable Steward acceptance, implementer unit tests and required local/hosted checks passed; absent/pending CI is not green;
- all valid blocking findings are resolved, and an independent final-head review exists;
- storage, identity, revision/recovery, import/export, authorization/security, SDK/compatibility or CI/governance changes receive fresh deep independent review;
- the final reviewer authored neither the implementation nor its acceptance/evidence, did not materially participate in the consulted solution direction, and was not merely the earlier finding author re-approving their own fix;
- normal GitHub protections and review requirements permit the merge, without admin bypass, force push, fabricated approval or blanket auto-approve;
- the recorded head still matches immediately before merging.

Execution of a reviewed merge by the coordinator is not independent approval. **Oracle remains read-only and never performs the GitHub merge; Sol/Conductor executes the merge only after the fresh Oracle receipt and every deterministic/hosted gate are valid for the exact recorded HEAD.** Lead-authored code still needs another reviewer. After merging, verify the integrated main at the affected boundary, reconcile any surviving review debt, update #2 and continue. Closing a child never closes #1. Final product/release acceptance and permission to close #1 remain founder/Steward-owned. No automatic publication, purchases, signing-account enrollment, credential provisioning or terms acceptance follows from PR merge authority.

## Upstream boundary

Core work stays in tachiko-work. #359 and #361 retain producer/I/O and delegated-bridge ownership; #315–#319/#330 and then-live successors retain their own semantics. Sheet may inspect, reproduce and prepare bounded upstream work, but production/Ready/merge there needs upstream live authority. In particular #331/#351 and their owners are not taken over. Sheet #1 cannot override an upstream no-self-merge or acceptance gate.

## Continuation and stop

Use #2 for one concise recoverable checkpoint; detailed evidence belongs to the active PR. Wait on nonterminal work using event/blocking waits or at least 180-second polling. Stop affected mutation for a concrete missing authority/acceptance, unresolved substantive finding, or external permission; continue genuinely independent qualified work. Persist work before runtime termination. Qualified closeout triggers recalibration and the next genuinely Ready successor rather than a ceremonial stop. The repository policy itself does not install a scheduler; the founder-authorized ChatGPT hourly steward is an external read-only stewardship loop and never becomes a competing writer.

One-time exception: this previously empty public repository is initialized with founder-authorized Mission, documentation and agent entry files by ChatGPT. This is not a production merge, independent review claim or precedent for direct-to-main product development. Subsequent production and policy changes use reviewed PRs.
