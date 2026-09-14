# shellcheck shell=sh
# Remove every installed version of Git by deleting the dependency home.
#
# The body runs inside the runner's prelude: `set -eu` is
# already active and dep_log / dep_result are provided; do not redefine them.
# MEMOH_DEP_HOME is computed by the Server per target; the lock
# and the result file live outside it, so deleting it is safe.

# A new runner validates the saved payload path and removes it only after the
# operation commits. Leave current, receipts and persistent metadata intact.
if [ -z "${MEMOH_DEP_INSTALL_DIR:-}" ]; then
  case "$MEMOH_DEP_HOME" in
    "" | / | */ )
      dep_log "refusing to remove suspicious MEMOH_DEP_HOME '$MEMOH_DEP_HOME'"
      exit 1
      ;;
  esac

  dep_log "Removing $MEMOH_DEP_ID from $MEMOH_DEP_HOME"
  rm -rf "$MEMOH_DEP_HOME"
fi
dep_result '{}'
