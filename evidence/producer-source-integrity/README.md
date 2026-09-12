# Producer source-integrity probe record

This directory preserves one historical, environment-specific probe of the
experimental Designer kit exporter at source revision
`8bba9b09cea3c011df383216ba3846ccd003dece`. It is evidence of a real
live-source contamination risk, not a current artifact manifest and not a
claim that an existing manifest records a false source SHA.

The recorded probe materialized two disposable source archives. It appended one
sentinel line only to the copied
`apps/designer/experimental-client-kit/README.md`, then ran the real exporter
for both copies. `result.env` records that the changed copied input SHA-256 and
the exported README SHA-256 are equal, while the baseline input and baseline
exported README SHA-256 are equal to each other. `run-final.log` records the
two successful real JS/TypeScript/Rust/WASM exports. The original detached
source checkout remained at the pinned revision according to the record.

The two recorded WASM hashes differ. That build variability prevents a
determinism conclusion. The evidence here is the direct input/exported README
digest relationship plus successful real builds, not the script's `PASS` line
alone.

## Preserved historical files

- `run-probe.sh` is copied byte-for-byte from the successful retry.
- `result.env` and `run-final.log` are its recorded output.
- `initial-infrastructure-run.log` is the earlier offline cache failure, kept
  to distinguish setup failure from the successful retry.

The script uses absolute local source and Cargo-cache paths. Those paths are
environment-specific and must be inspected before any rerun. It derives its
output directory from its own location and creates source copies, caches, and
exported artifacts underneath that directory. **Do not run it in this checkout.**
To reproduce in a fresh disposable location:

```sh
probe_dir=$(mktemp -d /tmp/tachiko-sheet-359-probe.XXXXXX)
cp evidence/producer-source-integrity/run-probe.sh "$probe_dir/run-probe.sh"
bash "$probe_dir/run-probe.sh"
```

This command may perform expensive offline builds and depends on the recorded
local source/cache layout. It is not a hardened acceptance test: in particular,
its `cmp` difference check treats nonzero status as a difference and should not
be promoted unchanged into a pass/fail gate. The current evidence makes no
claim about a source-commit manifest because the qualified kit has no such
manifest.
