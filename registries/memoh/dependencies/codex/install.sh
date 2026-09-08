# shellcheck shell=sh
# Install @openai/codex into a fresh versions/<version> directory, then switch `current`.
#
# The body runs inside the runner's prelude: `set -eu` is
# already active and dep_log / dep_result / dep_switch are provided; do not
# redefine them. Environment: MEMOH_DEP_HOME, MEMOH_DEP_VERSION (empty or
# "latest" selects the newest published release; anything else is handed to
# npm as the version spec), MEMOH_DEP_RESULT, NPM_MIRROR.
# Never hard-code the workspace data mount path.

pkg="@openai/codex"
cmd="codex"
registry="${NPM_MIRROR:-https://registry.npmjs.org}"
export npm_config_cache="$MEMOH_DEP_HOME/cache/npm"

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

versions="$MEMOH_DEP_HOME/versions"
target="$versions/$ver"
stage="$versions/.staging-$MEMOH_DEP_ID.$$"
rm -rf "$versions/.staging-$MEMOH_DEP_ID."*
mkdir -p "$stage/root"

dep_log "Installing $pkg@$ver into $stage"
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

if ! "$stage/root/bin/$cmd" --version >/dev/null 2>&1; then
  dep_log "$pkg@$ver installed but bin/$cmd does not run"
  rm -rf "$stage"
  exit 1
fi

dep_result "{\"version\":\"$ver\",\"entrypoints\":{\"$cmd\":\"$MEMOH_DEP_HOME/current/bin/$cmd\"}}"
commit_staged "$stage/root" "$target"
rm -rf "$stage" || dep_log "Could not remove staging directory $stage"
