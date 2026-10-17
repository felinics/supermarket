# shellcheck shell=sh
# Compare the installed Grok Build version with the newest stable release.
#
# The body runs inside the runner's prelude: `set -eu` is
# already active and dep_log / dep_result are provided; do not redefine them.
# Environment: MEMOH_DEP_CURRENT_VERSION (the installed version),
# MEMOH_DEP_RESULT. <base>/stable is the channel pointer the official
# installer reads. The exit status only says whether the check ran; whether
# an update exists is reported in the result file, so a lookup failure must
# exit non-zero.

primary="https://x.ai/cli"
fallback="https://storage.googleapis.com/grok-build-public-artifacts/cli"

fetch() {
  curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 "$@"
}

installed="${MEMOH_DEP_CURRENT_VERSION:-}"
installed="${installed#v}"

latest=$(fetch "$primary/stable" | tr -d '[:space:]') || latest=""
if [ -z "$latest" ]; then
  latest=$(fetch "$fallback/stable" | tr -d '[:space:]') || latest=""
fi
if ! printf '%s\n' "$latest" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z._]+)?$'; then
  dep_log "could not resolve the latest stable Grok Build release"
  exit 1
fi

# Release channels can lag an explicitly installed newer version. Compare
# numeric release components; a stable release also supersedes its prerelease.
if awk -v installed="$installed" -v latest="$latest" 'BEGIN {
  sub(/^v/, "", installed); sub(/^v/, "", latest)
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
