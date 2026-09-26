# #118 fixed-pin save-closure acceptance seed

Preparation only; no product correction or Final Candidate. Steward authored the
user outcomes; independent adequacy is recorded on Sheet #118. Production is
HOLD while the existing PR114 serial lane remains unreleased. Parent #46 owns
product acceptance; #2 is the sole handoff. Preserve #116's explicit mode choice
for any future lane; this branch never transfers the existing lead/writer.

Baseline Sheet: `07b1d19fa1a78b73af8275beea73149f1084a0f1`.
Work producer: `518aaa55e046a4e4676b4d5e05d8189c4c6343fe`.
Manifest SHA256: `ae82d68592b73ac5da4f72fe9242833f2e9ba15e93480fac01d5d7751b86125b`.
Node qualification: 24.15.0; pnpm pin: 11.25.0. No new dependency or package script.

The frozen Date private fixture is an actual pinned producer export generated
by the first public-kit qualification (resident/0, source exactly date-only.csv).
It is retained for baseline-reader compatibility. The qualifier never rewrites
it. Reader setup inserts only this fixture on the isolated localhost test origin;
it is **not** ordinary Save success. Fixture hashes and provenance are in
`manifest.json`; normative outcomes are in `CONTRACT.md`.

Replay in an isolated checkout at the seed or future exact candidate, using the
existing dependency lock. Regenerate only CSV/XLSX source fixtures if required
(`python3 acceptance/web-save-closure/materialize.py`); do not regenerate the
frozen private reader fixture. Install/build/check with the pinned pnpm:

```sh
pnpm install --frozen-lockfile
pnpm verify:core-kit
pnpm build:acceptance
node acceptance/web-save-closure/prepare-adapter.mjs
SAVE_CLOSURE_DIST=dist-acceptance node acceptance/web-save-closure/serve.mjs
```

Use the already existing ego-browser TaskSpace for this goal, one page `p1`.
Pass its numeric ID explicitly; the service does not inherit shell variables.
Do not create another task space just for a suite. With the server running:

```sh
node acceptance/web-save-closure/run.mjs qualify-kit SPACE /absolute/kit-receipt.json
node acceptance/web-save-closure/run.mjs adapter SPACE /absolute/adapter-receipt.json
node acceptance/web-save-closure/run.mjs product SPACE /absolute/baseline-receipt.json http://127.0.0.1:4786 baseline
```

Baseline mode requires exactly A/B/C/C-empty behavioral RED and every existing
control PASS; it fails for any setup error or unexpected result. Future product
qualification MUST use `candidate` (the default). It fails unless **every** case
passes. Never cite a successful baseline-mode exit as product acceptance.
`prepare-adapter.mjs` erases types only from the exact checkout's production
adapter/contracts and records source hashes; it adds no alternate adapter logic.
The adapter suite uses real public Worker/WASM; only read replies are faulted.
These prerequisite receipts are not normal-UI Save proof.

A/B/C's after-correction assertions extend beyond the currently failing boundary.
They parse/load and their real-kit prerequisites qualify today; the entire
ordinary UI journey must pass on the final candidate. Baseline failure cannot
prove their future product results. A additionally checks exact source bytes,
expected metadata/ledger, actual producer metadata inspection and Date edits
through the unchanged reader. B/C compare occurrence/revision/currentness and
whole-core hash before refusal, including unrelated/empty Date; then Save and
fresh reopen must work. D separately tests each invalid label draft leaves the
applied rendered report unchanged, blocks Save, then verifies complete authored
report/source retention and duplicate-name no overwrite. E checks actual source
inspection limits and no Import dispatch/project publication. F's prior authored
report/source copy survives read-fault recovery. R qualifies the unchanged reader.

Before the eventual implementation starts, re-read #1/#2/#46/#118 and PR114,
reconcile source drift, retain independent adequacy against that boundary, and
record the serial release/transfer plus explicit lead mode and sole writer.
Required candidate gates remain the unchanged applicable typecheck/unit suite,
core-kit provenance, production build and hook-exclusion, canonical product and
M1 acceptance, existing J4/J5 unknown outcome/publication-recovery tests, affected
visual/accessibility regressions and hosted checks. Storage/reopen/compatibility
requires fresh deep independent review. At a stable Final Candidate obtain
verified ego-lite→Oracle latest Extra High, literal `No blocking findings.`;
neither acceptance author, implementer nor architecture adviser may be that
reviewer. No Oracle credit is claimed here.

After eligible merge, requalify the actual deployment through normal UI with
exact source/producer/manifest/build/deployment/origin bindings under #46. This
local acceptance origin is not the public deployment. No launch, physical
IME/AT/device, arbitrary resource/quota/crash/lost-ack or universal saveability
claim follows. Keep Work #374's Date+definition producer export gap separate;
no missing producer-owned seam has been demonstrated for this fixed-pin guard.
