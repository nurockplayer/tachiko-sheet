#!/usr/bin/env bash
set -euo pipefail
fail() { echo "installer-smoke macos: $*" >&2; exit 1; }
work=$(mktemp -d)
mount="$work/mount"
pid=""
mounted=0
cleanup() {
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  if [[ "$mounted" == 1 ]]; then hdiutil detach "$mount" >/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -p "$mount" "$work/Applications"
hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$1" >/dev/null
mounted=1
apps=("$mount"/*.app)
[[ ${#apps[@]} -eq 1 && -d "${apps[0]}" ]] || fail 'expected one app in DMG'
ditto "${apps[0]}" "$work/Applications/$(basename "${apps[0]}")"
hdiutil detach "$mount" >/dev/null
mounted=0
app="$work/Applications/$(basename "${apps[0]}")"
codesign --verify --deep --verbose=2 "$app" || fail 'codesign verification failed'
python3 -c 'import plistlib,sys; d=plistlib.load(open(sys.argv[1], "rb")); sys.exit(0 if any("ro" in x.get("CFBundleTypeExtensions", []) for x in d.get("CFBundleDocumentTypes", [])) else 1)' "$app/Contents/Info.plist" || fail 'Info.plist does not register the ro extension'
exe=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")
"$app/Contents/MacOS/$exe" & pid=$!
found=0
for ((i=0; i<60; i++)); do
  kill -0 "$pid" 2>/dev/null || fail 'process exited before window'
  if result=$(osascript -e "tell application \"System Events\" to count windows of (first process whose unix id is $pid)" 2>&1); then
    if [[ "$result" =~ ^[0-9]+$ ]] && (( result > 0 )); then found=1; break; fi
  elif [[ "$result" == *'-1743'* || "$result" == *'-25211'* || "$result" == *'not allowed'* || "$result" == *'not authorized'* ]]; then
    echo "Accessibility denied ($result); falling back to alive after 20 seconds"
    if (( i < 20 )); then sleep $((20-i)); fi
    kill -0 "$pid" 2>/dev/null || fail 'process exited during accessibility fallback'
    found=1; break
  fi
  sleep 1
done
[[ "$found" == 1 ]] || fail 'no window within 60 seconds'
sleep 10
kill -0 "$pid" 2>/dev/null || fail 'process exited during 10-second hold'
kill -TERM "$pid"
for ((i=0; i<15; i++)); do
  if ! kill -0 "$pid" 2>/dev/null; then wait "$pid" || true; pid=""; echo 'installer-smoke macos: PASS'; exit 0; fi
  sleep 1
done
fail 'process did not exit within 15 seconds'
