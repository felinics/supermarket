# shellcheck shell=sh
# memoh-storage-layout: isolated
# Install an exact, verified candidate. The runner owns publication and cleanup
# when MEMOH_DEP_INSTALL_DIR is set; older runners retain their version layout.
# dep_log, dep_result and dep_switch are supplied by the runner.

store="${MEMOH_DEP_STORE:-$MEMOH_DEP_HOME}"

mirror="${NODEJS_MIRROR:-https://nodejs.org/dist}"
case "$MEMOH_DEP_OS" in
  linux)
    if [ "${MEMOH_DEP_LIBC:-glibc}" != glibc ]; then
      dep_log "Node.js overlays require glibc on Linux"
      exit 1
    fi
    ;;
  darwin) ;;
  *)
    dep_log "Node.js overlays are not available for OS '$MEMOH_DEP_OS'"
    exit 1
    ;;
esac
case "$MEMOH_DEP_ARCH" in
  amd64) arch=x64 ;;
  arm64) arch=arm64 ;;
  *)
    dep_log "Node.js overlays are not available for architecture '$MEMOH_DEP_ARCH'"
    exit 1
    ;;
esac

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
if [ -z "${MEMOH_DEP_INSTALL_DIR:-}" ]; then recover_previous; fi

# Publish only after the result has been written successfully. Each fallible
# rename/switch is checked explicitly: set -e alone skips the restoration.
commit_staged() {
  mkdir -p "$(dirname "$2")" || return 1
  if [ -n "${MEMOH_DEP_INSTALL_DIR:-}" ]; then
    if [ -e "$2" ] || [ -L "$2" ]; then
      dep_log "candidate already exists; refusing to overwrite it"
      return 1
    fi
    mv "$1" "$2" || return 1
    dep_switch "$2"
    return
  fi
  # Only old runners need a temporary saved tree for same-version replacement.
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

versions="$store/versions"
mkdir -p "$store"
stage="${MEMOH_DEP_STAGING:-}"
if [ -z "$stage" ]; then
  stage=$(mktemp -d "$store/.staging-$MEMOH_DEP_ID.XXXXXX")
fi
mkdir -p "$stage/root"

# Resolve the request to an exact release. index.json lists one release per
# line, newest first; LTS releases carry their codename in "lts", all others
# carry false.
req="${MEMOH_DEP_VERSION:-}"
req="${req#v}"
case "$req" in
  *.*.*)
    ver="$req"
    ;;
  *)
    dep_log "Resolving Node.js ${req:-latest LTS} from $mirror/index.json"
    if ! curl -fsSL --retry 3 -o "$stage/index.json" "$mirror/index.json"; then
      dep_log "download of $mirror/index.json failed"
      rm -rf "$stage"
      exit 1
    fi
    if [ -z "$req" ] || [ "$req" = latest ]; then
      ver=$(grep '"lts":"' "$stage/index.json" | head -n 1 \
        | sed -n 's/.*"version":"v\([0-9][0-9.]*\)".*/\1/p')
    else
      ver=$(grep "\"version\":\"v$req\." "$stage/index.json" | head -n 1 \
        | sed -n 's/.*"version":"v\([0-9][0-9.]*\)".*/\1/p')
    fi
    ;;
esac
if [ -z "$ver" ]; then
  dep_log "could not resolve Node.js ${req:-latest LTS} from $mirror/index.json"
  rm -rf "$stage"
  exit 1
fi

# Only an exact release may become a path component or checksum URL.
if ! printf '%s\n' "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'; then
  dep_log "invalid resolved release version"
  rm -rf "$stage"
  exit 1
fi

archive="node-v$ver-$MEMOH_DEP_OS-$arch.tar.gz"
url="$mirror/v$ver/$archive"
dep_log "Updating Node.js from ${MEMOH_DEP_CURRENT_VERSION:-unknown} to $ver: downloading $url"
if ! curl -fsSL --retry 3 -o "$stage/$archive" "$url"; then
  dep_log "download of $url failed"
  rm -rf "$stage"
  exit 1
fi
# A mirror controls archive transport, never the expected checksum. Obtain
# the digest over HTTPS from the upstream release authority before unpacking.
checksum_url="https://nodejs.org/dist/v$ver/SHASUMS256.txt"
if ! curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 -o "$stage/checksums" "$checksum_url"; then
  dep_log "could not fetch official Node.js checksums"
  rm -rf "$stage"
  exit 1
fi
expected=$(awk -v file="$archive" '$2 == file { print $1 }' "$stage/checksums")
if ! printf '%s\n' "$expected" | grep -Eq '^[0-9a-fA-F]{64}$'; then
  dep_log "official checksum is missing or malformed for $archive"
  rm -rf "$stage"
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  digest=$(sha256sum "$stage/$archive" | awk '{ print $1 }')
else
  digest=$(shasum -a 256 "$stage/$archive" | awk '{ print $1 }')
fi
if [ "$digest" != "$expected" ]; then
  dep_log "SHA256 mismatch for $archive"
  rm -rf "$stage"
  exit 1
fi
dep_log "Unpacking $archive"
if ! tar -xzf "$stage/$archive" --strip-components=1 -C "$stage/root"; then
  dep_log "could not unpack $archive"
  rm -rf "$stage"
  exit 1
fi
rm -f "$stage/$archive" "$stage/index.json"

# Verify the staged tree before anything can become `current`.
for cmd in node npm npx; do
  if [ ! -x "$stage/root/bin/$cmd" ]; then
    dep_log "Node.js v$ver unpacked but bin/$cmd is missing or not executable"
    rm -rf "$stage"
    exit 1
  fi
done
if ! actual=$("$stage/root/bin/node" --version); then
  dep_log "Node.js v$ver unpacked but bin/node does not run on this platform"
  rm -rf "$stage"
  exit 1
fi
actual="${actual#v}"
if [ "$actual" != "$ver" ]; then
  dep_log "installed Node.js version '$actual' does not match '$ver'"
  rm -rf "$stage"
  exit 1
fi
for cmd in npm npx; do
  if ! PATH="$stage/root/bin:$PATH" "$stage/root/bin/$cmd" --version >/dev/null 2>&1; then
    dep_log "Node.js $ver installed but $cmd does not run"
    rm -rf "$stage"
    exit 1
  fi
done

bin="$MEMOH_DEP_HOME/current/bin"
dep_result "{\"version\":\"$actual\",\"entrypoints\":{\"node\":\"$bin/node\",\"npm\":\"$bin/npm\",\"npx\":\"$bin/npx\"}}"
commit_staged "$stage/root" "${MEMOH_DEP_INSTALL_DIR:-$versions/$actual}"
rm -rf "$stage" || dep_log "Could not remove staging directory $stage"
