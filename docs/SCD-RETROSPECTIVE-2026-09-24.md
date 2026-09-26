# SCD retrospective — 2026-09-24 seven-hour run

Status: **historical evidence and operating lessons, not current authority**.

This retrospective summarizes one long Tachiko Sheet SCD run. It intentionally does **not** include the raw private/session transcript, hidden reasoning, local artifact dumps, credentials, or a command-by-command diary. Current work still starts from live #1, #2, `docs/DELIVERY.md`, the owning Issue/PR and relevant upstream authority.

## What the run demonstrated

The run showed that a serial Sol → Luna → independent-review delivery loop can continue for hours without depending on one model context:

- a review transport failure was kept separate from review verdict;
- blocking findings invalidated a Final Candidate instead of being patched around;
- Luna handled bounded repairs and focused verification;
- repaired heads were requalified before fresh review;
- qualified PRs merged through normal protections;
- after merge, Sol reread live state and continued into the next Ready lane;
- read-only mapping/probes were used without self-promoting source work to Ready;
- when a native/host contract lacked acceptance authority, the lane stopped instead of inventing implementation;
- context compaction did not break continuity because durable GitHub state carried the mission.

The same run progressed across governance closeout, a second governance lane, read-only architecture mapping, one mechanical test repair, and native-consumer qualification before reaching a genuine no-Ready STOP.

## What was worth the scarce Sol budget

Sol attention was most valuable for:

- Ready/HOLD/STOP and ownership decisions;
- acceptance/authority interpretation;
- repair-batch disposition after review findings;
- cross-boundary architecture decisions and Astra consultation;
- exact-diff integration readback at material checkpoints;
- choosing the next serial successor after merge;
- deciding when evidence was insufficient to start production.

These are judgment tasks. They should stay with the Mission Lead.

## What should normally move away from Sol

### Luna

Delegate bounded, already-decided work such as:

- implementation and mechanical repair;
- focused regression authoring;
- test portability fixes;
- browser/fixture reproduction after the expected outcome is fixed;
- small documentation corrections after findings are classified;
- coherent repair batches with explicit file/scope ownership.

A Luna handback is evidence, not integration approval.

### Deterministic automation

Prefer scripts/git/compiler/tests/CI for:

- exact HEAD/base and clean-worktree checks;
- changed-path and overlap inventory;
- required-check status;
- unresolved-thread inventory;
- Final Candidate invalidation on material HEAD movement;
- preparation of bounded diff/file packets;
- post-merge tree/readback verification;
- no-op waiting and event-driven status observation;
- detecting that no candidate state changed before another expensive review.

Model reasoning should consume these facts, not rediscover them.

## Review-loop lessons

1. **Transport failure is not review failure and never review PASS.** If submission or response transport fails before a recoverable verdict exists, retry the transport only; do not mutate the candidate or infer a finding.
2. **Review only stable candidates.** Finish deterministic/hosted gates and freeze the exact HEAD before scarce semantic review.
3. **Collect the complete finding set.** Invalidated candidates go through one coherent repair batch; do not use Oracle as a one-bug-at-a-time linter.
4. **Repeated finding family means root-cause checkpoint.** Two repair passes in the same family trigger diagnosis before another high-cost review.
5. **A completed model response is required.** Streaming/model-selection/elapsed time is not a verdict.
6. **Changed HEAD means new receipt.** Prior candidate-bound approval does not transfer.

## Waiting lessons

Waiting consumed wall-clock time but did not need continuous frontier-model attention.

Preferred behavior:

- use event/blocking waits;
- do not rerun green suites while nothing changed;
- keep the candidate immutable during final review;
- use waiting time only for non-mutating work that cannot create a competing writer or invalidate reviewer independence;
- do not start a duplicate Oracle session because one is slow;
- if no other Ready production lane exists, STOP truthfully.

## Context and handoff lessons

A fresh Mission Lead does not need the seven-hour transcript.

Use a compact **Work Contract in / Evidence Packet out** pattern:

**Work Contract**
- authority links;
- exact base/HEAD;
- bounded goal and invariants;
- acceptance/gates;
- allowed write surface;
- escalation conditions.

**Evidence Packet**
- exact resulting HEAD;
- diff/scope summary;
- deterministic checks actually run;
- unresolved findings/limitations;
- reviewer receipt when applicable;
- next recoverable action.

Detailed session traces are forensic evidence only. #2 stays a concise recoverable snapshot.

## Oracle routing lesson

The browser-backed Oracle path worked as a reviewer but exposed avoidable transport and waiting friction. Sheet therefore uses the already-qualified **ego-lite → Oracle** route as the default execution transport.

Transport choice does not change review authority:

- Oracle remains independent, read-only and exact-HEAD-bound;
- requested/effective model and reasoning effort must be verified fail-closed before credit;
- transport/session failure gives no review credit;
- the terminal clean verdict remains `No blocking findings.`;
- material HEAD movement invalidates the receipt.

Reviewer effort is risk-tiered after deterministic gates:

- ordinary material final review: GPT-5.6 Sol **High** by default;
- explicitly high/critical review: **Extra High** only when the owning Issue/lead records the risk reason;
- architecture/product judgment uses the separate Astra/Pro/Opus consultation rules, not an implicit stronger Oracle fallback.

ego-lite is transport/configuration, not workflow-domain authority.

## Follow-up opportunities

The next efficiency gains should come from evidence rather than more orchestration layers:

1. deterministic Final Candidate/premerge reconciliation;
2. bounded review-packet construction from exact Git state;
3. durable review-receipt parsing and stale-HEAD invalidation;
4. event-driven waiting instead of lead polling;
5. compact Ready-candidate inventory derived from live Issues/PR ownership;
6. measurement of lead time and scarce reviewer calls per merged capability.

Do not optimize away correctness gates. Optimize the amount of frontier-model attention required to satisfy them.

## Historical pointers

- Issue #84 / PR #85 — SCD playbook closeout.
- Issue #103 / PR #104 — on-demand SCD delivery Skill.
- Issue #100 — read-only thin-client Stage A mapping.
- Issue #94 / PR #95 — bounded mechanical test repair while design authority remained blocked.
- Issue #49 — native consumer probe, Astra consultation and acceptance-adequacy stop.
- Issue #109 — this retrospective and ego-lite routing update.

For current state, return to live #1, #2 and the active owning Issue/PR.