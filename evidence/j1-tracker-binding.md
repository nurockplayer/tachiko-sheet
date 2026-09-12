# J1 native Tracker binding probe

Status: **CANDIDATE_BINDING_INSUFFICIENT**. This is a qualification probe, not
an original J1 acceptance run, a product PASS, or a claim about storage,
manifest, or UI completion.

## Purpose and command

The probe reads the fixed J1 input from
`acceptance/mvp-v1/scenarios.json` at runtime and invokes only the public
`experimental-client.js` entry in a local Chromium page:

```sh
WORK_CLIENT_KIT=/absolute/path/to/.qualification-kit \
  pnpm exec node tests/qualification/j1-tracker-binding.mjs
```

It writes the observed record to
`evidence/j1-tracker-binding.json`. The command needs the pinned
`playwright@1.62.1` dependency. It starts a loopback-only test server for the
complete supplied kit; the Worker and WASM therefore execute through the
public entry rather than through a private import or raw WASM call.

Before opening a browser, the probe checks the supplied
`experimental-client.js` and `designer_runtime.wasm` SHA-256 digests against
the qualified artifact inventory. Only a matching pair is attributed to
source commit `8bba9b09cea3c011df383216ba3846ccd003dece`. A different pair
writes a `BLOCKED` record and exits 78; it is not evidence for this pin.

## Actual result

The matching public runtime exposed `newTracker`, `trackerCommand`, and
`queryTable`. The test supplied the J1 names and numeric candidates only:
names go into native `task` and numbers into native `estimate`. It does **not**
send `Todo`/`Doing`/`Done` to the Boolean column, and therefore does not claim
that J1 Status was exercised.

The actual native schema was fixed to `task` (Text), `estimate` (Number), and
`done` (Boolean), with the Boolean dropdown limited to `true` and `false`.
The J1 accepted numeric candidate published with a changed opaque revision.
The fixed J1 rejected candidate `6` also published as a native `estimate`.
That is correct native Estimate behavior; it is insufficient evidence for
J1's required Priority range of 1 through 5. Mapping J1 Status to Boolean,
calling Estimate Priority, or adding frontend-only validation would change or
mask the required semantics.

The pinned source states that the stock Tracker has exactly these three fields
and does not provide custom enum or schema-rule authoring:
[Tracker profile](https://github.com/nurockplayer/tachiko-work/blob/8bba9b09cea3c011df383216ba3846ccd003dece/apps/designer/README.md#L92-L122).
Its product acceptance inventory likewise records Boolean-only dropdowns and
the absence of custom enum/range validation:
[driver profile](https://github.com/nurockplayer/tachiko-work/blob/8bba9b09cea3c011df383216ba3846ccd003dece/docs/product/driver-common-profile-acceptance.md#L54-L64).
The upstream semantic contract keeps typed commands on stable entity and field
identities, while its entity commands remain provisional:
[semantic API](https://github.com/nurockplayer/tachiko-work/blob/8bba9b09cea3c011df383216ba3846ccd003dece/docs/specs/semantic-api.md#L302-L338).

## Decision needed

ChatGPT Steward must decide whether J1 is re-accepted for the existing fixed
Tracker profile, or whether upstream supplies a qualified public schema/profile
whose Status enum is exactly `Todo`/`Doing`/`Done` and whose Priority constraint
enforces 1 through 5. Until one of those happens, this fixed J1 binding is
blocked; the native Tracker remains usable only as a bounded candidate runtime
observation.
