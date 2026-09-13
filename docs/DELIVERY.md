# Continuous Mission delivery

The operating mode is called **Stewarded Continuous Delivery (SCD)**; see the
[naming reference](https://github.com/nurockplayer/tachiko-work/blob/main/docs/governance/project-governance.md#repository-delivery-workflow).
This document remains Sheet's local delivery authority. Sharing the name does
not import upstream permissions or change the existing clauses below.

Status: founder-authorized Sheet-local delivery policy, 2026-09-10, recorded by ChatGPT Steward under #1. It changes the old *client planning* dispatch limits, not Tachiko Work semantic authority or upstream delivery policy. The 2026-09-12 single-lead amendment is merged and active.

## Authority and roles

Upstream Product Constitution, foundational principles and relevant Accepted semantic/storage/authorization ADRs/specs constrain this client. Sheet #1 owns the finite product goal; this policy owns local dispatch; active children own their bounded implementation. Evidence is not architecture authority. Issue #2 is operational state only.

ChatGPT Steward owns product scope, specifications, acceptance outcomes and material acceptance decisions. The **Mission Lead** is delegated **Sheet delivery stewardship**: sequence work, verify evidence, record qualified Ready decisions, integrate and merge eligible Sheet PRs. This is not power to invent missing semantic contracts, change product goals, waive acceptance, or turn implementation-authored tests into independent acceptance. Other roles follow actual global configuration, not old repo-specific model mappings.

**Single-lead amendment (2026-09-12):** the founder may select Astra or Terra as Mission Lead. Exactly one lead/session is active, recorded in #2 with its branch/HEAD and writer ownership. Confirm previous writers have stopped or explicitly transferred before takeover; a stale timestamp is not sufficient. Until a new lead is selected and safely claimed, retain the existing lead rather than launching both. Older Sheet-local references to Astra's coordination role mean the selected Mission Lead unless a narrower advisory role is explicitly stated below; model-specific worker instructions and upstream authority are not rewritten by that alias. No acceptance or review independence changes with a role/name switch.

### Terra-led Astra escalation advisory

When Terra is the recorded Mission Lead, Terra may invoke Astra as a **read-only escalation advisor**. Advisory consultation is not a Mission Lead transfer and does not grant Astra branch, writer, integration or merge ownership. Terra remains responsible for the active lane and resumes it after the consultation.

Use Astra advisory escalation for technical, architecture or integration diagnosis when one or more of these materially applies:

- the same root-cause seam survives two bounded repair attempts;
- successive substantive review findings recur around the same abstraction seam;
- evidence leaves it materially unclear whether the repair belongs in implementation, tests/evidence, host/runtime composition or repository architecture;
- a proposed repair crosses subsystem boundaries or risks storage, identity, revision/recovery, security or data-integrity behavior;
- two or more materially different and costly repair directions remain plausible without evidence clearly selecting one; or
- an applicable convergence process has explicitly classified the loop AMBER/HOLD, or the loop is otherwise structurally non-convergent.

Ordinary compile errors, isolated test failures and locally obvious bugs are not escalation triggers by themselves. Difficulty alone is not authority to renegotiate acceptance.

Before consultation, Terra records a recoverable checkpoint with exact active HEAD, checked live `main`, current evidence, relevant authority, bounded repairs already attempted and one concrete question. All affected mutation pauses while the advisory question is unresolved; unrelated qualified work may continue. Resolve the actual installed Astra configuration from global agent configuration rather than guessing a path or silently substituting another advisor.

Astra may inspect the live Issue/PR, diff, tests/evidence and relevant authority and return diagnosis, risks and a bounded recommendation. Astra remains read-only for the escalated lane and may not change product scope, acceptance outcomes, Accepted semantic/storage/authorization authority, writer ownership or merge state. If resolving the blocker requires any such material change, route it to ChatGPT Steward. The advisory result should be linked or summarized in the owning Issue/PR handoff before Terra resumes affected mutation.

Astra consultation does not satisfy independent final review. Final Guarded merge still requires the fresh independent exact-head review required below; current global configuration may route that role to the installed Sol reviewer, but reviewer independence and exact-head evidence are the durable requirement.

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
- the final reviewer authored neither the implementation nor its acceptance/evidence and was not merely the earlier finding author re-approving their own fix;
- normal GitHub protections and review requirements permit the merge, without admin bypass, force push, fabricated approval or blanket auto-approve;
- the recorded head still matches immediately before merging.

Execution of a reviewed merge by the coordinator is not independent approval. Lead-authored code still needs another reviewer. After merging, verify the integrated main at the affected boundary, reconcile any surviving review debt, update #2 and continue. Closing a child never closes #1. Final product/release acceptance and permission to close #1 remain founder/Steward-owned. No automatic publication, purchases, signing-account enrollment, credential provisioning or terms acceptance follows from PR merge authority.

## Upstream boundary

Core work stays in tachiko-work. #359 and #361 retain producer/I/O and delegated-bridge ownership; #315–#319/#330 and then-live successors retain their own semantics. Sheet may inspect, reproduce and prepare bounded upstream work, but production/Ready/merge there needs upstream live authority. In particular #331/#351 and their owners are not taken over. Sheet #1 cannot override an upstream no-self-merge or acceptance gate.

## Continuation and stop

Use #2 for one concise recoverable checkpoint; detailed evidence belongs to the active PR. Wait on nonterminal work using event/blocking waits or at least 180-second polling. Stop affected mutation for a concrete missing authority/acceptance, unresolved substantive finding or external permission; continue genuinely independent qualified work. Persist work before runtime termination. No scheduler is installed by this policy.

One-time exception: this previously empty public repository is initialized with founder-authorized Mission, documentation and agent entry files by ChatGPT. This is not a production merge, independent review claim or precedent for direct-to-main product development. Subsequent production and policy changes use reviewed PRs.
