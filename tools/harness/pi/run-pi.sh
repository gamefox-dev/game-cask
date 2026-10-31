#!/usr/bin/env bash
# run-pi.sh WORKDIR PROMPT_FILE OUT_FILE
#
# Runs the installed pi coding agent on PROMPT_FILE inside WORKDIR.
#   OUT_FILE            final assistant answer (text)
#   OUT_FILE.d/         sessions/ (pi JSONL session), transcript.txt, screen.txt (tui), raw.log (tui), run.json
# Exit codes: 0 done, 2 usage, 3 startup/model check failed, 4 timeout, 5 pi died/failed
#
# Env:
#   PI_DRIVE_MODE   print (default; non-interactive `pi -p`, prompt via stdin) | tui (real TUI in a pty)
#   PI_MODEL        provider/id        (required; no implicit provider)
#   PI_THINKING     off|minimal|low|medium|high|xhigh|max (default high)
#   PI_TIMEOUT      seconds, whole run (default 7200)
#   PI_POLL         tui poll interval seconds (default 5)
#   PI_LEAN=1       (default) disable discovered extensions; PI_PROVIDER_EXTENSION explicitly loads a provider
#                   PI_LEAN=0 loads the user's full extension set (review before use)
#   PI_BIN          pi executable (default pi on PATH)
#   PI_EXTRA_ARGS   extra pi args, e.g. "--no-skills"
#   PI_TUI_SELECT=1 (tui) pick model+thinking via /model and /thinking in the TUI instead of CLI flags
#   PI_BRIDGE=1    load the workspace bridge extension; requires PI_LANE and a running bridge server
#   PI_BRIDGE_PORT localhost bridge port (default 5190); never installs global pi resources
set -u
umask 077
[ $# -eq 3 ] || { sed -n 2,3p "$0"; exit 2; }
WORKDIR=$(cd "$1" && pwd) || exit 2
PROMPT=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); [ -s "$PROMPT" ] || { echo "empty/missing prompt file" >&2; exit 2; }
OUT=$3; mkdir -p "$(dirname "$OUT")"; OUT=$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")
HERE=$(cd "$(dirname "$0")" && pwd)
MODE=${PI_DRIVE_MODE:-print}; MODEL=${PI_MODEL:?set PI_MODEL to provider/id}; THINK=${PI_THINKING:-high}
case "$MODE" in print|tui) ;; *) echo 'PI_DRIVE_MODE must be print or tui' >&2; exit 2;; esac
PI_BIN=${PI_BIN:-pi}
TMO=${PI_TIMEOUT:-7200}; POLL=${PI_POLL:-5}; LEAN=${PI_LEAN:-1}
RUND="$OUT.d"; [ ! -e "$RUND" ] || { echo "refusing to overwrite $RUND" >&2; exit 2; }; mkdir -p "$RUND/sessions"
START=$(date +%s)
log() { echo "[run-pi $(date +%T)] $*" >&2; }

ARGS=(--model "$MODEL" --thinking "$THINK" --session-dir "$RUND/sessions")
if [ "$LEAN" = 1 ]; then
  ARGS+=(--no-extensions --no-mcp)
  [ -n "${PI_PROVIDER_EXTENSION:-}" ] && ARGS+=(-e "$PI_PROVIDER_EXTENSION")
fi
if [ "${PI_BRIDGE:-0}" = 1 ]; then
  : "${PI_LANE:?PI_BRIDGE=1 requires PI_LANE}"
  export PI_LANE PI_BRIDGE
  ARGS+=(-e "$HERE/bridge/extension.js")
  # Shared bridge brief template applies to trial and lane prompts without modifying either source brief.
  { cat "$PROMPT"; printf '\n'; cat "$HERE/bridge/agent-brief.md"; } > "$RUND/bridge-brief.md"
  PROMPT="$RUND/bridge-brief.md"
fi
# shellcheck disable=SC2206
[ -n "${PI_EXTRA_ARGS:-}" ] && ARGS+=($PI_EXTRA_ARGS)

finish() { # $1 = exit code
  if [ "${PI_BRIDGE:-0}" = 1 ]; then
    node "$HERE/bridge/cli.mjs" ended --lane "$PI_LANE" "$1" >> "$RUND/bridge.log" 2>&1 || true
  fi
  python3 "$HERE/pisess.py" final "$RUND/sessions" > "$OUT" 2>/dev/null
  python3 "$HERE/pisess.py" render "$RUND/sessions" > "$RUND/transcript.txt" 2>/dev/null
  printf '{"mode":"%s","model":"%s","thinking":"%s","exit":%s,"seconds":%s}\n' "$MODE" "$MODEL" "$THINK" "$1" $(( $(date +%s) - START )) > "$RUND/run.json"
  log "exit=$1  answer=$OUT  transcript=$RUND/transcript.txt"; exit "$1"
}

if [ "$MODE" = print ]; then
  cd "$WORKDIR" || exit 2
  # prompt via stdin: no quoting/length issues; pi -p exits when the agent loop ends
  python3 -c '
import os,signal,subprocess,sys
p=subprocess.Popen(sys.argv[2:],start_new_session=True)
try: sys.exit(p.wait(timeout=float(sys.argv[1])))
except subprocess.TimeoutExpired:
    os.killpg(p.pid,signal.SIGTERM)
    try: p.wait(timeout=5)
    except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL);p.wait()
    sys.exit(124)
' "$TMO" "$PI_BIN" -p "${ARGS[@]}" < "$PROMPT" > "$RUND/stdout.txt" 2> "$RUND/stderr.txt"
  RC=$?
  [ "$RC" = 124 ] && finish 4
  [ "$RC" = 0 ] && finish 0 || finish 5
fi

# ---------------- tui mode ----------------
SOCK="$RUND/s.sock"; C() { "$HERE/ptyctl.sh" "$SOCK" "$@"; }
python3 "$HERE/ptyd.py" --sock "$SOCK" --cols 200 --rows 50 --cwd "$WORKDIR" --log "$RUND/raw.log" -- "$PI_BIN" "${ARGS[@]}" \
   > "$RUND/ptyd.out" 2>&1 &
DPID=$!
trap 'C quit >/dev/null 2>&1; kill $DPID 2>/dev/null' EXIT
snap() { C snap 2>/dev/null; }
for i in $(seq 1 60); do snap | grep -q -E "\([a-z0-9-]+\) .* • " && break; sleep 1; done
snap > "$RUND/screen-start.txt"
EXPECT_FOOTER="${MODEL%%/*}) ${MODEL#*/} • $THINK"
if [ "${PI_TUI_SELECT:-0}" = 1 ]; then
  C text "/model" >/dev/null; sleep 0.7; C key Enter >/dev/null; sleep 1.5
  C text "$MODEL" >/dev/null; sleep 1; C key Enter >/dev/null; sleep 1.5
  C text "/thinking" >/dev/null; sleep 0.7; C key Enter >/dev/null; sleep 1.5
  C text "$THINK" >/dev/null; sleep 0.7; C key Enter >/dev/null; sleep 1.5
fi
snap | grep -q -F "($EXPECT_FOOTER" || snap | grep -q -F "$EXPECT_FOOTER" || { log "model/thinking footer '($EXPECT_FOOTER' not on screen"; snap > "$RUND/screen.txt"; finish 3; }
log "footer confirmed: $EXPECT_FOOTER"
# paste the prompt (bracketed paste => newlines stay literal), then submit
C paste "$(cat "$PROMPT")" >/dev/null; sleep 1.5
C key Enter >/dev/null
# wait for the session file to contain our user message (proves the prompt was accepted)
for i in $(seq 1 30); do
  python3 "$HERE/pisess.py" state "$RUND/sessions" | grep -q '"user_msgs": [1-9]' && break; sleep 1
done
python3 "$HERE/pisess.py" state "$RUND/sessions" | grep -q '"user_msgs": [1-9]' || { log "prompt not accepted"; snap > "$RUND/screen.txt"; finish 3; }
# done = idle: no "Working" spinner on screen for 2 consecutive polls AND last session message is a finished assistant
# turn (stopReason stop/length/error/aborted) AND session file quiet for >= POLL seconds
QUIET=0
while :; do
  sleep "$POLL"
  [ $(( $(date +%s) - START )) -gt "$TMO" ] && { log "timeout"; snap > "$RUND/screen.txt"; C key Esc >/dev/null; finish 4; }
  case "$(C alive)" in 1*) ;; *) log "pi exited unexpectedly: $(C alive)"; finish 5;; esac
  S=$(snap); ST=$(python3 "$HERE/pisess.py" state "$RUND/sessions")
  if ! grep -q "Working" <<<"$S" && grep -q '"last_role": "assistant"' <<<"$ST" && ! grep -q '"stop_reason": "toolUse"' <<<"$ST" \
       && python3 -c 'import json,sys;sys.exit(0 if json.loads(sys.argv[1])["age_s"]>=float(sys.argv[2]) else 1)' "$ST" "$POLL"; then
    QUIET=$((QUIET+1)); [ "$QUIET" -ge 2 ] && break
  else QUIET=0; fi
done
snap > "$RUND/screen.txt"
C text "/session" >/dev/null; sleep 0.7; C key Enter >/dev/null; sleep 0.7; C key Enter >/dev/null; sleep 1.5; snap > "$RUND/screen-session.txt"
C text "/quit" >/dev/null; sleep 0.7; C key Enter >/dev/null; sleep 0.7; C key Enter >/dev/null; sleep 2
case "$(C alive)" in 0*) log "pi quit cleanly ($(C alive))";; *) log "pi still alive, terminating"; C quit >/dev/null;; esac
finish 0
