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

## Reviewer ↔ pi bridge (opt-in)

The bridge uses Node only (no new dependencies), binds **127.0.0.1** and persists `bridge-state.json` in a private
run directory. Start exactly one server per run; `PI_BRIDGE_PORT` defaults to 5190. Keep that port distinct from
all lanes' `BGT_E2E_PORT` values. Server restarts reload lanes, queues, answers and event cursors.

```sh
PI_BRIDGE_PORT=5190 node tools/harness/pi/bridge/server.mjs /path/to/private-run/bridge
# In each lane's environment (server must already be listening):
PI_BRIDGE=1 PI_LANE=G PI_MODEL=provider/model \
  tools/harness/pi/run-pi.sh /path/to/clone /path/to/brief.md /path/to/scratch/result.txt
```

`PI_BRIDGE=1` loads **only the workspace** `bridge/extension.js` via `-e`, even with `PI_LEAN=1`. It appends
`bridge/agent-brief.md` to the run's copied brief (both trial and kit-lane prompts). Never use `pi install` or edit
global pi settings/extensions/npm. Existing provider extensions can be selected explicitly with
`PI_PROVIDER_EXTENSION=/path/to/already-installed/provider/extension.ts`; nothing is installed or updated.
The sandbox inherits bridge variables unchanged and continues to allow localhost.

### Reviewer commands

```sh
npm run bridge -- status                       # two compact lines per lane; optional --lane G
npm run bridge -- ask --lane G --live "What remains before your final commit?"
npm run bridge -- ask --lane G --fork "Which acceptance checks have passed?"
npm run bridge -- answers                      # optional --lane G
npm run bridge -- questions                    # pending instance → reviewer decisions, ids/options/defaults
npm run bridge -- answer --id 3 "Choose the additive option."
npm run --silent bridge -- wait --for question,finished,error,stalled,context:60 --lanes G,H
```

Run `wait` as a background shell command in the reviewer harness: its exit wakes the reviewer with exactly one
line (`G finished`, `G question #3`, etc.); `--silent` suppresses npm's script header. `--stalled-minutes N` defaults
to 10, measured since the last **completed
turn**, not tool/status traffic. `context:60` matches at or above 60% of the model window; unknown context never
matches. `--timeout-s N` optionally bounds waiting (nonzero exit on timeout); default waits indefinitely.
`--since N` also checks persisted events after that sequence (available from HTTP `GET /state`); at most 4096
recent events are retained. Pending reviewer questions and current finished/error/stalled/context conditions are
level-triggered, so starting a waiter after an event does not miss actionable state. A question event only wakes
the reviewer for **instance → reviewer** questions, not their own outgoing queries. Lane filters are comma-separated.

Status includes completed assistant steps, context tokens/window/percent (unknown shown as `?`), session-reported
cost, provider/model, last five tool names, Git HEAD, last ten errors and time since last turn. Git HEAD is not proof
of a clean tree. Costs are provider/session-reported, not a billing guarantee. `agent_end` updates status but is not
finished: retries/steering can follow; `agent_settled` marks finish. Driver exit covers crashes/timeouts and preserves
an extension-reported failure even if pi exits zero. `finished` means the agent run settled, not that kit checks passed.

- **Live (default):** durable queue, one outstanding delivery at a time, steering at the next turn boundary.
  The agent is told to answer briefly in its next assistant text, then continue the original task. The bridge
  captures that next text (not the answer to the preceding turn). Use fork if a print-mode lane has already ended;
  no bridge can steer an exited process. A crash around delivery can cause re-delivery; answers are idempotent,
  first-answer-wins. Live answers may include task commentary after the brief answer.
- **Fork:** copies only complete JSONL records along the lane's last published active branch, then runs a separate
  `pi -p --fork COPY --no-tools --no-extensions --no-mcp` session, thinking low. It never resumes/writes the original;
  discovered skills/prompts/context/project resources are disabled. The copy reflects the last published boundary,
  not an in-flight assistant response. No task tools are enabled. Temporary copies are deleted; answers remain in
  the bridge log. Forking uses model quota and requires the reviewer's existing provider credentials/config.

### Agent decisions (`ask_reviewer`)

Use `ask_reviewer(question, options?, default?, timeout_s?)` **only for real decisions not settled by the brief**:
ownership conflicts, ambiguous acceptance boundaries or a tradeoff requiring operator choice. Never use it for
routine confirmations, progress acknowledgements or permission to follow existing instructions. Give concrete
options and a safe default where possible. It waits up to 900 seconds by default, then explicitly returns
`Reviewer timeout; using default: …`. Without a default it reports `(no default supplied)`; do not treat that as
permission to violate a hard rule. Reviewer/deadline races use the first persisted answer; abort signals cancel
waiting. A bridge outage before enqueue fails the tool instead of pretending a reviewer answered; after enqueue
it retries polling through the deadline. The shared [agent brief](../tools/harness/pi/bridge/agent-brief.md) is the
trial/lane bridge template, automatically added by the driver.

### Multi-lane launcher

```sh
# /path/to/lanes.txt (absolute brief paths):
# G|5185|/path/to/G.md
# H|5186|/path/to/H.md
PI_MODEL=provider/model PI_BRIDGE_PORT=5190 PI_LANES_AGENT_SEED=/path/to/credential-only-agent \
  tools/harness/pi/launch-lanes.sh /path/to/kit /path/to/NEW-run /path/to/lanes.txt /path/to/common.md
```

The Bash 3.2-compatible launcher validates unique lanes/ports, starts one bridge, then makes independent,
remote-free clones at source HEAD, branches `bridge/<lane>`, per-lane scratch/credential directories, ports and
briefs composed in file order. `PI_LANE_BRANCH_PREFIX` changes the branch prefix. Installed `node_modules` are
copied without `.cache` (never shared writable build caches, no system/network installation). Ports must be decimal
without leading zeros. Changes must be
committed before launch. Seed copies only `auth.json` and `models.json`, not packages or global settings. If a
provider needs additional credentials, provision them explicitly in scratch and use `PI_PROVIDER_EXTENSION`.
Default is macOS `sandboxed-pi.sh`, failing closed elsewhere; `PI_LANES_SANDBOX=0` is only for an already isolated
operator container/VM. The launcher waits for lane drivers; the bridge remains for status/fork review. Stop it with
`kill "$(cat /path/to/run/bridge.pid)"` after review. Partial setup is retained on failure; never reuse a run directory.

The bridge is a **same-user coordination channel, not an isolation boundary**: any local process that can reach
its port can read/change run state. Browser origins/rebinding hosts are rejected; there is no remote bind or CORS.
Do not run untrusted local workloads beside it. Queues/answers/session paths may be private; keep the run directory
out of Git. One server per run directory is required. It survives process restarts via atomic rename, not a
machine/power failure guarantee or multi-writer database. It does not parse full session logs into reviewer context.

### Bridge tests

`npm test` includes no-model server/CLI/extension/launcher regressions. Fast loop:
`npx vitest run --config tests/pi-bridge.config.ts`. The opt-in **real installed pi** check uses quota:

```sh
PI_MODEL=cpa/gpt-6.1-sol PI_PROVIDER_EXTENSION=/path/to/existing/provider/extension.ts \
  BGT_BRIDGE_E2E_DIR=/path/to/private-scratch npm run test:bridge-e2e
```

Default model is `cpa/gpt-6.1-sol` (an unqualified `PI_MODEL` uses `PI_PROVIDER` when set), thinking low. It asserts
status/context, live answer, no-tools fork answer with unchanged original, `ask_reviewer` round-trip, and an actual
CLI `wait --for finished` exit. It creates isolated HOME/agent/session directories, copies only existing auth/model
files (and the existing cpa connection config when present), loads extensions via CLI flags, and retains private
diagnostics in scratch. It never changes the user's global pi. The model and provider must already be available.

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
