#!/usr/bin/env bash
# macOS only. WORKDIR PROMPT_FILE OUT_FILE; require an operator-owned scratch directory.
set -eu
[ $# -eq 3 ] || { echo 'usage: sandboxed-pi.sh WORKDIR PROMPT_FILE OUT_FILE' >&2; exit 2; }
[ -x /usr/bin/sandbox-exec ] || { echo 'sandbox-exec unavailable: use a disposable container/VM; refusing unsandboxed fallback' >&2; exit 2; }
# PI_BRIDGE/PI_LANE/PI_BRIDGE_PORT are inherited unchanged; localhost remains allowed by pi.sb.in.
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(cd "$1" && pwd -P)
SCRATCH=${BGT_TRIAL_SCRATCH:?set BGT_TRIAL_SCRATCH to a fresh operator-owned directory}
mkdir -p "$SCRATCH"; SCRATCH=$(cd "$SCRATCH" && pwd -P)
export GH_CONFIG_DIR="$SCRATCH/empty-gh" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND=false
export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0= GIT_CONFIG_KEY_1=credential.interactive GIT_CONFIG_VALUE_1=never
export ZIG_GLOBAL_CACHE_DIR="$SCRATCH/zig-cache" ZIG_LOCAL_CACHE_DIR="$SCRATCH/zig-cache/local"
export npm_config_cache="$SCRATCH/npm-cache" PYTHONDONTWRITEBYTECODE=1
export PI_TIMEOUT=${PI_TIMEOUT:-43200}
# An isolated agent directory must be provisioned with ONLY the model credentials needed for this run.
export PI_CODING_AGENT_DIR=${PI_CODING_AGENT_DIR:-$SCRATCH/pi-agent}
mkdir -p "$PI_CODING_AGENT_DIR" "$ZIG_GLOBAL_CACHE_DIR" "$ZIG_LOCAL_CACHE_DIR"
AGENT=$(cd "$PI_CODING_AGENT_DIR" && pwd -P)
exec /usr/bin/sandbox-exec -f "$HERE/pi.sb.in" \
  -D "WORK=$WORK" -D "ORIGINAL=$WORK/original" -D "SCRATCH=$SCRATCH" -D "AGENT=$AGENT" -D "CACHE=$SCRATCH" \
  -D "GLOBAL_AGENT=$HOME/.pi/agent" \
  -D "SSH=$HOME/.ssh" -D "GH=$HOME/.config/gh" -D "KEYCHAINS=$HOME/Library/Keychains" \
  -D "GITCONFIG=$HOME/.gitconfig" -D "GITCREDENTIALS=$HOME/.git-credentials" -D "GITDIR=$HOME/.config/git" \
  "$HERE/run-pi.sh" "$@"
