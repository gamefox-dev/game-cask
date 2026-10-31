#!/usr/bin/env bash
# Compatibility frontend: SOURCE NEW_RUN_DIR MANIFEST [COMMON_BRIEF...]
# Legacy manifest: LANE|PORT|BRIEF. New operators should use supervise.sh directly.
set -eu
[ $# -ge 3 ] || { echo 'usage: launch-lanes.sh SOURCE NEW_RUN_DIR MANIFEST [COMMON_BRIEF ...]' >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
SOURCE=$(cd "$1" && pwd -P); RUN=$2; MANIFEST=$3; shift 3
[ ! -e "$RUN" ] || { echo 'refusing existing run directory' >&2; exit 2; }
mkdir -p "$(dirname "$RUN")"; RUN=$(cd "$(dirname "$RUN")" && pwd -P)/$(basename "$RUN")
QUEUE=$(mktemp); trap 'rm -f "$QUEUE"' EXIT
for COMMON in "$@"; do [ -s "$COMMON" ] || { echo 'missing common brief' >&2; exit 2; }; done
while IFS='|' read -r LANE PORT BRIEF || [ -n "${LANE:-}" ]; do
  case "$LANE" in ''|'#'*) continue;; esac
  case "$PORT" in ''|0*|*[!0-9]*) echo 'invalid port (no leading zeros)' >&2; exit 2;; esac
  printf '%s|%s/lane-%s|%s/scratch-%s|%s' "$LANE" "$RUN" "$LANE" "$RUN" "$LANE" "$PORT" >> "$QUEUE"
  for COMMON in "$@"; do printf '|%s' "$COMMON" >> "$QUEUE"; done
  printf '|%s\n' "$BRIEF" >> "$QUEUE"
done < "$MANIFEST"
export PI_LANE_BRANCH_PREFIX=${PI_LANE_BRANCH_PREFIX:-bridge}
RC=0
bash "$HERE/supervise.sh" "$SOURCE" HEAD "$RUN" "$QUEUE" || RC=$?
if [ -d "$RUN/results" ]; then
  for FINAL in "$RUN"/results/*.json; do printf '%s\n' "$FINAL"; done
fi
exit "$RC"
