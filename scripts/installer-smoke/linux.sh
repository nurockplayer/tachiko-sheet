#!/usr/bin/env bash
set -euo pipefail
fail() { echo "installer-smoke linux: $*" >&2; exit 1; }
deb=$(realpath "$1")
appimage=$(realpath "$2")
sudo apt-get install -y xdotool xvfb libfuse2t64 desktop-file-utils xdg-utils libglib2.0-bin dbus-x11 shared-mime-info
sudo apt-get install -y "$deb"
[[ -f /usr/share/mime/packages/tachiko-sheet.xml ]] || fail 'installed MIME declaration not found'
sudo update-mime-database /usr/share/mime
package=$(dpkg-deb -f "$deb" Package)
binary=$(dpkg -L "$package" | awk '/^\/usr\/bin\/[^/]+$/ {print; exit}')
[[ -n "$binary" && -x "$binary" ]] || fail 'installed executable not found in deb'
binary=$(realpath "$binary")
desktop=$(dpkg -L "$package" | awk '/\.desktop$/ {print; exit}')
[[ -n "$desktop" && -f "$desktop" ]] || fail 'installed desktop file not found'
desktop-file-validate "$desktop" || fail 'installed desktop file is invalid'
mime=$(grep '^MimeType=' "$desktop") || fail 'desktop file has no MimeType'
echo "$mime"
[[ ";${mime#MimeType=}" == *';application/x-tachiko-work;'* ]] || fail 'desktop file does not register the .ro MIME type'
chmod +x "$appimage"
fixture=$(realpath "$(dirname "$0")/../../public/templates/budget.ro")
smoke() {
  local program=$1 mode=${2:-direct}
  xvfb-run -a dbus-run-session -- bash -c '
    set -euo pipefail
    home=$(mktemp -d)
    pid=""
    cleanup() { if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi; rm -rf "$home"; }
    trap cleanup EXIT
    export HOME="$home"
    if [[ "$2" == shell ]]; then
      cp "$3" "$home/installer-smoke.ro"
      gio info -a standard::content-type "$home/installer-smoke.ro"
      filetype=$(XDG_CURRENT_DESKTOP=GNOME xdg-mime query filetype "$home/installer-smoke.ro")
      echo "xdg-mime query filetype: $filetype"
      [[ "$filetype" == application/x-tachiko-work ]] || { echo "wrong .ro MIME type" >&2; exit 1; }
      handler=$(XDG_CURRENT_DESKTOP=GNOME xdg-mime query default "$filetype")
      echo "xdg-mime query default: $handler"
      [[ "$handler" == "$4" ]] || { echo "wrong .ro desktop handler" >&2; exit 1; }
      echo "gio open: $home/installer-smoke.ro"
      gio open "$home/installer-smoke.ro"
    else
      "$1" & pid=$!
    fi
    found=0
    for ((i=0; i<60; i++)); do
      if [[ "$2" == shell && -z "$pid" ]]; then
        for window in $(xdotool search --onlyvisible --name "Tachiko Sheet" 2>/dev/null || true); do
          candidate=$(xdotool getwindowpid "$window")
          if [[ "$(readlink -f "/proc/$candidate/exe")" == "$1" ]]; then pid=$candidate; break; fi
        done
        if [[ -z "$pid" ]]; then sleep 1; continue; fi
      fi
      kill -0 "$pid" 2>/dev/null || { echo "process exited before window" >&2; exit 1; }
      if xdotool search --pid "$pid" --onlyvisible >/dev/null 2>&1; then found=1; break; fi
      sleep 1
    done
    [[ "$found" == 1 ]] || { echo "no window within 60 seconds" >&2; exit 1; }
    sleep 10
    kill -0 "$pid" 2>/dev/null || { echo "process exited during 10-second hold" >&2; exit 1; }
    echo "visible window + 10-second hold: PASS ($2)"
    kill -TERM "$pid"
    for ((i=0; i<15; i++)); do
      if ! kill -0 "$pid" 2>/dev/null; then wait "$pid" || true; pid=""; exit 0; fi
      sleep 1
    done
    echo "process did not exit within 15 seconds" >&2; exit 1
  ' _ "$program" "$mode" "$fixture" "$(basename "$desktop")" || fail "launch check failed: $program ($mode)"
}
smoke "$binary"
smoke "$appimage"
smoke "$binary" shell
echo 'installer-smoke linux: PASS'
