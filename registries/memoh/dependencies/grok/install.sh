# shellcheck shell=sh
# Install the Grok Build CLI into a fresh versions/<version> directory, then switch `current`.
#
# The body runs inside the runner's prelude: `set -eu` is
# already active and dep_log / dep_result / dep_switch are provided; do not
# redefine them. Environment: MEMOH_DEP_HOME, MEMOH_DEP_VERSION (empty or
# "latest" selects the newest stable release), MEMOH_DEP_OS / _ARCH,
# MEMOH_DEP_RESULT. The binary comes from where the official installer
# (https://x.ai/cli/install.sh) reads it: <base>/stable names the newest
# stable release and <base>/grok-<version>-<os>-<arch>[.gz] is the binary.
# xAI publishes no checksum for it, so both bases are xAI's own and are
# reached over HTTPS only. Never hard-code the workspace data mount path.

primary="https://x.ai/cli"
fallback="https://storage.googleapis.com/grok-build-public-artifacts/cli"
case "$MEMOH_DEP_OS/$MEMOH_DEP_ARCH" in
  linux/amd64) platform="linux-x86_64" ;;
  linux/arm64) platform="linux-aarch64" ;;
  darwin/arm64) platform="macos-aarch64" ;;
  *)
    dep_log "Grok Build is not available for $MEMOH_DEP_OS/$MEMOH_DEP_ARCH"
    exit 1
    ;;
esac

fetch() {
  curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 "$@"
}

# A failed replacement must retain the last usable tree. Recover the rename
# left by an interrupted older recipe before any download or staging cleanup.
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

# Publish only after the result has been written successfully. Each fallible
# rename/switch is checked explicitly: set -e alone skips the restoration.
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
  # Cleanup cannot turn an already committed installation into a failure.
  rm -rf "$backup" || dep_log "Could not remove saved tree $backup"
}

# Resolve the request to one exact release (Grok versions carry no "v" prefix).
req="${MEMOH_DEP_VERSION:-}"
req="${req#v}"
if [ -z "$req" ] || [ "$req" = latest ]; then
  dep_log "Resolving the latest stable Grok Build release from $primary/stable"
  ver=$(fetch "$primary/stable" | tr -d '[:space:]') || ver=""
  if [ -z "$ver" ]; then
    ver=$(fetch "$fallback/stable" | tr -d '[:space:]') || ver=""
  fi
  if [ -z "$ver" ]; then
    dep_log "could not resolve the latest stable Grok Build release"
    exit 1
  fi
else
  ver="$req"
fi

# Only an exact release may become a path component or download URL.
if ! printf '%s\n' "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z._]+)?$'; then
  dep_log "invalid resolved release version"
  exit 1
fi

versions="$MEMOH_DEP_HOME/versions"
stage="$versions/.staging-$MEMOH_DEP_ID.$$"
rm -rf "$versions/.staging-$MEMOH_DEP_ID."*
mkdir -p "$stage/root/bin"

# The gzip copy is a third of the size; the plain binary is the fallback for
# a release published without one.
download() {
  if fetch -o "$stage/grok.gz" "$1.gz" && gzip -dc "$stage/grok.gz" > "$stage/root/bin/grok"; then
    rm -f "$stage/grok.gz"
    return 0
  fi
  rm -f "$stage/grok.gz"
  fetch -o "$stage/root/bin/grok" "$1"
}

artifact="grok-$ver-$platform"
dep_log "Downloading $primary/$artifact"
if ! download "$primary/$artifact"; then
  dep_log "Downloading $fallback/$artifact"
  if ! download "$fallback/$artifact"; then
    dep_log "download of $artifact failed"
    rm -rf "$stage"
    exit 1
  fi
fi
chmod 755 "$stage/root/bin/grok"

# Verify the staged tree before anything can become `current`.
if ! "$stage/root/bin/grok" --version </dev/null >/dev/null 2>&1; then
  dep_log "Grok Build $ver downloaded but bin/grok does not run on this platform"
  rm -rf "$stage"
  exit 1
fi

dep_result "{\"version\":\"$ver\",\"entrypoints\":{\"grok\":\"$MEMOH_DEP_HOME/current/bin/grok\"}}"
commit_staged "$stage/root" "$versions/$ver"
rm -rf "$stage" || dep_log "Could not remove staging directory $stage"
