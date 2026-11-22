# shellcheck shell=sh
# Remove all managed Antigravity versions. The runner supplies set -eu,
# dep_log and dep_result; its lock and result file live outside this home.
# Google account credentials and user configuration are not stored here.

case "$MEMOH_DEP_HOME" in
  "" | / | */ )
    dep_log "refusing to remove suspicious MEMOH_DEP_HOME '$MEMOH_DEP_HOME'"
    exit 1
    ;;
esac

dep_log "Removing $MEMOH_DEP_ID from $MEMOH_DEP_HOME"
rm -rf "$MEMOH_DEP_HOME"
dep_result '{}'
