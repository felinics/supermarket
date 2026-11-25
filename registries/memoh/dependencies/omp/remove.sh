# shellcheck shell=sh
# Remove OMP's managed executable versions, leaving its user configuration,
# credentials, sessions and native cache outside MEMOH_DEP_HOME untouched.
# The runner supplies set -eu, dep_log and dep_result. The operation lock
# and result file live outside the dependency home.

case "$MEMOH_DEP_HOME" in
  "" | / | */ )
    dep_log "refusing to remove suspicious MEMOH_DEP_HOME '$MEMOH_DEP_HOME'"
    exit 1
    ;;
esac

dep_log "Removing $MEMOH_DEP_ID from $MEMOH_DEP_HOME"
rm -rf "$MEMOH_DEP_HOME"
dep_result '{}'
