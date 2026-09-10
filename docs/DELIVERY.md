# Continuous Mission delivery

Status: founder-authorized Sheet-local delivery policy, 2026-09-10, recorded by ChatGPT Steward under #1. It changes the old *client planning* dispatch limits, not Tachiko Work semantic authority or upstream delivery policy.

## Authority and roles

Upstream Product Constitution, foundational principles and relevant Accepted semantic/storage/authorization ADRs/specs constrain this client. Sheet #1 owns the finite product goal; this policy owns local dispatch; active children own their bounded implementation. Evidence is not architecture authority. Issue #2 is operational state only.

ChatGPT Steward owns product scope, specifications, acceptance outcomes and material acceptance decisions. Astra is delegated **Sheet delivery stewardship**: sequence work, verify evidence, record qualified Ready decisions, integrate and merge eligible Sheet PRs. This is not power to invent missing semantic contracts, change product goals, waive acceptance, or turn implementation-authored tests into independent acceptance. Other roles follow actual global configuration, not old repo-specific model mappings.

## Conditional Ready; no ceremonial stop

For each child Astra records, in that Issue, the exact baseline/seed/core-artifact refs, risk and write owner, acceptance-to-requirement map and actual qualification results. Ready requires:

1. The work is inside #1, with sufficient Accepted semantics and only bounded reversible client choices unresolved.
2. Steward-authored acceptance exists, its intended outcomes are preserved, and a reviewer independent of acceptance/production authorship has assessed adequacy for the concrete boundary.
3. Fixtures reach the real core boundary; required runtime/host/artifact prerequisites are actually available. Setup failures are not behavioral RED.
4. The child is coherent, independently reviewable and does not compete with a live writer/PR.
5. Applicable unit tests, integration checks, manual/platform evidence and merge gates are identified. An exception is explicit, narrow and does not waive another applicable class.

**Greenfield evidence plan:** before a UI exists, qualify its fixture and real kit, parse/load the test code and review the fixed user oracles. Record the absent UI as an unverified product seam, not a fake behavioral RED. This bounded preparation route permits implementation after the above independent assessment; final merge still requires the real browser journeys and applicable host evidence to pass. No mock success, skipped tests or setup-error RED substitutes for that final gate.

Once these conditions hold, Astra records Ready and continues, without an extra founder message merely to repeat permission. There is no mandatory stop after #3, a material checkpoint or a completed PR. Missing independent review, actual acceptance or durable authority remains a real blocker; work on independent eligible lanes can continue. Do not call every optional question a blocker.

## Acceptance ownership and changes

Preserve the imported test source/hash and existing expected outcomes. Implementers add unit tests and may repair disclosed mechanical wiring without changing scenario, oracle or boundary. Material changes, new missing acceptance and authority contradictions return to ChatGPT Steward. A reviewer cannot silently promote their preferred product design into scope. The initial seed does not cover every full-profile or macOS requirement; those need concrete acceptance, not an exemption inferred from the Mission.

## PR and merge authority

Use one coherent product slice per PR; acceptance and implementation normally share its eventual lane. Keep unqualified seed work off main. Do not split work into cosmetic micro-PRs or turn the full Mission into one giant PR. Independent lanes require non-overlapping ownership; at most three active implementation lanes unless a separately justified policy changes that bound.

For **tachiko-sheet only**, Astra may execute a merge when all of these are proven for the exact final material HEAD:

- live Issue, main, PR and overlap state have been rechecked;
- applicable Steward acceptance, implementer unit tests and required local/hosted checks passed; absent/pending CI is not green;
- all valid blocking findings are resolved, and an independent final-head review exists;
- storage, identity, revision/recovery, import/export, authorization/security, SDK/compatibility or CI/governance changes receive fresh deep independent review;
- the final reviewer authored neither the implementation nor its acceptance/evidence and was not merely the earlier finding author re-approving their own fix;
- normal GitHub protections and review requirements permit the merge, without admin bypass, force push, fabricated approval or blanket auto-approve;
- the recorded head still matches immediately before merging.

Execution of a reviewed merge by the coordinator is not independent approval. Astra-authored code still needs another reviewer. After merging, verify the integrated main at the affected boundary, reconcile any surviving review debt, update #2 and continue. Closing a child never closes #1. Final product/release acceptance and permission to close #1 remain founder/Steward-owned. No automatic publication, purchases, signing-account enrollment, credential provisioning or terms acceptance follows from PR merge authority.

## Upstream boundary

Core work stays in tachiko-work. #359 and #361 retain producer/I/O and delegated-bridge ownership; #315–#319/#330 and then-live successors retain their own semantics. Sheet may inspect, reproduce and prepare bounded upstream work, but production/Ready/merge there needs upstream live authority. In particular #331/#351 and their owners are not taken over. Sheet #1 cannot override an upstream no-self-merge or acceptance gate.

## Continuation and stop

Use #2 for one concise recoverable checkpoint; detailed evidence belongs to the active PR. Wait on nonterminal work using event/blocking waits or at least 180-second polling. Stop affected mutation for a concrete missing authority/acceptance, unresolved substantive finding or external permission; continue genuinely independent qualified work. Persist work before runtime termination. No scheduler is installed by this policy.

One-time exception: this previously empty public repository is initialized with founder-authorized Mission, documentation and agent entry files by ChatGPT. This is not a production merge, independent review claim or precedent for direct-to-main product development. Subsequent production and policy changes use reviewed PRs.
