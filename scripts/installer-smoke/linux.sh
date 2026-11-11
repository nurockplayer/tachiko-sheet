#!/usr/bin/env bash
set -euo pipefail
fail() { echo "installer-smoke linux: $*" >&2; exit 1; }
deb=$(realpath "$1")
appimage=$(realpath "$2")
sudo apt-get install -y xdotool xvfb libfuse2t64
sudo apt-get install -y "$deb"
package=$(dpkg-deb -f "$deb" Package)
binary=$(dpkg -L "$package" | awk '/^\/usr\/bin\/[^/]+$/ {print; exit}')
[[ -n "$binary" && -x "$binary" ]] || fail 'installed executable not found in deb'
desktop=$(dpkg -L "$package" | awk '/\.desktop$/ {print; exit}')
[[ -n "$desktop" && -f "$desktop" ]] || fail 'installed desktop file not found'
mime=$(grep '^MimeType=' "$desktop") || fail 'desktop file has no MimeType'
echo "$mime"
[[ ";${mime#MimeType=}" == *';application/x-tachiko-work;'* ]] || fail 'desktop file does not register the .ro MIME type'
chmod +x "$appimage"
smoke() {
  local program=$1
  xvfb-run -a bash -c '
    set -euo pipefail
    home=$(mktemp -d)
    pid=""
    cleanup() { if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi; rm -rf "$home"; }
    trap cleanup EXIT
    HOME="$home" "$1" & pid=$!
    found=0
    for ((i=0; i<60; i++)); do
      kill -0 "$pid" 2>/dev/null || { echo "process exited before window" >&2; exit 1; }
      if xdotool search --pid "$pid" --onlyvisible >/dev/null 2>&1; then found=1; break; fi
      sleep 1
    done
    [[ "$found" == 1 ]] || { echo "no window within 60 seconds" >&2; exit 1; }
    sleep 10
    kill -0 "$pid" 2>/dev/null || { echo "process exited during 10-second hold" >&2; exit 1; }
    kill -TERM "$pid"
    for ((i=0; i<15; i++)); do
      if ! kill -0 "$pid" 2>/dev/null; then wait "$pid" || true; pid=""; exit 0; fi
      sleep 1
    done
    echo "process did not exit within 15 seconds" >&2; exit 1
  ' _ "$program" || fail "launch check failed: $program"
}
smoke "$binary"
smoke "$appimage"
echo 'installer-smoke linux: PASS'
