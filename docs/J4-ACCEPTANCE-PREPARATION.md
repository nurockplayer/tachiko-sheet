# J4 acceptance preparation — not a product result

Owner: Terra High under Sheet #20. This records the fixed acceptance-to-evidence
map before implementation; it neither changes `acceptance/mvp-v1` nor claims
J4 Ready or product PASS.

## Exact boundary

- Sheet base: `0e43cd16ed2aee987aab3090e30f3131a48e91ed`.
- Retained kit source: `518aaa55e046a4e4676b4d5e05d8189c4c6343fe`.
- Kit manifest: `ae82d68592b73ac5da4f72fe9242833f2e9ba15e93480fac01d5d7751b86125b`.
- Sheet-owned test/support fixture: the static canonical-v1 entries in
  `tests/qualification/j4-public-composition.mjs`, deterministic SHA-256
  `d8ab17b0bc84f89fbc996beb730f0842ec2bf848d1ab4afd315cc34fa1195d2b`.
  It directly materializes `Catalog(code, category, price)` and
  `Sales(product_code, quantity)` at the real core boundary. It is not a user
  table-creation capability, a transformed upstream artifact, or a codec.

The pinned public client exposes authoritative
`createKeyedGroupedSum(expectedRevision, definition)` and
`queryKeyedGroupedSum(definitionId)`. Its `exportProject` bytes are opaque
core output. Sheet must not parse, construct, normalize, or relabel those bytes.

## Fixed evidence map

| Required outcome | Product observation and oracle | Required final evidence |
| --- | --- | --- |
| Normal entry | User opens the Sheet-owned Catalog/Sales canary through normal Sheet Open, selects visible table/field names. | Browser trace; no IDs/JSON control. |
| Authoritative result | Core result is the group map `PEN=800`, `NOTE=1000` and its revision. Static line `600/1000/200` and total `1800` are fixture checker facts only. | Runtime/browser assertion reads the core group projection; no JavaScript aggregation. |
| Currentness | Edit `Catalog.PEN.price` from `200` to `250`; refresh the definition query. | Fresh core group map is `PEN=1000`, `NOTE=1000`; old `PEN=800` is non-current immediately. Static post-edit lines `750/1000/250` and total `2000` remain checker facts only. |
| Failure truth | Create missing-key and duplicate-key fixture states. | Core diagnostics exactly `lookup.missing_key` / `lookup.ambiguous_key`; no current partial groups. |
| Format-2 save/reopen | Store only the opaque core-produced project export in the local host, fully terminate, reopen through normal controls, query again. | Inspect the opaque transfer outside product code: non-`TWDPROJ2` magic, 19 files including `definitions.json`, `manifest.format = tachiko.roproj`, `format_version = 2`, stable bindings, and no evaluated-result cache truth. |
| Truthful unsupported exits | Request existing portable/canonical-v1 exits after definition creation. | Visible core refusal; no downgrade, strip, alternate codec, or portable-v2. |
| Normal interaction | New control focus/cancel/error/currentness states use existing Sheet semantics. | Keyboard/focus regression plus real CJK IME/accessibility walkthrough where controls change. |

## Current preparation finding

The existing Sheet host stores only `CanonicalTreeExport` via its local-copy
contract. That public path is canonical-v1 and therefore cannot represent a
definition-bearing format-2 project. The raw `exportProject` method exists, but
using its opaque result needs a bounded host contract and restart/open path; it
must not become a client codec. The current UI also has no normal J4 authoring
or result surface.

These are **UNVERIFIED implementation seams**, not behavioral RED and not an
authority contradiction. The prospective implementation is limited to a
human-readable binding/result surface plus opaque core-project host composition.
It may not change the core pin, J4 oracle, storage format, portable-v1 behavior,
or upstream ownership.

`pnpm exec node tests/qualification/j4-public-composition.mjs` is the required
real-core preparation probe. It verifies the source rows, schema/field types,
stable hidden bindings, initial groups, fixed currentness edit, duplicate and
missing diagnostics, and a fresh opaque `exportProject` reopen. It labels UI,
durable host restart, and real IME/accessibility as not yet tested.

## Readiness review question

Is this map concrete and adequate to authorize one bounded Sheet J4 production
slice, with the two documented seams implemented under the fixed oracle and
final exact-head gates? The reviewer must reject any plan that substitutes a
frontend evaluator, alternate codec, hidden fixture-only authoring, cached
result persistence, or a claimed portable-v1 exit.
