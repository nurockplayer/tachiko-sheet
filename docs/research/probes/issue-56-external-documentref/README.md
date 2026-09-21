# Issue #56 — External DocumentRef UX probe

This is a disposable, static browser probe for `tachiko-sheet#56`. It is not
wired to the Sheet runtime, an external provider, Git, or an API. It therefore
does **not** create a `Document` model, connector framework, persisted cell
type, content store, checkpoint system, or product capability.

## Question and falsifier

The probe tests the smallest interaction proposed by the Issue: one Sheet row
opens one separately-lived document reference, shows its locator and observed
currentness, and gives the user an external-open action.

The automated check establishes these observable properties:

- the reference cell reveals a lightweight detail panel rather than an editor;
- a display-label rename does not change the target locator;
- a provider revision newer than the checkpoint is shown as **Stale**, never
  current;
- permission-denied and unavailable targets remain visible states; and
- recording a fixture checkpoint can only restore **Matched** after an
  observable provider revision exists.

This does **not** prove that ordinary users benefit. A real B result needs at
least one recorded user session that compares this flow with opening the
provider directly:

| Observation | Issue #56 result |
| --- | --- |
| Users ignore the reference and work equally well from the provider/Git checkpoint | A |
| Users discover/open the right resource from Sheet context and accept external authoring | B |
| Users repeatedly need provider-independent content identity/authority shared with Sheet/CLI/AI | C-pressure observed |

The fixture has no network or provider calls. Its “checkpoint” is intentionally
labelled a fixture receipt and explicitly says that no Git commit was created;
it validates disclosure behavior only, not provider or Git interoperability.

## Reproduce

From the repository root:

```sh
node tests/qualification/external-documentref-probe.mjs
```

This starts a local static server, uses the existing pinned Playwright package,
and exits non-zero on any failed assertion. It does not add a Playwright
test-runner layer.

For an inspectable manual run:

```sh
python3 -m http.server 4174 --directory docs/research/probes/issue-56-external-documentref
```

Then open `http://127.0.0.1:4174`.
