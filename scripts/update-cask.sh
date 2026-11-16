#!/bin/sh
# Points the Homebrew cask at one release. Changes only the version and sha256
# lines, so the reviewed caveats and zap paths stay as they are. Also moves the
# cask from the arm64-only DMG to the universal one and drops its arm64-only
# requirement; a cask already moved is left as it is. Only strictly newer
# SemVer versions are admitted; there is no rollback mode.
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: update-cask.sh <version> <sha256> <cask file>" >&2
  exit 2
fi
version=$1 sha256=$2 cask=$3

case "$version" in
  *[!0-9A-Za-z.+-]* | "") echo "update-cask: bad version: $version" >&2; exit 2 ;;
esac
if ! printf '%s\n' "$sha256" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "update-cask: bad sha256: $sha256" >&2
  exit 2
fi

# Compare before creating any output file. Numeric identifiers are compared as
# strings by length first, avoiding awk number precision limits.
LC_ALL=C awk -v requested="$version" '
function parse(v, parts, core, pre, ids, n, i, dash, number) {
  number = "(0|[1-9][0-9]*)"
  if (v !~ ("^" number "\\." number "\\." number "(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$")) return 0
  sub(/\+.*/, "", v) # Build metadata does not affect precedence.
  dash = index(v, "-")
  pre = dash ? substr(v, dash + 1) : ""
  core = dash ? substr(v, 1, dash - 1) : v
  split(core, parts, ".")
  parts[4] = pre
  n = split(pre, ids, ".")
  for (i = 1; i <= n; i++)
    if (ids[i] ~ /^[0-9]+$/ && length(ids[i]) > 1 && substr(ids[i], 1, 1) == "0") return 0
  return 1
}
function numeric(a, b) {
  if (length(a) != length(b)) return length(a) > length(b) ? 1 : -1
  return ("x" a) == ("x" b) ? 0 : (("x" a) > ("x" b) ? 1 : -1)
}
function compare(a, b, i, c, an, bn, ai, bi, aNumeric, bNumeric) {
  for (i = 1; i <= 3; i++) {
    c = numeric(a[i], b[i])
    if (c) return c
  }
  if (a[4] == "" || b[4] == "") return a[4] == b[4] ? 0 : (a[4] == "" ? 1 : -1)
  an = split(a[4], ai, ".")
  bn = split(b[4], bi, ".")
  for (i = 1; i <= an && i <= bn; i++) {
    aNumeric = ai[i] ~ /^[0-9]+$/
    bNumeric = bi[i] ~ /^[0-9]+$/
    if (aNumeric && bNumeric) c = numeric(ai[i], bi[i])
    else if (aNumeric != bNumeric) c = aNumeric ? -1 : 1
    else c = ("x" ai[i]) == ("x" bi[i]) ? 0 : (("x" ai[i]) > ("x" bi[i]) ? 1 : -1)
    if (c) return c
  }
  return an == bn ? 0 : (an > bn ? 1 : -1)
}
/^  version ".*"$/ { current = $0; sub(/^  version "/, "", current); sub(/"$/, "", current); count++ }
END {
  if (!parse(requested, nextVersion)) {
    print "update-cask: bad version: " requested > "/dev/stderr"
    exit 2
  }
  if (count != 1 || !parse(current, currentVersion)) {
    print "update-cask: expected one valid SemVer version in cask" > "/dev/stderr"
    exit 1
  }
  if (compare(nextVersion, currentVersion) <= 0) {
    print "update-cask: requested version " requested " must be newer than " current > "/dev/stderr"
    exit 1
  }
}' "$cask"

sed -e "s/^  version \".*\"$/  version \"$version\"/" \
    -e "s/^  sha256 \".*\"$/  sha256 \"$sha256\"/" \
    -e 's/-macos-arm64\.dmg/-macos-universal.dmg/' \
    -e '/^  depends_on arch: :arm64$/d' "$cask" > "$cask.new"
grep -Fqx "  version \"$version\"" "$cask.new" && grep -Fqx "  sha256 \"$sha256\"" "$cask.new" || {
  rm -f "$cask.new"
  echo "update-cask: $cask has no version or sha256 line to update" >&2
  exit 1
}
mv "$cask.new" "$cask"
