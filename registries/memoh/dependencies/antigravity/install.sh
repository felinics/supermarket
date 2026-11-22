# shellcheck shell=sh
# Install or update the official Antigravity CLI in versions/<version>.
# The runner supplies set -eu, dep_log, dep_result and dep_switch.
# MEMOH_DEP_VERSION is empty/latest or an exact release; MEMOH_DEP_OS,
# MEMOH_DEP_ARCH and MEMOH_DEP_LIBC select the native build. Never run the
# upstream bootstrapper or `agy install`, which change user shell settings.

api="https://api.github.com/repos/google-antigravity/antigravity-cli/releases"
downloads="https://github.com/google-antigravity/antigravity-cli/releases/download"
case "$MEMOH_DEP_ARCH" in
  amd64) arch=x64 ;;
  arm64) arch=arm64 ;;
  *) dep_log "unsupported Antigravity architecture: $MEMOH_DEP_ARCH"; exit 1 ;;
esac
case "$MEMOH_DEP_OS" in
  linux)
    case "${MEMOH_DEP_LIBC:-glibc}" in
      glibc) platform="linux_$arch" ;;
      musl) platform="linux_${arch}_musl" ;;
      *) dep_log "unsupported Antigravity Linux libc"; exit 1 ;;
    esac
    ;;
  darwin) platform="mac_$arch" ;;
  *) dep_log "unsupported Antigravity OS: $MEMOH_DEP_OS"; exit 1 ;;
esac
asset="agy_cli_$platform.tar.gz"

fetch() {
  curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 "$@"
}

valid_version() {
  case "$1" in "" | *[[:space:]]*) return 1 ;; esac
  printf '%s\n' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
}

# Read simple, unescaped scalar fields from GitHub's JSON. Release asset
# names, versions, digests and HTTPS URLs use this restricted representation.
json_string() {
  tr '\n' ' ' | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"\\]*\)".*/\1/p'
}

# Select exactly one asset object without requiring Node, Python or jq.
# Track quoted strings and escapes so braces in release notes or uploader
# URLs do not affect nesting. Both compact and pretty GitHub JSON work.
asset_object() {
  awk -v wanted="$asset" '
    {
      for (i = 1; i <= length($0); i++) {
        c = substr($0, i, 1)
        if (!quoted && c == "{") {
          depth++
          if (depth == 2) object = ""
        }
        if (depth >= 2) object = object c
        if (quoted) {
          if (escaped) escaped = 0
          else if (c == "\\") escaped = 1
          else if (c == "\"") quoted = 0
        } else if (c == "\"") quoted = 1
        else if (c == "}") {
          if (depth == 2 && match(object, /"name"[[:space:]]*:[[:space:]]*"[^"]*"/)) {
            name = substr(object, RSTART, RLENGTH)
            sub(/^"name"[[:space:]]*:[[:space:]]*"/, "", name)
            sub(/"$/, "", name)
            if (name == wanted) { selected = object; count++ }
          }
          depth--
          if (depth < 0) invalid = 1
        }
      }
      if (depth >= 2) object = object "\n"
    }
    END {
      if (invalid || quoted || depth != 0 || count != 1) exit 1
      print selected
    }
  '
}

# Recover an interrupted replacement before doing any network work.
for saved in "$MEMOH_DEP_HOME/versions/"*.previous-*; do
  [ -d "$saved" ] || continue
  original="${saved%.previous-*}"
  if [ ! -e "$original" ]; then mv "$saved" "$original"; fi
done

# Keep the same result-before-switch and recovery contract as other managed
# dependencies. An already installed release remains usable on failure.
commit_staged() {
  backup="$2.previous-$$"
  if [ -e "$2" ]; then mv "$2" "$backup" || return 1; fi
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
  release_url="$api/latest"
else
  if ! valid_version "$req"; then
    dep_log "Antigravity requires latest or an exact release version"
    exit 1
  fi
  release_url="$api/tags/$req"
fi
dep_log "Resolving Antigravity ${req:-latest} from $release_url"
if ! release=$(fetch "$release_url"); then
  dep_log "could not fetch the official Antigravity release"
  exit 1
fi
ver=$(printf '%s\n' "$release" | json_string tag_name)
if ! valid_version "$ver"; then
  dep_log "invalid Antigravity release version"
  exit 1
fi
if [ -n "$req" ] && [ "$req" != latest ] && [ "$req" != "$ver" ]; then
  dep_log "requested Antigravity $req but release metadata describes $ver"
  exit 1
fi
if ! metadata=$(printf '%s\n' "$release" | asset_object); then
  dep_log "official Antigravity release $ver has no unique asset for $platform"
  exit 1
fi
url=$(printf '%s\n' "$metadata" | json_string browser_download_url)
expected=$(printf '%s\n' "$metadata" | json_string digest)
state=$(printf '%s\n' "$metadata" | json_string state)
if [ "$url" != "$downloads/$ver/$asset" ] || [ "$state" != uploaded ]; then
  dep_log "invalid official Antigravity release asset"
  exit 1
fi
if ! printf '%s\n' "$expected" | grep -Eq '^sha256:[0-9a-fA-F]{64}$'; then
  dep_log "official SHA256 checksum is missing or malformed for $asset"
  exit 1
fi
expected=$(printf '%s' "${expected#sha256:}" | tr 'A-F' 'a-f')

versions="$MEMOH_DEP_HOME/versions"
stage="$versions/.staging-$MEMOH_DEP_ID.$$"
rm -rf "$versions/.staging-$MEMOH_DEP_ID."*
mkdir -p "$stage/root/bin" "$stage/root/libexec"
dep_log "Downloading $url"
if ! fetch -o "$stage/archive.tar.gz" "$url"; then
  dep_log "download of $asset failed"
  rm -rf "$stage"
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  digest=$(sha256sum "$stage/archive.tar.gz" | awk '{ print $1 }')
else
  digest=$(shasum -a 256 "$stage/archive.tar.gz" | awk '{ print $1 }')
fi
if [ "$digest" != "$expected" ]; then
  dep_log "SHA256 mismatch for $asset"
  rm -rf "$stage"
  exit 1
fi

# Extract only the native executable to a file we own, never archive paths.
if ! tar -xOzf "$stage/archive.tar.gz" antigravity > "$stage/root/libexec/agy"; then
  dep_log "could not extract the Antigravity binary"
  rm -rf "$stage"
  exit 1
fi
chmod 755 "$stage/root/libexec/agy"
cat > "$stage/root/bin/agy" <<'SH'
#!/bin/sh
# Memoh owns the version tree; native self-management would invalidate it.
case "${1:-}" in
  install | update)
    printf '%s\n' 'Antigravity is managed by Memoh; use its dependency install/update operation.' >&2
    exit 1
    ;;
esac
export AGY_CLI_DISABLE_AUTO_UPDATE=true
# Resolve both direct entrypoints and symlink shims without readlink -f,
# which is unavailable on older macOS hosts.
agy_launcher=$0
while [ -L "$agy_launcher" ]; do
  agy_dir=$(CDPATH= cd -P "$(dirname "$agy_launcher")" && pwd) || exit 1
  agy_link=$(readlink "$agy_launcher") || exit 1
  case "$agy_link" in
    /*) agy_launcher=$agy_link ;;
    *) agy_launcher=$agy_dir/$agy_link ;;
  esac
done
agy_dir=$(CDPATH= cd -P "$(dirname "$agy_launcher")" && pwd) || exit 1
exec "$agy_dir/../libexec/agy" "$@"
SH
chmod 755 "$stage/root/bin/agy"

if ! actual=$("$stage/root/bin/agy" --version </dev/null); then
  dep_log "Antigravity $ver does not run on this platform"
  rm -rf "$stage"
  exit 1
fi
if [ "$actual" != "$ver" ]; then
  dep_log "Antigravity binary version does not match release $ver"
  rm -rf "$stage"
  exit 1
fi

dep_result "{\"version\":\"$ver\",\"entrypoints\":{\"agy\":\"$MEMOH_DEP_HOME/current/bin/agy\"}}"
commit_staged "$stage/root" "$versions/$ver"
rm -rf "$stage" || dep_log "Could not remove staging directory $stage"
