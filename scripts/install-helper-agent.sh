#!/bin/sh
# Keeps the PhotoGit helper running in the background on macOS, so the
# Photoshop panel finds it on every load. launchd starts it at login and
# restarts it if it ever exits. The panel only uses the filesystem bridge, so
# the service runs --bridge-only and never competes for the HTTP port.
#
#   scripts/install-helper-agent.sh              install or refresh
#   scripts/install-helper-agent.sh --uninstall  stop and remove
set -eu

label="com.photogit.helper"
plist="$HOME/Library/LaunchAgents/$label.plist"
log_dir="$HOME/Library/Logs/PhotoGit"
domain="gui/$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$domain/$label" 2>/dev/null || true
  rm -f "$plist"
  printf 'PhotoGit helper background service removed.\n'
  exit 0
fi

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
helper="$repository_root/apps/desktop-helper/dist/main.js"
node_path=$(command -v node || true)
[ -n "$node_path" ] || { printf 'Node.js was not found on PATH.\n' >&2; exit 1; }

(cd "$repository_root" && npm run build --silent)

# Any extra arguments are approved project roots, added to the helper config.
approve_args=""
for root in "$@"; do
  absolute=$(CDPATH= cd -- "$root" && pwd)
  approve_args="$approve_args<string>--approve-root</string><string>$absolute</string>"
done

mkdir -p "$HOME/Library/LaunchAgents" "$log_dir"
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$node_path</string><string>$helper</string><string>--bridge-only</string>$approve_args</array>
  <key>WorkingDirectory</key><string>$repository_root</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$node_path"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$log_dir/helper.log</string>
  <key>StandardErrorPath</key><string>$log_dir/helper.log</string>
</dict>
</plist>
PLIST

# A helper started by hand holds the config lock; stop it so launchd owns it.
pkill -f "$helper" 2>/dev/null || true
launchctl bootout "$domain/$label" 2>/dev/null || true
launchctl bootstrap "$domain" "$plist"
launchctl kickstart -k "$domain/$label"
printf 'PhotoGit helper now runs in the background (log: %s/helper.log).\n' "$log_dir"
