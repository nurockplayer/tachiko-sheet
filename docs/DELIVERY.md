# Continuous Mission delivery

The operating mode is called **Stewarded Continuous Delivery (SCD)**; see the
[naming reference](https://github.com/nurockplayer/tachiko-work/blob/main/docs/governance/project-governance.md#repository-delivery-workflow).
This document remains Sheet's local delivery authority. Sharing the name does
not import upstream permissions or change the existing clauses below.

Status: founder-authorized Sheet-local delivery policy, 2026-09-10, recorded by ChatGPT Steward under #1. It changes the old *client planning* dispatch limits, not Tachiko Work semantic authority or upstream delivery policy. The 2026-09-12 single-lead amendment remains active; the 2026-09-20 Oracle routing amendment supersedes the prior Terra-to-Astra engineering decision-routing rule.

## Authority and roles

Upstream Product Constitution, foundational principles and relevant Accepted semantic/storage/authorization ADRs/specs constrain this client. Sheet #1 owns the finite product goal; this policy owns local dispatch; active children own their bounded implementation. Evidence is not architecture authority. Issue #2 is operational state only.

ChatGPT Steward owns product scope, specifications, acceptance outcomes and material acceptance decisions. The **Mission Lead** is delegated **Sheet delivery stewardship**: sequence work, verify evidence, record qualified Ready decisions, integrate and merge eligible Sheet PRs. This is not power to invent missing semantic contracts, change product goals, waive acceptance, or turn implementation-authored tests into independent acceptance. Other roles follow actual global configuration, not old repo-specific model mappings.

**Single-lead amendment (2026-09-12; routing updated 2026-09-20):** exactly one Terra Mission Lead/session is active, recorded in #2 with its branch/HEAD and writer ownership. The founder may choose **Terra High or Terra Medium** according to task complexity. Confirm previous writers have stopped or explicitly transferred before takeover; a stale timestamp is not sufficient. Until a new lead is selected and safely claimed, retain the existing lead rather than launching both. Worker-router supplies bounded implementation capacity; the Mission Lead remains the sole Sheet coordinator/integrator. No acceptance or review independence changes with reasoning-effort selection.

### Terra-led mandatory Oracle pre-decision consultation

When Terra is the recorded Mission Lead, the qualified Conductor Oracle lane from [`tachiko-conductor#79`](https://github.com/nurockplayer/tachiko-conductor/issues/79) is the mandatory **read-only pre-decision consultation** path for new discretionary choices. Oracle is reasoning authority for the bounded consultation only; it is not a writer, queue owner, integrator or merge executor.

Before Terra settles or delegates any new discretionary choice that is not already fixed by live authority or a still-applicable prior consultation, Terra must obtain an actual Oracle response. This applies across routine and complex work. It includes, without limitation:

- user-visible behavior, restrictions, defaults, compatibility, Save/draft/Undo/history/recovery or data-loss disclosure choices;
- algorithm, lifecycle/state ownership, public typing, dependency/build strategy, architecture, persistence, concurrency, security or data-integrity trade-offs;
- choosing a repair direction, dismissing or reclassifying a substantive review finding, or accepting a missing behavior as a limitation;
- discretionary scope, decomposition or sequencing changes, abandoning or deferring a lane, relaxing/reinterpreting evidence, or treating work as complete without previously required proof.

Mechanical execution is not a new decision. Applying an exact settled instruction, formatting, running prescribed checks, implementing a previously consulted direction within its recorded bounds, or following an already-authorized deterministic sequence does not require a consultation per line, commit or routine repair. If an implementation worker exposes a new choice, the worker returns it to Terra; delegation does not bypass consultation. When classification is uncertain, consult rather than silently treating the choice as mechanical.

Before affected discretionary implementation proceeds, retain a compact decision entry in the existing canonical handoff narrative (the owning Issue before a PR exists, then the owning Issue/PR handoff as the lane develops). Record:

- exact head/base and authority/evidence pointers;
- the unresolved choice and practical alternatives;
- Terra's recommendation and the relevant user-visible, safety/correctness, compatibility, maintenance and reversibility costs;
- Oracle's bounded disposition (`ANSWER`, `REVISE`, or `BLOCKED`) and `requires_steward_decision` when returned;
- the chosen bounded next action and any required Steward decision link;
- actual proposing/consulting agents plus model/session/call identifiers where observable; mark unavailable attribution unknown rather than guessing.

Oracle remains read-only for the consulted lane and does not receive branch, writer, integration or merge ownership. Oracle cannot amend Accepted authority, accept material test changes, promote Ready, clear HOLD, waive legal/external gates or authorize a merge by itself. Oracle transport failure, no reply, or an unresolved objection keeps the affected discretionary implementation paused; persist recoverable work and continue only unaffected already-authorized actions. Unresolved scope, authority, durable-product or material-acceptance questions return to ChatGPT Steward.

Closely related choices in one bounded Issue may share one consultation only when Oracle explicitly addresses each. Reconsult when assumptions, relevant authority, evidence or the proposed direction materially changes. An unrelated commit alone does not invalidate a consultation.

Oracle consultation does not satisfy independent final review. Final Guarded merge still requires a fresh independent exact-HEAD review. An eligible **fresh Oracle session** provides that review when it did not participate in the solution's design, implementation, acceptance, evidence or consulted direction. A reviewer that participated materially in the solution direction cannot receive final-review credit for that same material HEAD.

This routing adds no human approval stop between ordinary tickets. After qualified closeout, Terra recalibrates live authority and ownership and continues the next genuinely Ready, non-overlapping successor without a new founder prompt. Human/Steward intervention remains limited to canonical unresolved durable decisions, authority conflicts and external permission gates.

## Three-level SCD loop and Final Candidate

Use this cadence without weakening Conditional Ready, acceptance ownership, Oracle decision routing, independent-review eligibility, exact-head validation or normal merge protections:

1. **Inner loop:** implementation and mechanical repair already covered by authority or consultation may use granular local commits and focused local tests. Do not request fresh independent Oracle final review for a WIP head or rerun full hosted gates solely because a small repair commit exists.
2. **Repair-batch checkpoint:** collect the complete currently known finding set and classify it together. Batch all mechanical findings inside already-authorized bounds into one coherent repair; separate findings or commits alone do not trigger another Oracle consultation. Closely related new discretionary choices may share one Oracle consultation only when Oracle explicitly addresses each. Scope, durable-product, acceptance or authority conflicts return to ChatGPT Steward. After the batch, run affected regression/integration checks. Push at coherent checkpoint boundaries when practical; local commits may remain granular. Do not manually request Codex review for intermediate WIP heads.
3. **Final Candidate:** the lane may record `FINAL_CANDIDATE <sha>` only when no known code mutation remains, no blocking finding or discretionary/Steward decision remains unresolved, applicable focused and affected-regression checks are green, and the PR is otherwise believed merge-ready under existing authority. Only then run full applicable hosted gates and obtain one fresh independent exact-HEAD review from an eligible fresh Oracle session.

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

Use one coherent product slice per PR; acceptance and implementation normally share its eventual lane. Keep unqualified seed work off main. Do not split work into cosmetic micro-PRs or turn the full Mission into one giant PR. Independent lanes require non-overlapping ownership; at most three active implementation lanes unless a separately justified policy changes that bound.

For **tachiko-sheet only**, the lead may execute a merge when all of these are proven for the exact final material HEAD:

- live Issue, main, PR and overlap state have been rechecked;
- applicable Steward acceptance, implementer unit tests and required local/hosted checks passed; absent/pending CI is not green;
- all valid blocking findings are resolved, and an independent final-head review exists;
- storage, identity, revision/recovery, import/export, authorization/security, SDK/compatibility or CI/governance changes receive fresh deep independent review;
- the final reviewer authored neither the implementation nor its acceptance/evidence, did not materially participate in the consulted solution direction, and was not merely the earlier finding author re-approving their own fix;
- normal GitHub protections and review requirements permit the merge, without admin bypass, force push, fabricated approval or blanket auto-approve;
- the recorded head still matches immediately before merging.

Execution of a reviewed merge by the coordinator is not independent approval. **Oracle remains read-only and never performs the GitHub merge; Terra/Conductor executes the merge only after the review receipt and every deterministic/hosted gate are valid for the exact recorded HEAD.** Lead-authored code still needs another reviewer. After merging, verify the integrated main at the affected boundary, reconcile any surviving review debt, update #2 and continue. Closing a child never closes #1. Final product/release acceptance and permission to close #1 remain founder/Steward-owned. No automatic publication, purchases, signing-account enrollment, credential provisioning or terms acceptance follows from PR merge authority.

## Upstream boundary

Core work stays in tachiko-work. #359 and #361 retain producer/I/O and delegated-bridge ownership; #315–#319/#330 and then-live successors retain their own semantics. Sheet may inspect, reproduce and prepare bounded upstream work, but production/Ready/merge there needs upstream live authority. In particular #331/#351 and their owners are not taken over. Sheet #1 cannot override an upstream no-self-merge or acceptance gate.

## Continuation and stop

Use #2 for one concise recoverable checkpoint; detailed evidence belongs to the active PR. Wait on nonterminal work using event/blocking waits or at least 180-second polling. Stop affected mutation for a concrete missing authority/acceptance, unresolved Oracle disposition or substantive finding, or external permission; continue genuinely independent qualified work. Persist work before runtime termination. Qualified closeout triggers recalibration and the next genuinely Ready successor rather than a ceremonial stop. No scheduler is installed by this policy.

One-time exception: this previously empty public repository is initialized with founder-authorized Mission, documentation and agent entry files by ChatGPT. This is not a production merge, independent review claim or precedent for direct-to-main product development. Subsequent production and policy changes use reviewed PRs.
