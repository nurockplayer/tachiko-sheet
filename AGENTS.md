# Tachiko Sheet agent entry

This operating mode is **Stewarded Continuous Delivery (SCD)**. Follow
[`docs/DELIVERY.md`](docs/DELIVERY.md) for Sheet-local authority; the shared name
does not replace its existing role, Ready, acceptance, review or merge rules.

Read the live **#1 body**, **#2 body**, `docs/DELIVERY.md`, and the active Issue/PR. Use `docs/UPSTREAM.md` to read relevant live core authority. A fresh independent exact-HEAD **Oracle latest Extra High** review is required at each Final Candidate. #1 is Mission; #2 is the single current handoff, replaced in place. Do not mine #1 comments for current state. Read `docs/PRODUCT-PRINCIPLES.md` once at intake; `docs/MVP-EXECUTION.md` is the compact queue/gate map, not an instruction to reload every research source each loop.

There is one Mission Lead and integrator. The founder records **GPT-6 Sol** as the active Mission Lead in #2 after the #77 transition is merged. Sol is the highest engineering decision authority inside already-settled product, semantic, storage and acceptance boundaries. **GPT-6 Luna** carries one bounded implementation/unit-test package at a time. Claim/transfer ownership in #2 and confirm prior writers stopped before changing leaders. Preserve one writer per worktree/branch and serial production implementation.

Sol records material engineering choices, repair directions and substantive review-finding dispositions in the owning Issue/PR. A useful decision entry states the problem, chosen approach, key rationale/tradeoff, important rejected alternative when relevant, and rollback path when material. Reporting is traceability, not an approval gate; Sol may proceed on decisions already inside its authority. Workers return any new product/architecture/semantic/storage/security/data-integrity/acceptance choice to Sol instead of improvising.

For genuinely difficult problems, high-risk architecture or unclear cross-boundary engineering choices, Sol may consult **Astra** as a bounded read-only advisor. Astra does not become a writer, Mission Lead, integrator or merge owner. Sol records the relevant advice and its own final disposition; Sol remains the final engineering decision-maker. Product scope, Accepted semantics/storage/authorization authority, Steward acceptance outcomes, Ready/HOLD conflicts and founder/external gates remain outside ordinary engineering discretion and return to ChatGPT Steward/founder as applicable.

At a stable Final Candidate, use one eligible fresh independent **Oracle latest Extra High** exact-HEAD review. Oracle is read-only and must be independent of the candidate's design, implementation and acceptance/evidence preparation. Required merge verdict is `No blocking findings.` A material commit after review invalidates the receipt. After all exact-head gates and the Oracle receipt pass, Sol/Conductor performs the protected merge.

At meaningful stages record durable GitHub checkpoints on the owning Issue/PR: INTAKE, PLAN/DECISION, IMPLEMENTED, VALIDATED, `FINAL_CANDIDATE <sha>`, ORACLE REVIEW, and MERGED/BLOCKED/HANDOFF. Keep #2 as the concise recoverable handoff. Do not spam per-command comments.

Use the following three-level SCD loop without weakening Ready, acceptance, reviewer-independence, exact-head or merge gates:

1. **Inner loop:** implementation and already-authorized mechanical repair may use granular local commits and focused local tests. Do not request fresh independent Oracle final review for a WIP head, and do not rerun full hosted gates merely because one small repair commit exists.
2. **Repair-batch checkpoint:** collect the complete currently known finding set and classify it together. Repair mechanical findings inside already-authorized bounds as one coherent batch; scope, durable-product, acceptance or authority conflicts return to ChatGPT Steward. Then run affected regression/integration checks and push at coherent checkpoint boundaries when practical. Do not manually request final review for intermediate WIP heads.
3. **Final Candidate:** record `FINAL_CANDIDATE <sha>` only when no known code mutation remains, no blocking finding or discretionary/Steward decision remains unresolved, applicable focused and affected-regression checks are green, and the PR is otherwise believed merge-ready. Only then run full applicable hosted gates and one fresh independent exact-HEAD review from an eligible fresh Oracle latest Extra High session. A material commit after that checkpoint invalidates Final Candidate status and requires the applicable exact-head gates and review again.

If final review fails, first collect the complete finding set, invalidate Final Candidate, classify once, complete one bounded repair batch and then establish a new Final Candidate. If the same defect/failure family survives two bounded repair batches, stop patching and perform a root-cause checkpoint before another high-cost final-review cycle. Keep #2 as a concise current handoff replaced in place; detailed and historical checkpoints belong in their owning Issue or PR.

Own the finished spreadsheet experience, not only passing component tests. Existing Designer code is runtime/interop evidence, never the new UI design baseline. Brief means auxiliary Sheet notes/reporting, not a full Docs client. The first three-row fixture is a canary, not Mission completion.

Continue the qualified delivery loop across child Issues and PRs. There is no unconditional preflight-stop or ask-the-founder-between-tickets rule. Conditional readiness and Sheet-local merge authority are defined in `docs/DELIVERY.md`; upstream authority is separate. Do not author your own independent approval, weaken acceptance, bypass protections or force-push.

Prefer event/blocking waits. If polling is necessary, wait at least **180 seconds** between unchanged status checks. Do not rescan the repo or rerun full tests merely to wait. Run focused checks in the inner loop, affected regression at integration, and full/platform checks at the appropriate gate. Repeated failure without new information calls for diagnosis, not blind reruns.

At material stages, and at least once per active hour when meaningful durable work exists, update #2 and the owning PR evidence with exact refs, active writer, actual checks, unresolved findings and next action. Include material decision records or durable links rather than leaving them only in ephemeral chat. Pending CI/review/worker is not completion. Before a run ends, preserve recoverable Git work; an Issue is not a scheduler or automatic wake-up mechanism.

Use pnpm for JavaScript dependencies, explicit packageManager and a real lockfile. Do not add install lifecycle scripts, incidental toolchain migrations, secrets, remote fonts, telemetry or provider calls. Follow the installed frontend taste skill when available, adapted to dense spreadsheet ergonomics, not a landing page.

Never implement canonical state, formula/validation, semantic revision, storage codec or approval policy in frontend state. Never confuse semantic publication with durable Save or external effects. Report only checks actually run. Keep known data-integrity/security and substantive review findings blocking, including still-valid debt from merged code.

## Architecture and code-quality reference

For architecture-related work, read [`docs/architecture/README.md`](docs/architecture/README.md), [`clean-code.md`](docs/architecture/clean-code.md), and [`terra-playbook.md`](docs/architecture/terra-playbook.md), tracked in [#33](https://github.com/nurockplayer/tachiko-sheet/issues/33). Respect their proposal/adoption status. They describe Sheet-local boundaries and bounded migration, not a blanket source-refactor dispatch or Ready decision. Existing authority, optional Astra consultation, independent Oracle final review, active writer ownership, and unresolved product/acceptance HOLDs remain unchanged. Read the relevant sections at intake or a material architecture change, not every unchanged heartbeat.
