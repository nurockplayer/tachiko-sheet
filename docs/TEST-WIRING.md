# Test-only wiring contracts

Extracted unchanged from the original Steward acceptance guide at `f264ead7a8286b0de337792b118055f13aa2c83d`. C1/M1/M2 refer to test groups, not a second Mission or dispatch policy. Follow the live Sheet DELIVERY.md for readiness; these descriptions do not override it. Brief is auxiliary Sheet notes/reporting.

## M1 integration wiring contract (test-only)

The UI test language is English; fixture notes/titles are CJK. Stable test markers
identify semantic targets rather than DOM layout or React internals:

- `open-project`: normal directory file input; `project-ready`: real open complete.
- `cell:{entity}:{field}`: rendered Table value (focusable editable grid cell where
  applicable); `brief:{entity}:{field}`: rendered linked Brief fact.
- Each rendered fact carries opaque `data-work-occurrence`, `data-work-revision`,
  `data-work-entity`, `data-work-currentness`. These are observations, not permission.
- Table and Brief tabs; the labeled Edit cell and Decision notes text controls;
  Apply notes, Save a copy, Copy name, Create copy, Close project controls.
- Save status “Saved on this device” only after host commit; operation outcome
  “Outcome unknown” during the injected ambiguous-publication scenario.
- Unsaved work dialog with Keep editing; saved sample action Open saved review-copy.

Use accessible roles and names. Mechanical locator repairs can follow governance;
removing scenarios, changing expected values or replacing a real boundary cannot.
Tabs express the contracted view-switch action, not a required pixel layout.

The reviewed test build provides `window.__tachikoAcceptance`:

`observe()` returns deterministic {occurrence, revision, entity, impact, priority,
notes, canonicalHash} from the actual production runtime and explicit debug
snapshot/codec boundary, not the projection cache or fixture constants.
`savedHash(name)` reads actual durable saved bytes, returning null if absent.
`failNextSave()` fails the next real host save before commit. It must not supply
replacement semantic data. `loseNextExecuteReply()` loses a response only after
real dispatch; `executeRequestCount()` observes the real transport.
`settleFaultWindow()` waits for that bounded failure/recovery experiment, not an
arbitrary sleep or a test-triggered retry. `saveObservation()` and
`unknownObservation()` must read the actual rendered status/currentness, not set
outcome fields. `lastReceipt()` observes the last actual trusted execution receipt;
it must not fabricate delegated provenance or successful publication. No hook may publish semantic state, substitute calculation
results, approve a proposal, fabricate receipts or directly set product success.

The driver is delivery-owned mechanical wiring subject to independent review.
Test hooks must be absent from the distributable build. Observation snapshots are
allowed at this explicit debug boundary; ordinary product editing still uses
bounded queries. Do not convert test driver names into a stable public API.

## M2 driver contract (test-only)

`createDriver({fixture})` creates a fresh real runtime and trusted authorization
domain per case. `observe()` is a Human-authorized deterministic query/debug
snapshot, including canonical hash, revision and the tested current values.
`propose`, `preview`, `execute` act through a Delegated occurrence. `approveAsHuman`
is a separate trusted Human action, not renderer-supplied `approved:true`.
`editAsHuman`, `revokeDelegatedAuthority`, `revokeQueryAuthority`, `reopenFixture`
exercise the genuine owner boundaries; `executeAltered` tests rejected tampering.
`externalEffectCount` observes attempted host effects. `close` cleans up every case.

The driver normalizes result categories to published/denied/etc only for tests;
it cannot normalize a real successful mutation into denial. `preview` after Query
revocation returns disclosure-safe denial with empty disclosedSubjects/Values.
Broader owner-crate tests must also audit indirect leaks through messages/metadata.

## C1 artifact/storage wiring (test-only)

`artifact-manifest.json` declares sourceRepository, exact sourceCommit, experimental
stability, the public experimental entry, required asset paths with SHA-256 digests,
and licenseNotices paths. All kit files except the manifest are declared exactly
once; no symbolic links, traversal or undeclared asset is accepted. This packaging
manifest is provisional and does not stabilize a client SDK or wire protocol.

The storage `createDriver({fixture})` creates a real consumer/core occurrence.
`editImpact`, `editNotes`, `exportCanonicalTree`, `exportRo`, and
`verifyRoUsingCore` must call the real semantic/storage boundaries.
`reopenCanonicalWithOldPresentationCache` starts a fresh occurrence with the supplied
canonical tree while retaining the old disposable view cache. `tryOpenCanonical`
exercises the production admission/replacement boundary; rejection preserves the
previous work. `observe` uses the actual core and `close` releases the host.
The test edits exported fixture bytes only to independently challenge persistence;
that is not permission for the production frontend to parse or mutate the format.
