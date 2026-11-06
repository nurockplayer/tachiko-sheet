#!/bin/sh
# Points the Homebrew cask at one release. Changes only the version and sha256
# lines, so the reviewed caveats and zap paths stay as they are. Also moves the
# cask from the arm64-only DMG to the universal one and drops its arm64-only
# requirement; a cask already moved is left as it is.
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: update-cask.sh <version> <sha256> <cask file>" >&2
  exit 2
fi
version=$1 sha256=$2 cask=$3

case "$version" in
  *[!0-9A-Za-z.-]* | "") echo "update-cask: bad version: $version" >&2; exit 2 ;;
esac
if ! printf '%s\n' "$sha256" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "update-cask: bad sha256: $sha256" >&2
  exit 2
fi

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
