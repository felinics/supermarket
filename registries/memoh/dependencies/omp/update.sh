# shellcheck shell=sh
# Update OMP in a staged versions/<version> tree, preserving previous versions.
# The runner supplies set -eu, dep_log, dep_result and dep_switch.
# Environment: MEMOH_DEP_HOME, MEMOH_DEP_VERSION (empty/latest means stable),
# MEMOH_DEP_OS / _ARCH / _LIBC. No workspace or user config path is assumed.
# Download metadata follows the upstream scripts/install.sh protocol:
# https://github.com/can1357/oh-my-pi/blob/main/scripts/install.sh

build_url="https://build.stencil.so"
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

fetch() {
  curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 --connect-timeout 10 "$@"
}

# Match the build service's JSON strings, as the official installer does.
# Flatten line breaks first. Only the top-level `file` describes our target;
# `build.files` also contains checksums for the other platform binaries.
json_string() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}
json_file_object() {
  sed -n 's/.*"file"[[:space:]]*:[[:space:]]*{\([^}]*\)}.*/\1/p'
}

# Recover a same-version replacement interrupted by an older operation
# before doing network work, including when the retry will be offline.
recover_previous() {
  for saved in "$MEMOH_DEP_HOME/versions/"*.previous-*; do
    [ -d "$saved" ] || continue
    original="${saved%.previous-*}"
    if [ ! -e "$original" ]; then
      mv "$saved" "$original" || return 1
    fi
  done
}
recover_previous

commit_staged() {
  backup="$2.previous-$$"
  if [ -e "$2" ]; then
    mv "$2" "$backup" || return 1
  fi
  if ! mv "$1" "$2"; then
    if [ -e "$backup" ]; then mv "$backup" "$2" || return 1; fi
    return 1
  fi
  if ! dep_switch "$2"; then
    if [ -e "$backup" ]; then
      rm -rf "$2" || return 1
      mv "$backup" "$2" || return 1
    fi
    return 1
  fi
  rm -rf "$backup" || dep_log "Could not remove saved tree $backup"
}

req="${MEMOH_DEP_VERSION:-}"
req="${req#v}"
if [ -z "$req" ] || [ "$req" = latest ]; then
  api_url="$build_url/api/products/omp/latest/$target?channel=stable"
else
  if ! printf '%s\n' "$req" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
    dep_log "invalid requested OMP release version"
    exit 1
  fi
  api_url="$build_url/api/products/omp/versions/$req/$target"
fi

dep_log "Resolving OMP for $target from $api_url"
if ! build_json=$(fetch --max-time 60 "$api_url"); then
  dep_log "could not resolve the requested OMP build"
  exit 1
fi
build_json=$(printf '%s' "$build_json" | tr -d '\r\n')
ver=$(printf '%s\n' "$build_json" | json_string version)
file_json=$(printf '%s\n' "$build_json" | json_file_object)
expected=$(printf '%s\n' "$file_json" | json_string sha256)
# Go escapes ampersands in presigned download URLs as \u0026.
download_url=$(printf '%s\n' "$build_json" | json_string download | sed 's/\\u0026/\&/g')
if ! printf '%s\n' "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' ||
   ! printf '%s\n' "$expected" | grep -Eq '^[0-9a-f]{64}$'; then
  dep_log "invalid build metadata for OMP $target"
  exit 1
fi
case "$download_url" in
  https://?*) ;;
  *) dep_log "invalid build metadata: OMP download URL must use HTTPS"; exit 1 ;;
esac
if [ -n "$req" ] && [ "$req" != latest ] && [ "$ver" != "$req" ]; then
  dep_log "OMP version mismatch: requested $req, build service returned $ver"
  exit 1
fi
if [ -z "$req" ] || [ "$req" = latest ]; then
  case "$ver" in
    *-*) dep_log "invalid build metadata: stable OMP channel returned a prerelease"; exit 1 ;;
  esac
fi

versions="$MEMOH_DEP_HOME/versions"
stage="$versions/.staging-$MEMOH_DEP_ID.$$"
rm -rf "$versions/.staging-$MEMOH_DEP_ID."*
mkdir -p "$stage/root/bin" "$stage/root/libexec"

dep_log "Downloading OMP $ver for $target"
if ! fetch --max-time 900 --speed-limit 1024 --speed-time 30 -o "$stage/root/libexec/omp" "$download_url"; then
  dep_log "download of OMP $ver failed"
  rm -rf "$stage"
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  digest=$(sha256sum "$stage/root/libexec/omp" | awk '{ print $1 }')
else
  digest=$(shasum -a 256 "$stage/root/libexec/omp" | awk '{ print $1 }')
fi
if [ "$digest" != "$expected" ]; then
  dep_log "SHA256 mismatch for OMP $ver"
  rm -rf "$stage"
  exit 1
fi
chmod 755 "$stage/root/libexec/omp"

# OMP recognizes this official managed-install marker next to libexec/. Both
# `omp update` and automatic self-updates defer to Memoh, keeping version
# trees immutable for rollback. User configuration/auth remain untouched.
printf '%s\n' '{"manager":"memoh","name":"Memoh"}' > "$stage/root/manager.json"

# Memoh exposes entrypoints through shell shims. OMP's explicit /update and
# `omp update` resolve `omp` on PATH, while auto-update uses process.execPath.
# Put the real binary first so both find its adjacent manager.json instead
# of looking beside Memoh's outer shim. Resolve paths at runtime for rollback.
cat > "$stage/root/bin/omp" <<'SH'
#!/bin/sh
set -eu
omp_runtime_bin=$(CDPATH= cd "$(dirname "$0")/../libexec" && pwd -P)
PATH="$omp_runtime_bin:$PATH"
export PATH
exec "$omp_runtime_bin/omp" "$@"
SH
chmod 755 "$stage/root/bin/omp"

if ! output=$("$stage/root/bin/omp" --version </dev/null); then
  dep_log "OMP $ver downloaded but bin/omp does not run on this platform"
  rm -rf "$stage"
  exit 1
fi
actual=$(printf '%s\n' "$output" | sed -n 's/^omp\/\([0-9][0-9A-Za-z.-]*\)$/\1/p')
if [ "$actual" != "$ver" ]; then
  dep_log "OMP version mismatch: expected $ver, binary reported $output"
  rm -rf "$stage"
  exit 1
fi

# Publish only once the result is safely written; preserve older versions.
dep_result "{\"version\":\"$ver\",\"entrypoints\":{\"omp\":\"$MEMOH_DEP_HOME/current/bin/omp\"}}"
commit_staged "$stage/root" "$versions/$ver"
rm -rf "$stage" || dep_log "Could not remove staging directory $stage"
