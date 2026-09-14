# shellcheck shell=sh
# memoh-storage-layout: isolated
# Install an exact, verified candidate. The runner owns publication and cleanup
# when MEMOH_DEP_INSTALL_DIR is set; older runners retain their version layout.
# dep_log, dep_result and dep_switch are supplied by the runner.

store="${MEMOH_DEP_STORE:-$MEMOH_DEP_HOME}"

export UV_CACHE_DIR="$store/cache/uv"

command -v uv >/dev/null 2>&1 || {
  dep_log "uv is not available on PATH; the uv dependency must be present first"
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

# `uv python list --only-downloads [REQUEST]` prints one downloadable build per
# line for this platform, newest first, e.g. `cpython-3.14.7-linux-aarch64-gnu`.
# Variant builds carry a +suffix (freethreaded, debug) and pre-releases an
# rc/a/b marker. Resolving here instead of letting `uv python install` choose
# names versions/<version> after the exact release up front and keeps
# pre-releases out of "latest" explicitly; they install only when requested by
# name.
req="${MEMOH_DEP_VERSION:-}"
if printf '%s\n' "$req" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+[0-9a-z]*$'; then
  ver="$req"
elif [ -z "$req" ] || [ "$req" = latest ]; then
  dep_log "Resolving the latest stable CPython release known to uv"
  ver=$(uv python list --only-downloads \
    | sed -n 's/^cpython-\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)-.*/\1/p' | head -n 1)
elif printf '%s\n' "$req" | grep -Eq '^[0-9]+(\.[0-9]+){0,2}$'; then
  dep_log "Resolving stable CPython $req against uv's download list"
  ver=$(uv python list --only-downloads "$req" \
    | sed -n 's/^cpython-\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)-.*/\1/p' | head -n 1)
else
  dep_log "Resolving CPython $req against uv's download list"
  ver=$(uv python list --only-downloads "$req" \
    | sed -n 's/^cpython-\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[0-9a-z]*\)-.*/\1/p' | head -n 1)
fi
if [ -z "$ver" ]; then
  dep_log "uv knows no downloadable CPython matching '${req:-latest}' for this platform"
  exit 1
fi

versions="$store/versions"
mkdir -p "$store"
stage="${MEMOH_DEP_STAGING:-}"
if [ -z "$stage" ]; then
  stage=$(mktemp -d "$store/.staging-$MEMOH_DEP_ID.XXXXXX")
fi
mkdir -p "$stage/root/bin"

dep_log "Updating CPython from ${MEMOH_DEP_CURRENT_VERSION:-unknown} to $ver in $stage with uv"
# --no-bin keeps uv from linking python3.x into ~/.local/bin: the overlay must
# stay inside MEMOH_DEP_HOME.
if ! uv python install --install-dir "$stage/root/uv" --no-bin "$ver"; then
  dep_log "uv python install $ver failed"
  rm -rf "$stage"
  exit 1
fi

# uv lays the interpreter out as <install-dir>/cpython-<version>-<platform>/
# next to an absolute minor-version symlink. Drop the symlink (it would dangle
# once the tree moves) and collect the entry points under bin/ as relative
# links so the whole tree stays relocatable.
root=""
for dir in "$stage/root/uv/cpython-$ver-"*; do
  if [ -d "$dir" ] && [ ! -L "$dir" ]; then
    root="$dir"
    break
  fi
done
if [ -z "$root" ] || [ ! -x "$root/bin/python3" ]; then
  dep_log "uv installed CPython $ver but no cpython-$ver-* directory with bin/python3 appeared"
  rm -rf "$stage"
  exit 1
fi
for link in "$stage/root/uv"/cpython-*; do
  if [ -L "$link" ]; then rm -f "$link"; fi
done
rel="${root#"$stage/root/"}"
for file in "$root"/bin/*; do
  name="${file##*/}"
  ln -s "../$rel/bin/$name" "$stage/root/bin/$name"
done
if [ ! -e "$stage/root/bin/pip3" ]; then
  # pip is bundled with the standalone builds; fall back to `python3 -m pip`.
  # shellcheck disable=SC2016
  printf '#!/bin/sh\nexec "$(dirname -- "$0")/python3" -m pip "$@"\n' > "$stage/root/bin/pip3"
  chmod 755 "$stage/root/bin/pip3"
fi

# Verify the staged tree before anything can become `current`.
if ! output=$("$stage/root/bin/python3" --version 2>&1); then
  dep_log "CPython $ver installed but bin/python3 does not run: $output"
  rm -rf "$stage"
  exit 1
fi
# `python3 --version` prints "Python 3.14.7".
actual=$(printf '%s\n' "$output" | sed -n 's/^Python \([0-9][0-9a-z.]*\).*/\1/p' | head -n 1)
if [ "$actual" != "$ver" ]; then
  dep_log "installed version '$actual' does not match '$ver'"
  rm -rf "$stage"
  exit 1
fi
if ! "$stage/root/bin/pip3" --version >/dev/null 2>&1; then
  dep_log "CPython $ver installed but bin/pip3 does not run"
  rm -rf "$stage"
  exit 1
fi

bin="$MEMOH_DEP_HOME/current/bin"
dep_result "{\"version\":\"$actual\",\"entrypoints\":{\"python3\":\"$bin/python3\",\"pip3\":\"$bin/pip3\"}}"
commit_staged "$stage/root" "${MEMOH_DEP_INSTALL_DIR:-$versions/$actual}"
rm -rf "$stage" || dep_log "Could not remove staging directory $stage"
