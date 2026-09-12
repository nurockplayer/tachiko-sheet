#!/usr/bin/env bash
set -euo pipefail

readonly source_checkout="/Users/tachikoma/.codex/worktrees/sheet-core-8bba"
readonly source_revision="8bba9b09cea3c011df383216ba3846ccd003dece"
readonly probe_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly tracked_input="apps/designer/experimental-client-kit/README.md"

materialize() {
  local destination="$1"
  mkdir -p "${destination}"
  git -C "${source_checkout}" archive --format=tar "${source_revision}" | tar -xf - -C "${destination}"
}

tree_digest() {
  (
    cd "$1"
    find . -type f -print0 | LC_ALL=C sort -z |
      while IFS= read -r -d '' item; do shasum -a 256 "${item}"; done |
      shasum -a 256 | awk '{print $1}'
  )
}

readonly original_head_before="$(git -C "${source_checkout}" rev-parse HEAD)"
[[ "${original_head_before}" == "${source_revision}" ]]

# Seed only the disposable Cargo home so offline compilation may reuse cached
# registry contents without writing any producer checkout or user Cargo state.
mkdir -p "${probe_root}/cargo-home/registry"
cp -a /Users/tachikoma/.cargo/registry/. "${probe_root}/cargo-home/registry/"
materialize "${probe_root}/baseline-source"
materialize "${probe_root}/delta-source"

# Exact one-line change to a tracked packaging input copied verbatim by the
# real exporter after it runs pnpm, TypeScript, Rust and WASM build steps.
printf '\n<!-- issue-359-probe-sentinel -->\n' >> "${probe_root}/delta-source/${tracked_input}"

run_export() {
  local source_dir="$1"
  local kit_dir="$2"
  (
    cd "${source_dir}"
    export CARGO_HOME="${probe_root}/cargo-home"
    export CARGO_NET_OFFLINE=true
    export XDG_CACHE_HOME="${probe_root}/xdg-cache"
    bash scripts/export-experimental-designer-client.sh "${kit_dir}"
  )
}

run_export "${probe_root}/baseline-source" "${probe_root}/baseline-kit"
run_export "${probe_root}/delta-source" "${probe_root}/delta-kit"

{
  printf 'source_revision=%s\n' "${source_revision}"
  printf 'original_head_before=%s\n' "${original_head_before}"
  printf 'original_head_after=%s\n' "$(git -C "${source_checkout}" rev-parse HEAD)"
  printf 'tracked_input=%s\n' "${tracked_input}"
  printf 'baseline_input_sha256=%s\n' "$(shasum -a 256 "${probe_root}/baseline-source/${tracked_input}" | awk '{print $1}')"
  printf 'delta_input_sha256=%s\n' "$(shasum -a 256 "${probe_root}/delta-source/${tracked_input}" | awk '{print $1}')"
  printf 'baseline_tree_sha256=%s\n' "$(tree_digest "${probe_root}/baseline-kit")"
  printf 'delta_tree_sha256=%s\n' "$(tree_digest "${probe_root}/delta-kit")"
  printf 'baseline_readme_sha256=%s\n' "$(shasum -a 256 "${probe_root}/baseline-kit/README.md" | awk '{print $1}')"
  printf 'delta_readme_sha256=%s\n' "$(shasum -a 256 "${probe_root}/delta-kit/README.md" | awk '{print $1}')"
  printf 'baseline_wasm_sha256=%s\n' "$(shasum -a 256 "${probe_root}/baseline-kit/designer_runtime.wasm" | awk '{print $1}')"
  printf 'delta_wasm_sha256=%s\n' "$(shasum -a 256 "${probe_root}/delta-kit/designer_runtime.wasm" | awk '{print $1}')"
  printf 'baseline_file_count=%s\n' "$(find "${probe_root}/baseline-kit" -type f | wc -l | tr -d ' ')"
  printf 'delta_file_count=%s\n' "$(find "${probe_root}/delta-kit" -type f | wc -l | tr -d ' ')"
} | tee "${probe_root}/result.env"

cmp "${probe_root}/baseline-kit/README.md" "${probe_root}/delta-kit/README.md" >/dev/null && exit 1
[[ "$(git -C "${source_checkout}" rev-parse HEAD)" == "${source_revision}" ]]
printf 'PASS: the real exporter propagated the changed tracked packaging input while original source HEAD remained pinned.\n'
