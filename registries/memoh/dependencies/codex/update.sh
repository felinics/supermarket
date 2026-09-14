# shellcheck shell=sh
# memoh-storage-layout: isolated
# Install an exact, verified candidate. The runner owns publication and cleanup
# when MEMOH_DEP_INSTALL_DIR is set; older runners retain their version layout.
# dep_log, dep_result and dep_switch are supplied by the runner.

store="${MEMOH_DEP_STORE:-$MEMOH_DEP_HOME}"

pkg="@openai/codex"
cmd="codex"
registry="${NPM_MIRROR:-https://registry.npmjs.org}"
export npm_config_cache="$store/cache/npm"

command -v npm >/dev/null 2>&1 || {
  dep_log "npm is not available on PATH; the node dependency must be present first"
  exit 1
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

# Resolve the request to one exact version first so versions/<version> is
# named after what actually gets installed, also when the request is a
# dist-tag such as "latest".
req="${MEMOH_DEP_VERSION:-latest}"
dep_log "Resolving $pkg@$req against $registry"
ver=$(npm view "$pkg@$req" version --registry "$registry") || ver=""
case "$ver" in
  "" | *[[:space:]]*)
    dep_log "could not resolve $pkg@$req to a single version from $registry"
    exit 1
    ;;
esac

if ! printf '%s\n' "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'; then
  dep_log "registry returned an invalid exact version"
  exit 1
fi

# An exact repair request must never be silently resolved to another release.
if printf '%s\n' "$req" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$' && [ "$req" != "$ver" ]; then
  dep_log "registry resolved exact request '$req' to '$ver'"
  exit 1
fi

versions="$store/versions"
target="${MEMOH_DEP_INSTALL_DIR:-$versions/$ver}"
mkdir -p "$store"
stage="${MEMOH_DEP_STAGING:-}"
if [ -z "$stage" ]; then
  stage=$(mktemp -d "$store/.staging-$MEMOH_DEP_ID.XXXXXX")
fi
mkdir -p "$stage/root"

dep_log "Updating $pkg from ${MEMOH_DEP_CURRENT_VERSION:-unknown} to $ver in $stage"
# Never execute registry-supplied lifecycle scripts with the runner's identity.
# --ignore-scripts also takes precedence over npm strict-allow-scripts policy.
if ! npm install -g --prefix "$stage/root" --include=optional --omit=dev --no-audit --no-fund \
  --ignore-scripts --registry "$registry" "$pkg@$ver"; then
  dep_log "npm install of $pkg@$ver failed"
  rm -rf "$stage"
  exit 1
fi

# Verify the staged tree before anything can become `current`.
if [ ! -x "$stage/root/bin/$cmd" ]; then
  dep_log "$pkg@$ver installed but bin/$cmd is missing or not executable"
  rm -rf "$stage"
  exit 1
fi

if ! output=$("$stage/root/bin/$cmd" --version 2>&1); then
  dep_log "$pkg@$ver installed but bin/$cmd does not run"
  rm -rf "$stage"
  exit 1
fi

actual=$(printf '%s\n' "$output" | awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$/) { print $i; exit } }')
if [ "$actual" != "$ver" ]; then
  dep_log "installed $cmd reports '$actual', expected '$ver'"
  rm -rf "$stage"
  exit 1
fi

dep_result "{\"version\":\"$ver\",\"entrypoints\":{\"$cmd\":\"$MEMOH_DEP_HOME/current/bin/$cmd\"}}"
commit_staged "$stage/root" "$target"
rm -rf "$stage" || dep_log "Could not remove staging directory $stage"
