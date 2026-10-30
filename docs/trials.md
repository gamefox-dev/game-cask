# Isolated trials (any agent harness)

An operator launches a porter in a fresh clone. A porter never edits the kit. The common entry point is
`AGENTS.md` → `CLAUDE.md`; skill files are `.claude/skills/<name>/SKILL.md`, exposed unchanged at `.agents/skills`.

```sh
npm run trial:setup -- --kit HEAD --game /path/to/owned/input.exe --dir /path/to/new-trial \
  --slice 'boot → title → introductory level cleared'
```

The command resolves the commit, makes a clone with independent Git objects and **no remote**, checks out that
commit detached, runs `npm ci`, copies just the supplied file into `original/`, and runs `trial:brief`. It refuses an
existing destination. It leaves partial setup in place on failure for diagnosis; use another fresh destination when
retrying. The selected commit must contain the setup/brief tools. Browser binaries and Zig must already be installed
as described in README; setup does not install system tools. Companion shipped files must be supplied by the operator.
`reports/setup.json` records the full commit and slice. Do not treat cloning as a security sandbox.

`--slice` also works with `trial:brief`. It defines the porter's L3 acceptance loop and eventual packaging scope,
not permission to rewrite logic. Without it, SPEC §8 defines L3. Resume with `trial:brief --resume` in the existing
trial and preserve its work queue. A separate agent/session does independent validation.

## Claude Code

In the trial clone run `claude`, then give it the contents of `reports/brief.md` as its task. In unattended mode,
use the installed CLI's print mode with the brief on stdin. Use OS/container isolation; prompt rules alone do not
isolate credentials or files. No special Claude-only tool is required by the kit's instructions.

## pi driver

Requires an **already installed** `pi` on PATH and Python 3 (stdlib only); not a kit/CI dependency.

```sh
PI_MODEL=provider/model tools/harness/pi/run-pi.sh /path/to/trial /path/to/trial/reports/brief.md /path/to/result.txt
```

Defaults: print mode, thinking `high`, timeout 7200 s, poll 5 s; `PI_DRIVE_MODE=tui` uses a PTY and a minimal screen
parser. `PI_BIN` selects an installed executable. `PI_LEAN=1` disables discovered extensions and MCP; explicitly set
`PI_PROVIDER_EXTENSION` if the model needs one. `PI_LEAN=0` loads user extensions; review them first.
`PI_EXTRA_ARGS` is a whitespace-separated argument list (not shell syntax). `PI_TUI_SELECT=1` selects the model in the
TUI. An existing result `.d` directory is never overwritten. Output: final answer, JSONL sessions, transcript, run.json,
and TUI screen/raw logs when applicable. Session files contain private prompts/tool results: never publish them raw.
Print mode is preferred; TUI completion detection depends on the installed pi's screen format.

## Isolation

On macOS, `sandboxed-pi.sh` wraps the driver with the parameterized `pi.sb.in` seatbelt profile:

```sh
BGT_TRIAL_SCRATCH=/path/to/trial-scratch PI_MODEL=provider/model \
  tools/harness/pi/sandboxed-pi.sh /path/to/trial /path/to/brief.md /path/to/trial-scratch/result.txt
```

Provision ONLY model credentials in `$BGT_TRIAL_SCRATCH/pi-agent` (or `PI_CODING_AGENT_DIR`). Defaults put npm/Zig
caches and empty Git/gh configuration in scratch. Original files are write-denied; writes outside work/scratch,
agent config and OS temporary directories are denied. SSH, gh, Git credentials and Keychain access are denied.
**This profile is not a read allowlist or a network sandbox**: readable other trials remain a confidentiality risk,
network access is needed by model providers, and inherited environment variables may contain secrets. Launch with a
reviewed environment and use a disposable user/VM for strict isolation. Never run original executables.
The wrapper fails closed if sandbox-exec is unavailable. On Linux use an operator-configured disposable container/VM
with only the trial and scratch mounted, credentials scoped to the model endpoint, and controlled egress; CI does
not require macOS tools. Nested seatbelt execution is not verified by kit CI.

## Record

The porter runs `trial:record -- port <slug>`, `report -- --strict`, and `leakcheck`, retaining the work queue,
metric evidence, screenshots and the brief. The operator keeps harness logs separately and hands the published
validator role brief to a fresh independent session. A hardware iPhone gate remains separate.
