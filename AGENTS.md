# Tachiko Sheet agent entry

This operating mode is **Stewarded Continuous Delivery (SCD)**. Follow
[`docs/DELIVERY.md`](docs/DELIVERY.md) for Sheet-local authority; the shared name
does not replace its existing role, Ready, acceptance, review or merge rules.

## Product context

At fresh intake, read the upstream [Mission](https://github.com/nurockplayer/tachiko-work/blob/main/docs/vision/mission.md), its [Constitution](https://github.com/nurockplayer/tachiko-work/blob/main/docs/vision/product-constitution.md) when purpose or scope is at issue, and [Work #486](https://github.com/nurockplayer/tachiko-work/issues/486) for the founder's clarification. Sheet is the first major client serving that mission, not a replacement mission or the boundary of Work. Revisit this context when changing target users, client boundaries, release claims or priorities, not on every unchanged loop. Handoffs are pointers plus new information; routine tasks need no extra mission checklist.

## Current authority and routing

Read live [#1](https://github.com/nurockplayer/tachiko-sheet/issues/1), [#2](https://github.com/nurockplayer/tachiko-sheet/issues/2), `docs/DELIVERY.md`, and the active Issue/PR. Use `docs/UPSTREAM.md` for relevant core authority. #1 owns the product Mission; #2 holds the current handoff and explicit founder routing records. Read `docs/PRODUCT-PRINCIPLES.md` once at intake and use `docs/MVP-EXECUTION.md` as the compact execution map.

Resolve lead, implementer, reviewer model/effort and transport from the latest **explicit, scoped founder directive** in those live records. It supersedes older conflicting mappings only within its scope; ordinary status notes and a successful test do not change policy. Do not restore historical Sol/Luna/Oracle mappings simply because they remain in an older document. This entry grants no new reviewer fallback, gate exemption or ownership transfer.

There is one Mission Lead/integrator, with bounded implementation workers. Preserve one writer per worktree/overlapping surface and the live lane's serialization rules. Before a transfer, record it in #2 and confirm the prior writer has stopped or explicitly handed off. The lead records material decisions and review-finding dispositions on the owning Issue/PR and may proceed inside existing authority without a routine permission loop. Unsettled product, semantic, storage, security or acceptance choices return to their owner.

Before freezing a material decision or assigning implementation, follow applicable consultation/escalation requirements in live #1/#2 and `docs/DELIVERY.md`, as amended by explicit founder directives. Advisors do not acquire source, integration or approval ownership by being consulted. Record the actual advice and lead disposition; an unavailable required consultation remains a named blocker, not an invented answer.

At a stable Final Candidate, run applicable deterministic/hosted gates and obtain the required fresh, independent, read-only exact-HEAD review. The reviewer must not have authored or materially participated in the candidate's design, implementation or acceptance/evidence preparation. Follow the live authorized reviewer/provenance route; never label self-review or consultation as the required independent review. Verify supported identity/effort evidence and disclose missing or contradictory evidence under the applicable policy; no unrun PASS. Required merge verdict is `No blocking findings.` Material changes invalidate the affected review receipt. Only the lead/integrator performs normal protected integration after all applicable gates and review obligations pass.

Record meaningful stages and actual results on the owning Issue/PR; keep #2 recoverable and concise. Preserve exact candidate refs, known findings and remaining gates. Do not spam per-command checkpoints.

For active implementation, repair, validation, Final Candidate, or resume work,
use the repository-local `$tachiko-sheet-scd-delivery` Skill. It owns the
repeatable inner-loop / repair-batch / Final Candidate procedure, wait behavior,
durable checkpoint cadence, and runtime-continuity steps.

The Skill is operational guidance only. Live #1/#2, `docs/DELIVERY.md`, the
owning Issue/PR, and relevant upstream authority remain superior.

Own the finished spreadsheet experience, not only passing component tests. Existing Designer code is runtime/interop evidence, never the new UI design baseline. Brief means auxiliary Sheet notes/reporting, not a full Docs client. The first three-row fixture is a canary, not Mission completion.

Continue the qualified delivery loop across child Issues and PRs. There is no unconditional preflight-stop or ask-the-founder-between-tickets rule. Conditional readiness and Sheet-local merge authority are defined in `docs/DELIVERY.md`; upstream authority is separate. Do not author your own independent approval, weaken acceptance, bypass protections or force-push.

Use pnpm for JavaScript dependencies, explicit packageManager and a real lockfile. Do not add install lifecycle scripts, incidental toolchain migrations, secrets, remote fonts, telemetry or provider calls. Follow the installed frontend taste skill when available, adapted to dense spreadsheet ergonomics, not a landing page.

Never implement canonical state, formula/validation, semantic revision, storage codec or approval policy in frontend state. Never confuse semantic publication with durable Save or external effects. Report only checks actually run. Keep known data-integrity/security and substantive review findings blocking, including still-valid debt from merged code.

## Architecture and code-quality reference

For architecture-related work, read [`docs/architecture/README.md`](docs/architecture/README.md), [`clean-code.md`](docs/architecture/clean-code.md), and [`terra-playbook.md`](docs/architecture/terra-playbook.md), tracked in [#33](https://github.com/nurockplayer/tachiko-sheet/issues/33). Respect their proposal/adoption status. They describe Sheet-local boundaries and bounded migration, not a blanket source-refactor dispatch or Ready decision. Follow the current scoped consultation and independent-review route above; active writer ownership and unresolved product/acceptance HOLDs remain binding. Read the relevant sections at intake or a material architecture change, not every unchanged heartbeat.
