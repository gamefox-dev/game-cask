#!/usr/bin/env bash
# Shared npm/npx gate. macOS/BSD lockf; fail closed for heavy work without lockf.
#
# Heavy commands run at most N at a time (slot = one lockf lock file). Waiters are served strictly FIFO: each takes a
# ticket (<seconds>.<microseconds>-<pid>) in "$PREFIX-queue", and only the oldest live ticket may try the slots. The
# ticket is deleted by the command itself the moment it holds a slot, so the next waiter becomes head immediately.
# Tickets of dead waiters (pid gone, or pid reused by a process with a different start time) are removed on every loop.
# The slot count is re-read every loop: $BGT_HEAVY_SLOTS_FILE (default "$PREFIX-slots", one integer) overrides
# $BGT_HEAVY_SLOTS (default 2), so an operator can retune a busy machine without restarting waiters.
set -u
if [ "${1:-}" = --execute ]; then
  shift; RESULT=$1; shift
  [ -z "${BGT_HEAVY_TICKET:-}" ] || rm -f "$BGT_HEAVY_TICKET"
  unset BGT_HEAVY_TICKET
  export BGT_HEAVY_HELD=1
  "$@"; RC=$?
  printf '%s\n' "$RC" > "$RESULT" || exit 74
  exit "$RC"
fi
NAME=$1; shift
case "$NAME" in npm) REAL=${BGT_REAL_NPM:-};; npx) REAL=${BGT_REAL_NPX:-};; *) exit 2;; esac
HERE=$(cd "$(dirname "$0")" && pwd -P)
if [ -z "$REAL" ]; then
  # Search PATH without this shim. Supervisor normally supplies absolute real paths.
  OLDIFS=$IFS; IFS=:; read -r -a DIRS <<< "$PATH"; IFS=$OLDIFS
  for DIR in "${DIRS[@]}"; do
    [ -n "$DIR" ] || DIR=.
    [ -d "$DIR" ] || continue
    [ "$(cd "$DIR" && pwd -P)" != "$HERE" ] || continue
    if [ -x "$DIR/$NAME" ]; then REAL="$DIR/$NAME"; break; fi
  done
fi
[ -n "$REAL" ] && [ -x "$REAL" ] || { echo "missing real $NAME" >&2; exit 2; }
case "$REAL" in "$HERE/"*) echo 'recursive heavy shim configuration' >&2; exit 2;; esac
# Is this npm/npx invocation heavy? Decided from the parsed subcommand / script / executable, never from substrings of
# arbitrary arguments (so `npm install vitest`, `npm view @playwright/test` or `npm run typecheck` pass straight through).
heavy_name() { # script names: test, build, lint, oracle, bench, probe, with optional :suffix variants
  case "$1" in
    test|test:*|build|build:*|lint|lint:*|oracle|oracle:*|bench|bench:*|probe|probe:*) return 0;;
  esac
  return 1
}
heavy_exe() { # executables, by basename
  case "${1##*/}" in playwright|vitest|eslint) return 0;; esac
  return 1
}
is_heavy() {
  local tool=$1 sub= mode= skip=0 dd=0 arg
  shift
  for arg in "$@"; do
    if [ "$skip" = 1 ]; then skip=0; continue; fi
    if [ "$dd" = 0 ]; then
      case "$arg" in
        --) dd=1; continue;;
        --prefix|-C|--workspace|-w|--loglevel|--userconfig|--cache|--package|-p|--call|-c|--registry) skip=1; continue;;
        -*) continue;;
      esac
    fi
    if [ "$tool" = npx ]; then heavy_exe "$arg"; return; fi
    if [ -z "$sub" ]; then
      sub=$arg
      case "$sub" in
        test|tst|t) return 0;;
        run|run-script|rum|urn) mode=script;;
        exec|x) mode=exe;;
        *) return 1;;
      esac
      continue
    fi
    if [ "$mode" = script ]; then heavy_name "$arg"; return; fi
    heavy_exe "$arg"; return
  done
  return 1
}

if [ "${BGT_HEAVY_CLASSIFY:-}" = 1 ]; then # test hook: print the verdict without running or gating anything
  if is_heavy "$NAME" "$@"; then echo heavy; else echo light; fi
  exit 0
fi
if ! is_heavy "$NAME" "$@" || [ "${BGT_HEAVY_HELD:-}" = 1 ]; then exec "$REAL" "$@"; fi

slots() { # current slot count: file override, else env, else 2; invalid -> exit 2
  local n=
  [ -r "$SLOTS_FILE" ] && read -r n < "$SLOTS_FILE" 2>/dev/null
  [ -n "$n" ] || n=${BGT_HEAVY_SLOTS:-2}
  case "$n" in ''|0*|*[!0-9]*) echo 'invalid BGT_HEAVY_SLOTS' >&2; return 1;; esac
  echo "$n"
}
PREFIX=${BGT_HEAVY_LOCK_PREFIX:-/private/tmp/bgt-heavy-v1}
case "$PREFIX" in /private/tmp/*) ;; *) echo 'heavy locks must be under /private/tmp' >&2; exit 2;; esac
SLOTS_FILE=${BGT_HEAVY_SLOTS_FILE:-$PREFIX-slots}
slots > /dev/null || exit 2
[ -x /usr/bin/lockf ] || { echo 'heavy gate requires /usr/bin/lockf; refusing ungated command' >&2; exit 2; }
QUEUE=$PREFIX-queue
mkdir -p "$QUEUE" || exit 2

now() { perl -MTime::HiRes=gettimeofday -e '($s,$u)=gettimeofday; printf "%010d.%06d", $s, $u' 2>/dev/null || printf '%010d.000000' "$(date +%s)"; }
started() { ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'; } # process start time, guards against pid reuse

RESULT=$(mktemp /private/tmp/bgt-heavy-result.XXXXXX) || exit 2
TICKET=$QUEUE/$(now)-$$
cleanup() { rm -f "$RESULT" "$TICKET"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
started $$ > "$TICKET" || exit 2

# Remove tickets whose waiter is gone; print the oldest remaining ticket name.
oldest() {
  local t pid want have head=
  for t in $(LC_ALL=C ls "$QUEUE" 2>/dev/null | LC_ALL=C sort); do
    pid=${t##*-}
    want=$(cat "$QUEUE/$t" 2>/dev/null)
    have=$(started "$pid")
    if [ -z "$have" ] || { [ -n "$want" ] && [ "$want" != "$have" ]; }; then rm -f "$QUEUE/$t"; continue; fi
    head=$t; break
  done
  echo "$head"
}

while :; do
  N=$(slots) || exit 2
  if [ "$(oldest)" = "${TICKET##*/}" ]; then
    I=1
    while [ "$I" -le "$N" ]; do
      BGT_HEAVY_TICKET=$TICKET /usr/bin/lockf -s -k -t 0 "$PREFIX-slot-$I.lock" bash "$HERE/heavy.sh" --execute "$RESULT" "$REAL" "$@"
      RC=$?
      # EX_TEMPFAIL (75) can be the real command's exit too; only the marker disambiguates.
      if [ -s "$RESULT" ]; then read -r RC < "$RESULT"; exit "$RC"; fi
      [ "$RC" = 75 ] || exit "$RC"
      I=$((I+1))
    done
  fi
  sleep 0.2
done
