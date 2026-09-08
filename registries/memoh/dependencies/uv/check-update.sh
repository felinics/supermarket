# shellcheck shell=sh
# Compare the installed uv version with the newest release.
#
# The body runs inside the runner's prelude: `set -eu` is
# already active and dep_log / dep_result are provided; do not redefine them.
# Environment: MEMOH_DEP_CURRENT_VERSION (the installed version),
# MEMOH_DEP_RESULT, UV_RELEASES_URL (the releases base URL; "latest" is
# where <UV_RELEASES_URL>/latest redirects, the GitHub releases API is the
# fallback). The exit status only says whether the check ran; whether an
# update exists is reported in the result file, so a lookup
# failure must exit non-zero.

releases="${UV_RELEASES_URL:-https://github.com/astral-sh/uv/releases}"

installed="${MEMOH_DEP_CURRENT_VERSION:-}"
installed="${installed#v}"

# <releases>/latest redirects to <releases>/tag/<version>. When that yields
# nothing (a mirror without the redirect) ask the GitHub releases API, which
# answers with one key per line.
latest=""
location=$(curl -fsSIL --retry 3 -o /dev/null -w '%{url_effective}' "$releases/latest") || location=""
case "$location" in
  */releases/tag/*) latest="${location##*/}" ;;
esac
if [ -z "$latest" ]; then
  latest=$(curl -fsSL --retry 3 https://api.github.com/repos/astral-sh/uv/releases/latest \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1) || latest=""
fi
latest="${latest#v}"
if [ -z "$latest" ]; then
  dep_log "could not resolve the latest uv release"
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
