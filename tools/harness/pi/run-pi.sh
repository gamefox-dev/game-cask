#!/usr/bin/env bash
# run-pi.sh WORKDIR PROMPT_FILE OUT_FILE — process-owned lifecycle and provider retry.
# PI_MAX_ATTEMPTS (default 1, includes initial attempt); PI_RETRY_BACKOFF (seconds, default 30).
# Each retry forks the last attempt's session, never overwrites OUT.d; see docs/trials.md.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
exec python3 "$HERE/driver.py" "$@"
