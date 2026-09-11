# shellcheck shell=sh
# Compare the installed CPython version with the newest stable release uv can download.
#
# The body runs inside the runner's prelude: `set -eu` is
# already active and dep_log / dep_result are provided; do not redefine them.
# Environment: MEMOH_DEP_CURRENT_VERSION (the installed version),
# MEMOH_DEP_RESULT. The exit status only says whether the check ran; whether
# an update exists is reported in the result file, so a lookup
# failure must exit non-zero. "Latest" is bounded by the download list built
# into the uv on PATH; a newer uv knows newer interpreters.

export UV_CACHE_DIR="$MEMOH_DEP_HOME/cache/uv"

command -v uv >/dev/null 2>&1 || {
  dep_log "uv is not available on PATH; the uv dependency must be present first"
  exit 1
}

installed="${MEMOH_DEP_CURRENT_VERSION:-}"

# One downloadable build per line, newest first; variant builds carry a
# +suffix and pre-releases an rc/a/b marker, both are skipped.
latest=$(uv python list --only-downloads \
  | sed -n 's/^cpython-\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)-.*/\1/p' | head -n 1)
if [ -z "$latest" ]; then
  dep_log "uv reported no downloadable stable CPython for this platform"
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
