# shellcheck shell=sh
# Compare the installed Node.js version with the newest LTS release.
#
# The body runs inside the runner's prelude: `set -eu` is
# already active and dep_log / dep_result are provided; do not redefine them.
# Environment: MEMOH_DEP_CURRENT_VERSION (the installed version),
# MEMOH_DEP_OS / _LIBC, MEMOH_DEP_RESULT, NODEJS_MIRROR
#. The exit status only says whether the check ran; whether an update
# exists is reported in the result file, so a download failure
# must exit non-zero.

mirror="${NODEJS_MIRROR:-https://nodejs.org/dist}"
if [ "$MEMOH_DEP_OS" = linux ] && [ "${MEMOH_DEP_LIBC:-glibc}" != glibc ]; then
  dep_log "Node.js overlays require glibc on Linux"
  exit 1
fi

installed="${MEMOH_DEP_CURRENT_VERSION:-}"
installed="${installed#v}"

# index.json lists one release per line, newest first; LTS releases carry
# their codename in "lts", all others carry false.
index=$(mktemp "${TMPDIR:-/tmp}/memoh-node-index.XXXXXX")
if ! curl -fsSL --retry 3 -o "$index" "$mirror/index.json"; then
  dep_log "download of $mirror/index.json failed"
  rm -f "$index"
  exit 1
fi
latest=$(grep '"lts":"' "$index" | head -n 1 | sed -n 's/.*"version":"v\([0-9][0-9.]*\)".*/\1/p')
rm -f "$index"
if [ -z "$latest" ]; then
  dep_log "no LTS release found in $mirror/index.json"
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
