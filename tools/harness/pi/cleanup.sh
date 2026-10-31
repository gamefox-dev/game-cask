#!/usr/bin/env bash
# cleanup.sh LANE_CLONE TARGET_REPO TARGET_BRANCH
# Refuse dirty clones, external git dirs/worktrees, or HEAD absent from target branch.
set -eu
[ $# -eq 3 ] || { echo 'usage: cleanup.sh LANE_CLONE TARGET_REPO TARGET_BRANCH' >&2; exit 2; }
CLONE=$(cd "$1" && pwd -P); TARGET=$(cd "$2" && pwd -P)
[ "$CLONE" != / ] && [ "$CLONE" != "$TARGET" ] || exit 2
case "$TARGET/" in "$CLONE/"*) echo 'target is inside clone' >&2; exit 2;; esac
[ -d "$CLONE/.git" ] && [ ! -L "$CLONE/.git" ] || { echo 'not an independent clone' >&2; exit 2; }
[ "$(git -C "$CLONE" rev-parse --show-toplevel)" = "$CLONE" ] || exit 2
HEAD=$(git -C "$CLONE" rev-parse HEAD)
[ -z "$(git -C "$CLONE" status --porcelain --untracked-files=all)" ] || { echo 'lane tree is dirty' >&2; exit 2; }
# A branch in the target repository, not a lane-local branch or arbitrary revision expression.
git -C "$TARGET" show-ref --verify --quiet "refs/heads/$3" || { echo 'missing target branch' >&2; exit 2; }
git -C "$TARGET" merge-base --is-ancestor "$HEAD" "refs/heads/$3" || { echo 'HEAD not contained in target branch' >&2; exit 2; }
# Avoid silently deleting dirty submodules (including untracked submodule files).
[ -z "$(git -C "$CLONE" submodule foreach --quiet 'git status --porcelain --untracked-files=all')" ] || exit 2
rm -rf -- "$CLONE"
printf 'removed %s (HEAD %s contained in %s)\n' "$CLONE" "$HEAD" "$3"
