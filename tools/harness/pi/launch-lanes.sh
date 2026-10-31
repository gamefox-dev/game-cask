#!/usr/bin/env bash
# launch-lanes.sh SOURCE RUN_DIR MANIFEST [COMMON_BRIEF ...]
# MANIFEST: LANE|E2E_PORT|BRIEF_PATH (absolute paths; no pipes/newlines in paths).
# Existing pi + dependencies required. No network install, no pushes, no global pi writes.
set -eu
umask 077
[ $# -ge 3 ] || { echo 'usage: launch-lanes.sh SOURCE RUN_DIR MANIFEST [COMMON_BRIEF ...]' >&2; exit 2; }
SOURCE=$(cd "$1" && pwd -P)
RUN=$2; MANIFEST=$3; shift 3
HERE=$(cd "$(dirname "$0")" && pwd)
COMMIT=$(git -C "$SOURCE" rev-parse HEAD)
PI_BRIDGE_PORT=${PI_BRIDGE_PORT:-5190}
case "$PI_BRIDGE_PORT" in ''|0*|*[!0-9]*) echo 'invalid bridge port (no leading zeros)' >&2; exit 2;; esac
[ "$PI_BRIDGE_PORT" -le 65535 ] || { echo 'invalid bridge port' >&2; exit 2; }
export PI_BRIDGE_PORT
[ ! -e "$RUN" ] || { echo "refusing existing run directory: $RUN" >&2; exit 2; }
mkdir -p "$RUN"; RUN=$(cd "$RUN" && pwd -P)
# Validate the whole manifest before launching anything (bash 3.2; no associative arrays).
LANES='|'; PORTS='|'; COUNT=0
while IFS='|' read -r LANE PORT BRIEF || [ -n "${LANE:-}" ]; do
  case "$LANE" in ''|'#'*) continue;; esac
  case "$LANE" in *[!A-Za-z0-9_.-]*|[!A-Za-z0-9]*) echo 'invalid lane id' >&2; exit 2;; esac
  [ "${#LANE}" -le 64 ] || { echo 'lane id too long' >&2; exit 2; }
  case "$PORT" in ''|0*|*[!0-9]*) echo 'invalid port (no leading zeros)' >&2; exit 2;; esac
  [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || exit 2
  [ "$PORT" != "${PI_BRIDGE_PORT:-5190}" ] || { echo 'lane port conflicts with bridge' >&2; exit 2; }
  case "$LANES" in *"|$LANE|"*) echo 'duplicate lane' >&2; exit 2;; esac
  case "$PORTS" in *"|$PORT|"*) echo 'duplicate port' >&2; exit 2;; esac
  [ -s "$BRIEF" ] || { echo "missing brief: $BRIEF" >&2; exit 2; }
  LANES="$LANES$LANE|"; PORTS="$PORTS$PORT|"; COUNT=$((COUNT+1))
done < "$MANIFEST"
[ "$COUNT" -gt 0 ] || { echo 'empty manifest' >&2; exit 2; }
for BRIEF in "$@"; do [ -s "$BRIEF" ] || { echo "missing brief: $BRIEF" >&2; exit 2; }; done
node "$HERE/bridge/server.mjs" "$RUN/bridge" > "$RUN/bridge.log" 2>&1 &
BRIDGE_PID=$!
printf '%s\n' "$BRIDGE_PID" > "$RUN/bridge.pid"
# Fail before any lane starts if the bridge cannot bind. Never attach to a different run's server.
sleep 1
kill -0 "$BRIDGE_PID" 2>/dev/null || { echo "bridge startup failed: $RUN/bridge.log" >&2; exit 2; }
trap 'kill "$BRIDGE_PID" 2>/dev/null || true' EXIT
while IFS='|' read -r LANE PORT BRIEF || [ -n "${LANE:-}" ]; do
  case "$LANE" in ''|'#'*) continue;; esac
  WORK="$RUN/lane-$LANE"; SCRATCH="$RUN/scratch-$LANE"
  mkdir -p "$SCRATCH"
  git clone --quiet --no-hardlinks --no-local "$SOURCE" "$WORK"
  git -C "$WORK" remote remove origin
  git -C "$WORK" checkout -q -b "${PI_LANE_BRANCH_PREFIX:-bridge}/$LANE" "$COMMIT"
  # Copy installed dependencies, not shared writable caches or Git objects. No npm install/network activity.
  if [ -d "$SOURCE/node_modules" ]; then
    mkdir -p "$WORK/node_modules"
    for DEP in "$SOURCE/node_modules"/* "$SOURCE/node_modules"/.[!.]*; do
      [ -e "$DEP" ] || continue
      [ "$(basename "$DEP")" != .cache ] || continue
      cp -R "$DEP" "$WORK/node_modules/"
    done
  fi
  { for COMMON in "$@"; do printf '\n'; cat "$COMMON"; done
    printf '\n'; cat "$BRIEF"; printf '\n'
  } > "$SCRATCH/brief.md"
  # Seed only credentials/provider definitions, never global settings, packages or executable extensions.
  mkdir -p "$SCRATCH/pi-agent"
  if [ -n "${PI_LANES_AGENT_SEED:-}" ]; then
    for CONFIG in auth.json models.json; do
      [ ! -f "$PI_LANES_AGENT_SEED/$CONFIG" ] || cp "$PI_LANES_AGENT_SEED/$CONFIG" "$SCRATCH/pi-agent/$CONFIG"
    done
  fi
  DRIVER="$HERE/sandboxed-pi.sh"
  [ "${PI_LANES_SANDBOX:-1}" = 1 ] || DRIVER="$HERE/run-pi.sh"
  (
    export PI_BRIDGE=1 PI_LANE="$LANE" BGT_E2E_PORT="$PORT" BGT_TRIAL_SCRATCH="$SCRATCH"
    export PI_CODING_AGENT_DIR="$SCRATCH/pi-agent"
    "$DRIVER" "$WORK" "$SCRATCH/brief.md" "$SCRATCH/result.txt" > "$SCRATCH/driver.log" 2>&1
  ) &
  PID=$!
  printf '%s\n' "$PID" > "$SCRATCH/driver.pid"
  printf '%s pid=%s port=%s scratch=%s\n' "$LANE" "$PID" "$PORT" "$SCRATCH"
done < "$MANIFEST"
# The reviewer wakes through bridge wait; launcher remains a background job until all children finish.
trap - EXIT
RESULT=0
for PIDFILE in "$RUN"/scratch-*/driver.pid; do
  read -r PID < "$PIDFILE"
  wait "$PID" || RESULT=1
done
# Leave the bridge running for answers/status/fork queries; reviewer stops bridge.pid explicitly.
exit "$RESULT"
