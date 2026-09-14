# shellcheck shell=sh
# Compare the installed @openai/codex version with the newest release on the npm registry.
#
# The body runs inside the runner's prelude: `set -eu` is
# already active and dep_log / dep_result are provided; do not redefine them.
# Environment: MEMOH_DEP_CURRENT_VERSION (the installed version),
# MEMOH_DEP_RESULT, NPM_MIRROR. The exit status only says whether the
# check ran; whether an update exists is reported in the result file
#, so a registry or network failure must exit non-zero.

pkg="@openai/codex"
registry="${NPM_MIRROR:-https://registry.npmjs.org}"
store="${MEMOH_DEP_STORE:-$MEMOH_DEP_HOME}"
export npm_config_cache="$store/cache/npm"

command -v npm >/dev/null 2>&1 || {
  dep_log "npm is not available on PATH; the node dependency must be present first"
  exit 1
}

installed="${MEMOH_DEP_CURRENT_VERSION:-}"
latest=$(npm view "$pkg" version --registry "$registry") || latest=""
case "$latest" in
  "" | *[[:space:]]*)
    dep_log "could not resolve the latest $pkg version from $registry"
    exit 1
    ;;
esac

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
