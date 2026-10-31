#!/usr/bin/env bash
# supervise.sh SOURCE BASE_COMMIT NEW_RUN_DIR QUEUE
# Queue: LANE|WORKDIR|SCRATCH|PORT|BRIEF[|BRIEF...], absolute fresh paths.
# Bash 3.2, no installs/network; only local clones and already installed dependencies/pi.
set -eu
umask 077
[ $# -eq 4 ] || { echo 'usage: supervise.sh SOURCE BASE_COMMIT NEW_RUN_DIR QUEUE' >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
SOURCE=$(cd "$1" && pwd -P); COMMIT=$(git -C "$SOURCE" rev-parse --verify "$2^{commit}")
RUN=$3; QUEUE=$4
MAX=${PI_LANES_MAX:-2}; MIN=${PI_LANES_MIN_FREE_KB:-1048576}; POLL=${PI_LANES_POLL:-2}
PORT=${PI_BRIDGE_PORT:-5190}
for NUM in "$MAX" "$POLL" "$PORT"; do
  case "$NUM" in ''|0*|*[!0-9]*) echo 'invalid positive integer configuration' >&2; exit 2;; esac
done
case "$MIN" in ''|*[!0-9]*) echo 'invalid disk threshold' >&2; exit 2;; esac
[ "$PORT" -le 65535 ] || exit 2
[ ! -e "$RUN" ] || { echo 'refusing existing run directory' >&2; exit 2; }
ROWS=$(python3 "$HERE/lane-setup.py" validate "$QUEUE" "$PORT")
# Resolve real executables BEFORE putting wrappers on PATH; no user-path assumptions.
export BGT_REAL_NPM=${BGT_REAL_NPM:-$(command -v npm)} BGT_REAL_NPX=${BGT_REAL_NPX:-$(command -v npx)}
export PI_BRIDGE_PORT="$PORT" PI_BRIDGE_RUN_ID="supervisor-$$-$(date +%s)"
mkdir -p "$RUN/results"; RUN=$(cd "$RUN" && pwd -P)
printf '%s\n' "$ROWS" > "$RUN/queue"
node "$HERE/bridge/server.mjs" "$RUN/bridge" > "$RUN/bridge.log" 2>&1 &
BRIDGE_PID=$!; printf '%s\n' "$BRIDGE_PID" > "$RUN/bridge.pid"
sleep 1
kill -0 "$BRIDGE_PID" 2>/dev/null || { echo 'bridge startup failed' >&2; exit 2; }
node "$HERE/bridge/cli.mjs" supervisor-started || { kill "$BRIDGE_PID"; exit 2; }
LANES=(); WORKS=(); SCRATCHES=(); PIDS=(); STATES=()
while IFS='|' read -r LANE WORK SCRATCH PORT BRIEFS; do
  LANES+=("$LANE"); WORKS+=("$WORK"); SCRATCHES+=("$SCRATCH"); PIDS+=(''); STATES+=(queued)
done < "$RUN/queue"
TOTAL=${#LANES[@]}; NEXT=0; ACTIVE=0; DONE=0; RESULT=0; STOP=''
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$RUN/supervisor.log"; }
trap 'STOP=signal' TERM INT
record() {
  python3 "$HERE/lane-setup.py" result "$RUN/results/${LANES[$1]}.json" "${LANES[$1]}" "$2" "$3"
  log "${LANES[$1]} exit=$2 reason=$3"
  STATES[$1]=done; DONE=$((DONE+1))
  [ "$2" = 0 ] || RESULT=1
}
disk_ok() {
  # Check every destination's filesystem, including queued lanes on another volume.
  for DEST in "$RUN" "${WORKS[@]}" "${SCRATCHES[@]}"; do
    while [ ! -d "$DEST" ]; do DEST=$(dirname "$DEST"); done
    FREE=$(df -Pk "$DEST" | awk 'END {print $4}')
    case "$FREE" in ''|*[!0-9]*) return 1;; esac
    [ "$FREE" -ge "$MIN" ] || return 1
  done
}
finalize() {
  STATUS=$?
  trap - EXIT
  set +e
  if [ "$DONE" -lt "$TOTAL" ]; then
    # Unexpected setup/IO failures must not strand a model process or skip final-result files.
    I=0
    while [ "$I" -lt "$TOTAL" ]; do
      [ "${STATES[$I]}" != running ] || kill -TERM "${PIDS[$I]}" 2>/dev/null
      I=$((I+1))
    done
    I=0
    while [ "$I" -lt "$TOTAL" ]; do
      if [ "${STATES[$I]}" != done ]; then
        [ "${STATES[$I]}" != running ] || wait "${PIDS[$I]}"
        record "$I" 74 supervisor-failure
      fi
      I=$((I+1))
    done
    RESULT=1
  fi
  [ "$STATUS" = 0 ] || RESULT=1
  log "exit=$RESULT"
  node "$HERE/bridge/cli.mjs" supervisor-ended "$RESULT" || RESULT=1
  exit "$RESULT"
}
trap finalize EXIT
log "start base=$COMMIT lanes=$TOTAL max=$MAX min_free_kb=$MIN"
while [ "$DONE" -lt "$TOTAL" ]; do
  disk_ok || STOP=disk
  if [ -n "$STOP" ]; then
    log "stop reason=$STOP"
    I=0
    while [ "$I" -lt "$TOTAL" ]; do
      if [ "${STATES[$I]}" = running ]; then kill -TERM "${PIDS[$I]}" 2>/dev/null || true; fi
      I=$((I+1))
    done
    I=0
    while [ "$I" -lt "$TOTAL" ]; do
      if [ "${STATES[$I]}" != done ]; then
        if [ "${STATES[$I]}" = running ]; then wait "${PIDS[$I]}" || true; fi
        CODE=143; [ "$STOP" != disk ] || CODE=73
        record "$I" "$CODE" "$STOP"
      fi
      I=$((I+1))
    done
    break
  fi
  while [ "$NEXT" -lt "$TOTAL" ] && [ "$ACTIVE" -lt "$MAX" ]; do
    I=$NEXT; NEXT=$((NEXT+1))
    ROW=$(awk -v n="$((I+1))" 'NR==n {print; exit}' "$RUN/queue")
    python3 "$HERE/process-runner.py" bash "$HERE/lane-job.sh" "$SOURCE" "$COMMIT" "$ROW" > "$RUN/${LANES[$I]}.log" 2>&1 &
    PIDS[$I]=$!; STATES[$I]=running; ACTIVE=$((ACTIVE+1))
    log "${LANES[$I]} started pid=${PIDS[$I]}"
  done
  I=0
  while [ "$I" -lt "$TOTAL" ]; do
    if [ "${STATES[$I]}" = running ] && ! kill -0 "${PIDS[$I]}" 2>/dev/null; then
      CODE=0; wait "${PIDS[$I]}" || CODE=$?
      record "$I" "$CODE" exited; ACTIVE=$((ACTIVE-1))
    fi
    I=$((I+1))
  done
  if [ "$DONE" -lt "$TOTAL" ]; then
    sleep "$POLL" &
    # Wait in the foreground so traps run promptly during the polling sleep.
    wait $! 2>/dev/null || true
  fi
done
# EXIT finalizer publishes only after every driver has been reaped.
# Deliberately keep the bridge alive for final review; stop bridge.pid after inspection.
exit "$RESULT"
