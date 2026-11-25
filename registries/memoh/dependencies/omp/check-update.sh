# shellcheck shell=sh
# Compare against the newest stable build available for this target.
# The runner supplies set -eu, dep_log and dep_result. A lookup failure is
# an error, never a successful "no update" result.

case "$MEMOH_DEP_OS/$MEMOH_DEP_ARCH" in
  linux/amd64) target="linux-x86_64" ;;
  linux/arm64) target="linux-arm64" ;;
  darwin/amd64) target="macos-x86_64" ;;
  darwin/arm64) target="macos-arm64" ;;
  *)
    dep_log "OMP is not available for $MEMOH_DEP_OS/$MEMOH_DEP_ARCH"
    exit 1
    ;;
esac
if [ "$MEMOH_DEP_OS" = linux ] && [ "${MEMOH_DEP_LIBC:-glibc}" != glibc ]; then
  dep_log "OMP overlays currently require glibc on Linux"
  exit 1
fi

installed="${MEMOH_DEP_CURRENT_VERSION:-}"
installed="${installed#v}"
if [ -n "$installed" ] && ! printf '%s\n' "$installed" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  dep_log "invalid installed OMP release version"
  exit 1
fi
api_url="https://build.stencil.so/api/products/omp/latest/$target?channel=stable"
if ! build_json=$(curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 \
  --connect-timeout 10 --max-time 50 "$api_url"); then
  dep_log "could not resolve the latest stable OMP build"
  exit 1
fi
latest=$(printf '%s' "$build_json" | tr -d '\r\n' | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
if ! printf '%s\n' "$latest" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  dep_log "invalid build metadata for the latest stable OMP release"
  exit 1
fi

# A stable channel may lag an explicitly installed newer version. Compare
# numeric components; a stable release also supersedes its prerelease.
if awk -v installed="$installed" -v latest="$latest" 'BEGIN {
  if (installed == "") exit 0
  installed_core = installed
  sub(/[^0-9.].*$/, "", installed_core)
  split(installed_core, old, "."); split(latest, next_release, ".")
  for (i = 1; i <= 3; i++) {
    if (next_release[i] + 0 > old[i] + 0) exit 0
    if (next_release[i] + 0 < old[i] + 0) exit 1
  }
  exit !(installed != installed_core)
}'; then available=true; else available=false; fi
dep_result "{\"installed\":\"$installed\",\"latest\":\"$latest\",\"update_available\":$available}"
