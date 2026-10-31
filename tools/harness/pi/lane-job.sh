#!/usr/bin/env bash
# Internal queue worker. Invoked in its own process group by supervise.sh.
set -eu
umask 077
HERE=$(cd "$(dirname "$0")" && pwd)
SOURCE=$1; COMMIT=$2; ROW=$3
IFS='|' read -r LANE WORK SCRATCH PORT BRIEFS <<< "$ROW"
mkdir -p "$SCRATCH"
git clone --quiet --no-hardlinks --no-local "$SOURCE" "$WORK"
git -C "$WORK" remote remove origin
git -C "$WORK" checkout -q -b "${PI_LANE_BRANCH_PREFIX:-lanes}/$LANE" "$COMMIT"
if [ -d "$SOURCE/node_modules" ]; then
  mkdir -p "$WORK/node_modules"
  for DEP in "$SOURCE/node_modules"/* "$SOURCE/node_modules"/.[!.]*; do
    [ -e "$DEP" ] || continue
    [ "$(basename "$DEP")" != .cache ] || continue
    cp -R "$DEP" "$WORK/node_modules/"
  done
fi
python3 "$HERE/lane-setup.py" seed "${PI_LANES_AGENT_SEED:-}" "$SCRATCH/pi-agent"
: > "$SCRATCH/brief.md"
OLDIFS=$IFS; IFS='|'; read -r -a FILES <<< "$BRIEFS"; IFS=$OLDIFS
for BRIEF in "${FILES[@]}"; do printf '\n' >> "$SCRATCH/brief.md"; cat "$BRIEF" >> "$SCRATCH/brief.md"; done
export PI_BRIDGE=1 PI_LANE="$LANE" BGT_E2E_PORT="$PORT" BGT_TRIAL_SCRATCH="$SCRATCH"
export PI_CODING_AGENT_DIR="$SCRATCH/pi-agent" PATH="$HERE/shim:$PATH"
export PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
# The cpa extension may use homedir() for its connection config, not the agent-dir override.
export PI_LANES_ORIGINAL_HOME=${PI_LANES_ORIGINAL_HOME:-$HOME}
export HOME="$SCRATCH/home"
mkdir -p "$HOME/.pi"
ln -s "$SCRATCH/pi-agent" "$HOME/.pi/agent"
DRIVER=${PI_LANES_DRIVER:-$HERE/sandboxed-pi.sh}
[ "${PI_LANES_SANDBOX:-1}" != 0 ] || DRIVER=${PI_LANES_DRIVER:-$HERE/run-pi.sh}
exec "$DRIVER" "$WORK" "$SCRATCH/brief.md" "$SCRATCH/result.txt"
