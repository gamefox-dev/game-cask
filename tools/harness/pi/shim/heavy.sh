#!/usr/bin/env bash
# Shared npm/npx gate. macOS/BSD lockf; fail closed for heavy work without lockf.
set -u
if [ "${1:-}" = --execute ]; then
  shift; RESULT=$1; shift
  export BGT_HEAVY_HELD=1
  "$@"; RC=$?
  printf '%s\n' "$RC" > "$RESULT"
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
HEAVY=0
for ARG in "$@"; do
  case "$ARG" in *test*|*build*|*oracle*|*playwright*|*lint*|*bench*|*probe*) HEAVY=1;; esac
done
if [ "$HEAVY" = 0 ] || [ "${BGT_HEAVY_HELD:-}" = 1 ]; then exec "$REAL" "$@"; fi
N=${BGT_HEAVY_SLOTS:-2}
case "$N" in ''|0*|*[!0-9]*) echo 'invalid BGT_HEAVY_SLOTS' >&2; exit 2;; esac
[ -x /usr/bin/lockf ] || { echo 'heavy gate requires /usr/bin/lockf; refusing ungated command' >&2; exit 2; }
PREFIX=${BGT_HEAVY_LOCK_PREFIX:-/private/tmp/bgt-heavy-v1}
case "$PREFIX" in /private/tmp/*) ;; *) echo 'heavy locks must be under /private/tmp' >&2; exit 2;; esac
RESULT=$(mktemp /private/tmp/bgt-heavy-result.XXXXXX) || exit 2
trap 'rm -f "$RESULT"' EXIT
while :; do
  I=1
  while [ "$I" -le "$N" ]; do
    /usr/bin/lockf -s -k -t 0 "$PREFIX-slot-$I.lock" bash "$HERE/heavy.sh" --execute "$RESULT" "$REAL" "$@"
    RC=$?
    # EX_TEMPFAIL (75) can be the real command's exit too; only the marker disambiguates.
    if [ -s "$RESULT" ]; then read -r RC < "$RESULT"; exit "$RC"; fi
    [ "$RC" = 75 ] || exit "$RC"
    I=$((I+1))
  done
  sleep 0.1
done
