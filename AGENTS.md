# Tachiko Sheet agent entry

This operating mode is **Stewarded Continuous Delivery (SCD)**. Follow
[`docs/DELIVERY.md`](docs/DELIVERY.md) for Sheet-local authority; the shared name
does not replace its existing role, Ready, acceptance, review or merge rules.

Read the live **#1 body**, **#2 body**, `docs/DELIVERY.md`, and the active Issue/PR. Use `docs/UPSTREAM.md` to read relevant live core authority. #1 is Mission; #2 is the single current handoff, replaced in place. Do not mine #1 comments for current state. Read `docs/PRODUCT-PRINCIPLES.md` once at intake; `docs/MVP-EXECUTION.md` is the compact queue/gate map, not an instruction to reload every research source each loop.

There is one Mission Lead and integrator. The founder may select Astra or Terra under the reviewed DELIVERY.md amendment; before that amendment merges, the existing Astra-only delegation remains. Claim/transfer ownership in #2 and confirm prior writers stopped before changing leaders. Preserve one writer per worktree/branch and coordinate shared-file ownership.

When **Astra** is the Mission Lead, #2 may choose Fast mode for the current tactical window. Astra keeps architecture, planning, shared integration, evidence-based Ready and acceptance-conformance judgment, and final integration within `docs/DELIVERY.md`. Missing or contradictory acceptance and material changes to acceptance outcomes go to ChatGPT Steward; Astra may identify and escalate them, but may not author, reinterpret or waive their resolution. Delegate clear bounded implementation/test packages to the installed global **`terra-worker`** profile; resolve its actual configured path from the installed global agent configuration rather than inventing a path if it is not present at the conventional agents location. After implementation, use `~/.codex/agents/sol-reviewer.toml` for independent review. The implementation worker must not review its own work. If terra-worker is unavailable, record that fact in #2 and continue other eligible work instead of silently substituting a different worker policy.

Own the finished spreadsheet experience, not only passing component tests. Existing Designer code is runtime/interop evidence, never the new UI design baseline. Brief means auxiliary Sheet notes/reporting, not a full Docs client. The first three-row fixture is a canary, not Mission completion.

Continue the qualified delivery loop across child Issues and PRs. There is no unconditional preflight-stop or ask-the-founder-between-tickets rule. Conditional readiness and Sheet-local merge authority are defined in `docs/DELIVERY.md`; upstream authority is separate. Do not author your own independent approval, weaken acceptance, bypass protections or force-push.

Prefer event/blocking waits. If polling is necessary, wait at least **180 seconds** between unchanged status checks. Do not rescan the repo or rerun full tests merely to wait. Run focused checks in the inner loop, affected regression at integration, and full/platform checks at the appropriate gate. Repeated failure without new information calls for diagnosis, not blind reruns.

At material stages, and at least once per active hour when meaningful durable work exists, update #2 and the owning PR evidence with exact refs, active writer, actual checks, unresolved findings and next action. Pending CI/review/worker is not completion. Before a run ends, preserve recoverable Git work; an Issue is not a scheduler or automatic wake-up mechanism.

Use pnpm for JavaScript dependencies, explicit packageManager and a real lockfile. Do not add install lifecycle scripts, incidental toolchain migrations, secrets, remote fonts, telemetry or provider calls. Follow the installed frontend taste skill when available, adapted to dense spreadsheet ergonomics, not a landing page.

Never implement canonical state, formula/validation, semantic revision, storage codec or approval policy in frontend state. Never confuse semantic publication with durable Save or external effects. Report only checks actually run. Keep known data-integrity/security and substantive review findings blocking, including still-valid debt from merged code.
