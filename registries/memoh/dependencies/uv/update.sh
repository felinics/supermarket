# shellcheck shell=sh
# memoh-storage-layout: isolated
# Install an exact, verified candidate. The runner owns publication and cleanup
# when MEMOH_DEP_INSTALL_DIR is set; older runners retain their version layout.
# dep_log, dep_result and dep_switch are supplied by the runner.

store="${MEMOH_DEP_STORE:-$MEMOH_DEP_HOME}"

releases="${UV_RELEASES_URL:-https://github.com/astral-sh/uv/releases}"
case "$MEMOH_DEP_OS/$MEMOH_DEP_ARCH" in
  linux/amd64) triple="x86_64-unknown-linux-gnu" ;;
  linux/arm64) triple="aarch64-unknown-linux-gnu" ;;
  darwin/amd64) triple="x86_64-apple-darwin" ;;
  darwin/arm64) triple="aarch64-apple-darwin" ;;
  *)
    dep_log "uv overlays are not available for $MEMOH_DEP_OS/$MEMOH_DEP_ARCH"
    exit 1
    ;;
esac
if [ "$MEMOH_DEP_OS" = linux ] && [ "${MEMOH_DEP_LIBC:-glibc}" != glibc ]; then
  dep_log "uv overlays currently require glibc on Linux"
  exit 1
fi

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

# Resolve the request to an exact release tag (uv tags carry no "v" prefix).
req="${MEMOH_DEP_VERSION:-}"
req="${req#v}"
if [ -z "$req" ] || [ "$req" = latest ]; then
  dep_log "Resolving the latest uv release from $releases/latest"
  # <releases>/latest redirects to <releases>/tag/<version>. When that yields
  # nothing (a mirror without the redirect) ask the GitHub releases API, which
  # answers with one key per line.
  ver=""
  location=$(curl -fsSIL --retry 3 -o /dev/null -w '%{url_effective}' "$releases/latest") || location=""
  case "$location" in
    */releases/tag/*) ver="${location##*/}" ;;
  esac
  if [ -z "$ver" ]; then
    ver=$(curl -fsSL --retry 3 https://api.github.com/repos/astral-sh/uv/releases/latest \
      | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1) || ver=""
  fi
  ver="${ver#v}"
  if [ -z "$ver" ]; then
    dep_log "could not resolve the latest uv release"
    exit 1
  fi
else
  ver="$req"
fi

versions="$store/versions"
mkdir -p "$store"
stage="${MEMOH_DEP_STAGING:-}"
if [ -z "$stage" ]; then
  stage=$(mktemp -d "$store/.staging-$MEMOH_DEP_ID.XXXXXX")
fi
mkdir -p "$stage/root/bin"

# Only an exact release may become a path component or checksum URL.
if ! printf '%s\n' "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'; then
  dep_log "invalid resolved release version"
  rm -rf "$stage"
  exit 1
fi

archive="uv-$triple.tar.gz"
url="$releases/download/$ver/$archive"
dep_log "Updating uv from ${MEMOH_DEP_CURRENT_VERSION:-unknown} to $ver: downloading $url"
if ! curl -fsSL --retry 3 -o "$stage/$archive" "$url"; then
  dep_log "download of $url failed"
  rm -rf "$stage"
  exit 1
fi
# A mirror controls archive transport, never the expected checksum. Obtain
# the digest over HTTPS from the upstream release authority before unpacking.
checksum_url="https://github.com/astral-sh/uv/releases/download/$ver/$archive.sha256"
if ! curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 -o "$stage/checksums" "$checksum_url"; then
  dep_log "could not fetch official uv checksum"
  rm -rf "$stage"
  exit 1
fi
expected=$(awk 'NR == 1 { print $1 }' "$stage/checksums")
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
if ! tar -xzf "$stage/$archive" --strip-components=1 -C "$stage/root/bin"; then
  dep_log "could not unpack $archive"
  rm -rf "$stage"
  exit 1
fi
rm -f "$stage/$archive"

# Verify the staged tree before anything can become `current`.
for cmd in uv uvx; do
  if [ ! -x "$stage/root/bin/$cmd" ]; then
    dep_log "uv $ver unpacked but bin/$cmd is missing or not executable"
    rm -rf "$stage"
    exit 1
  fi
done
if ! output=$("$stage/root/bin/uv" --version); then
  dep_log "uv $ver unpacked but bin/uv does not run on this platform"
  rm -rf "$stage"
  exit 1
fi
# `uv --version` prints "uv 0.12.9 (<commit> <date>)" or "uv 0.12.9 (<triple>)".
actual=$(printf '%s\n' "$output" | sed -n 's/^uv \([^ ]*\).*/\1/p' | head -n 1)
if [ "$actual" != "$ver" ]; then
  dep_log "installed version '$actual' does not match '$ver'"
  rm -rf "$stage"
  exit 1
fi

if ! "$stage/root/bin/uvx" --version >/dev/null 2>&1; then
  dep_log "uv $ver installed but uvx does not run"
  rm -rf "$stage"
  exit 1
fi

bin="$MEMOH_DEP_HOME/current/bin"
dep_result "{\"version\":\"$actual\",\"entrypoints\":{\"uv\":\"$bin/uv\",\"uvx\":\"$bin/uvx\"}}"
commit_staged "$stage/root" "${MEMOH_DEP_INSTALL_DIR:-$versions/$actual}"
rm -rf "$stage" || dep_log "Could not remove staging directory $stage"
