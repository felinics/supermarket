# shellcheck shell=sh
# Compare the installed CLI with the latest official stable GitHub release.
# The runner supplies set -eu, dep_log and dep_result. Lookup failure is an
# error, not a successful check claiming there are no updates.

api="https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest"
if ! release=$(curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 "$api"); then
  dep_log "could not fetch the latest official Antigravity release"
  exit 1
fi
latest=$(printf '%s\n' "$release" | tr '\n' ' ' | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"\\]*\)".*/\1/p')
installed="${MEMOH_DEP_CURRENT_VERSION:-}"
installed="${installed#v}"
valid_version() {
  case "$1" in "" | *[[:space:]]*) return 1 ;; esac
  printf '%s\n' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
}
if ! valid_version "$latest"; then
  dep_log "invalid latest Antigravity release version"
  exit 1
fi
if [ -n "$installed" ] && ! valid_version "$installed"; then
  dep_log "invalid installed Antigravity release version"
  exit 1
fi

# The stable channel may lag an explicitly installed newer version.
if awk -v installed="$installed" -v latest="$latest" 'BEGIN {
  if (installed == "") exit 0
  installed_core = installed; latest_core = latest
  sub(/[^0-9.].*$/, "", installed_core); sub(/[^0-9.].*$/, "", latest_core)
  split(installed_core, old, "."); split(latest_core, next_release, ".")
  for (i = 1; i <= 3; i++) {
    if (next_release[i] + 0 > old[i] + 0) exit 0
    if (next_release[i] + 0 < old[i] + 0) exit 1
  }
  exit !(installed != installed_core && latest == latest_core)
}'; then available=true; else available=false; fi
dep_result "{\"installed\":\"$installed\",\"latest\":\"$latest\",\"update_available\":$available}"
