---
name: tachiko-sheet-scd-delivery
description: Run or resume Tachiko Sheet's active Stewarded Continuous Delivery loop, including repair batching, Final Candidate lifecycle, wait behavior, GitHub checkpoints, and recoverable handoff state. Use for active Sheet implementation, repair, validation, final-candidate, or resume work.
---

# Tachiko Sheet SCD Delivery

Use this Skill only while running or resuming an active Sheet SCD lane. It is an operating procedure, not a source of product, acceptance, Ready/HOLD, review, or merge authority.

Before acting, read the repository `AGENTS.md`, live #1 body, live #2 body, `../../../docs/DELIVERY.md`, the owning Issue/PR, and relevant live upstream authority. Those sources outrank this Skill.

## Three-level delivery loop

Use these levels without weakening Ready, acceptance, reviewer independence, exact-HEAD, or merge gates.

### 1. Inner loop

Implementation and already-authorized mechanical repair may use granular local commits and focused local tests.

Do not request a fresh independent Oracle final review for a WIP head. Do not rerun full hosted gates merely because one small repair commit exists.

### 2. Repair-batch checkpoint

Collect the complete currently known finding set and classify it together. Repair mechanical findings inside already-authorized bounds as one coherent batch.

Return scope, durable-product, acceptance, or authority conflicts to ChatGPT Steward. Then run affected regression/integration checks and push at coherent checkpoint boundaries when practical.

Do not manually request final review for intermediate WIP heads.

### 3. Final Candidate

Record `FINAL_CANDIDATE <sha>` only when:

- no known code mutation remains;
- no blocking finding or discretionary/Steward decision remains unresolved;
- applicable focused and affected-regression checks are green;
- the PR is otherwise believed merge-ready.

Only then run full applicable hosted gates and one fresh independent exact-HEAD **Oracle latest Extra High** review through the qualified **ego-lite → Oracle** transport. Run deterministic/hosted gates first and verify requested/effective model and **Extra High** effort fail-closed before review credit.

A material commit after that checkpoint invalidates Final Candidate status and requires the applicable exact-head gates and review again.

## Reviewer transport and effort

ego-lite is the default Oracle execution transport for Sheet. It does not change reviewer authority or merge gates.

- keep Oracle read-only, independent and exact-HEAD-bound;
- unknown model/effort provenance or transport/session failure gives no review credit;
- do not start a duplicate review merely because one is slow;
- a material HEAD change invalidates the candidate-bound receipt;
- GPT-6 Pro/Astra remain separate judgment/architecture consultation paths, not hidden Oracle fallbacks.
- ego-lite changes the transport path only; it does not lower the required Extra High review effort.

## Review failure and root-cause checkpoint

If final review fails:

1. collect the complete finding set;
2. invalidate Final Candidate;
3. classify the findings once;
4. complete one bounded repair batch;
5. establish a new Final Candidate only after applicable checks are green.

If the same defect/failure family survives two bounded repair batches, stop patching and perform a root-cause checkpoint before another high-cost final-review cycle.

Keep #2 as the concise current handoff replaced in place. Detailed and historical checkpoints belong in the owning Issue or PR.

## Waiting and runtime continuity

Prefer event/blocking waits. If polling is necessary, wait at least **180 seconds** between unchanged status checks.

Do not rescan the repository or rerun full tests merely to wait. Use focused checks in the inner loop, affected regression at integration, and full/platform checks at the appropriate gate. Repeated failure without new information calls for diagnosis, not blind reruns.

Pending CI, review, or worker activity is not completion.

Before a run ends, preserve recoverable Git work. An Issue is not a scheduler or automatic wake-up mechanism.

## Durable checkpoints

At material stages, and at least once per active hour when meaningful durable work exists, update #2 and the owning PR evidence with:

- exact refs;
- active writer;
- checks actually run and their real result;
- unresolved findings;
- next action;
- material decision records or durable links when applicable.

Do not leave material continuation state only in ephemeral chat.

## Discipline

The live #1/#2/DELIVERY/Issue/PR authority decides what may proceed. This Skill only defines how to execute an already-authorized delivery loop. It cannot create Ready state, waive Oracle independence, weaken evidence, change semantic/storage authority, or grant merge permission.
