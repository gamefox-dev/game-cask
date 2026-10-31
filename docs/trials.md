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

`PI_MAX_ATTEMPTS=N` (default **1**, including the initial attempt) enables print-mode retries. Only a **failed**
attempt whose own stderr contains HTTP/status/error **429/500/502/503/504** is eligible. It must have saved a
session: the next attempt uses `--fork LAST_SESSION` and a continuation brief, never restarts the original task.
`PI_RETRY_BACKOFF=30` seconds is doubled per retry, capped at one hour. Outputs are `OUT`, `OUT.attempt-2`, etc.;
each has a fresh `.d`. Existing paths are refused, never read as new evidence. `OUT` receives the latest answer;
`OUT.d/driver.json` lists attempts and exits, and all original per-attempt artifacts remain intact. No retry for a
permanent error, missing session, timeout, cancellation or successful exit. TUI retries are not supported. Print
mode returns the **actual pi exit code**, timeout **124**, cancellation **128+signal**, usage/setup **2**. TUI retains
its legacy startup/timeout/death codes (3/4/5). The outer driver reaps its worker before notifying the bridge.

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
turn**, not tool/status traffic. Grammar (no whitespace):
`EVENT[,EVENT...]`, where EVENT is `question`, `finished`, `error`, `supervisor-exit`, `stalled[:MINUTES]`, or
`context:PERCENT`. Minutes must be positive (decimals accepted); percentage is 0–100 inclusive.
For example `--for question,finished,stalled:25,supervisor-exit` overrides the stall default in that spec.
`supervisor-exit` is run-wide, unaffected by lane filters, and includes the supervisor exit code.
`context:60` matches at or above 60% of the model window; unknown context never
matches. `--timeout-s N` optionally bounds waiting (nonzero exit on timeout); default waits indefinitely.
`--since N` also checks persisted events after that sequence (available from HTTP `GET /state`); at most 4096
recent events are retained. Pending reviewer questions and current finished/error/stalled/context conditions are
level-triggered, so starting a waiter after an event does not miss actionable state. A question event only wakes
the reviewer for **instance → reviewer** questions, not their own outgoing queries. Lane filters are comma-separated.

Status includes completed assistant steps, context tokens/window/percent (unknown shown as `?`), session-reported
cost, provider/model, last five tool names, Git HEAD, last ten errors and time since last turn. Git HEAD is not proof
of a clean tree. Costs are provider/session-reported, not a billing guarantee. Neither `agent_end` nor
`agent_settled` is process completion: these update `agentPhase` only. **Only the driver process owner**, after
reaping the worker and exhausting retries, publishes `finished` (also on failure), e.g. `G finished exit=17`.
A unique driver run ID is independent of forked session IDs; stale status/exits cannot finish a replacement run.
Nested harnesses must use `PI_BRIDGE=0` or a **distinct lane ID**, not impersonate the parent lane. `status` shows
`exit=N` after exit. `error` may still wake on a tool/provider error while pi works; it does **not** mean exited.
An agent error with pi exit zero remains in error history/agentPhase; the process code remains zero. Completion
proves neither acceptance nor clean commits. Old bridge-state files without driver lifecycle records cannot prove
completion: restart a new run, not a waiter on legacy finished phases. An uncatchable SIGKILL of the outer monitor
cannot report completion; the supervisor's final-result file is authoritative for that case.

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

### Queued lane supervisor (Bash 3.2)

```sh
# /path/to/queue.txt; all paths absolute, fresh WORKDIR/SCRATCH; no pipes/newlines in paths:
# G|/path/to/lane-G|/path/to/scratch-G|5185|/path/to/common.md|/path/to/G.md
# H|/path/to/lane-H|/path/to/scratch-H|5186|/path/to/common.md|/path/to/H.md
PI_MODEL=cpa/model PI_BRIDGE_PORT=5190 PI_LANES_MAX=2 \
  PI_LANES_AGENT_SEED=/path/to/cpa-only-agent \
  tools/harness/pi/supervise.sh /path/to/kit BASE_COMMIT /path/to/NEW-run /path/to/queue.txt
```

The supervisor validates the **entire queue** (unique IDs/decimal ports, nonoverlapping fresh paths and briefs)
before starting anything. It lazily creates up to `PI_LANES_MAX` independent remote-free clones at the resolved
base commit, branches `lanes/<lane>` (`PI_LANE_BRANCH_PREFIX` overrides), isolated scratch/HOME/agent directories,
ports and briefs composed in order. Queued clones consume no space until scheduled. Installed `node_modules` are
copied **without `.cache`**, not shared writable caches; no installs or shared Git objects. Commit kit changes first.
`PI_LANES_POLL=2` controls polling in seconds. An unavailable or below-threshold filesystem fails closed:
`PI_LANES_MIN_FREE_KB=1048576` (1 GiB default), checked on the run and every destination volume. It stops active
process groups, reaps drivers, marks queued lanes stopped, and starts no more clones. Check logs/results rather
than confusing a disk stop with model completion. It does not automatically delete work.

`PI_LANES_AGENT_SEED` copies **only cpa** from auth.json and models.json plus the optional
`pi-cliproxyapi-provider/config.json` connection configuration. Other provider credentials, settings, packages and
extensions are not copied. Generated local settings disable compaction/internal retries/cache warming/telemetry;
`PI_OFFLINE=1` suppresses catalog/version activity, not model requests. Explicit `PI_PROVIDER_EXTENSION` loads an
already-installed provider. Default driver is macOS `sandboxed-pi.sh`, failing closed elsewhere;
`PI_LANES_SANDBOX=0` is only for an **already isolated** operator container/VM or nested operator sandbox.
`PI_LANES_DRIVER` is an explicit executable override for fake-driver tests/operator isolation adapters, not a
fallback. TERM/INT stop the queue and running process groups. Exit 0 means all drivers exited 0, exit 1 means at
least one failed/stopped; setup/usage exits 2. `RUN/results/LANE.json` atomically records each lane's exit/reason
(disk guard **73**, unexpected supervisor failure **74**, signal **143**); `supervisor.log` records scheduling,
and `LANE.log` retains driver output. `supervisor-exit` is published only after reaping every lane. The bridge stays
alive for final review; stop `bridge.pid` afterward. Never reuse a run directory.

`launch-lanes.sh SOURCE NEW_RUN MANIFEST [COMMON_BRIEF...]` remains a compatibility frontend to the supervisor;
its old queue format is `LANE|PORT|BRIEF`, auto paths `NEW_RUN/lane-LANE`, `NEW_RUN/scratch-LANE`, branches
`bridge/<lane>`, source HEAD. It now uses the same queue, disk guard and cpa-only seeding.

### Heavy-command gate and safe cleanup

The supervisor prepends `tools/harness/pi/shim` to PATH. `npm`/`npx` wrap commands whose arguments include test,
build, oracle, playwright, lint, bench or probe. Up to `BGT_HEAVY_SLOTS=2` run simultaneously across lanes/processes,
using BSD `/usr/bin/lockf -k` slots under **/private/tmp/bgt-heavy-v1-slot-N.lock**. Slot files are kept (never unlink
an in-use lock inode). Use the **same slot count and namespace machine-wide**. Nested commands inherit
`BGT_HEAVY_HELD=1` and pass through; light commands pass through without holding a slot. A real command exit 75
is returned, not mistaken for lock contention. Missing lockf fails closed for heavy commands; Linux needs an
operator-provided compatible lockf, no automatic ungated fallback. Direct node/zig/browser invocations are not
intercepted: lanes must invoke heavy kit tasks through npm/npx. This is scheduling, not a security boundary.

`BGT_REAL_NPM`/`BGT_REAL_NPX` may name installed executables; the supervisor resolves them before adding the shim.
Standalone wrappers search PATH excluding themselves. Do not point these back at the kit shim. Test isolation can
set `BGT_HEAVY_LOCK_PREFIX` (must remain under `/private/tmp`); production lanes must share the default namespace.

```sh
# Only after commits are integrated into the named local target branch:
tools/harness/pi/cleanup.sh /path/to/lane-clone /path/to/integration-repo integration-branch
```

Cleanup refuses dirty/untracked trees, dirty submodules, external Git dirs/worktrees, a missing target branch or
HEAD not ancestral to that branch **in the target repository**. It deletes only the verified clone, not scratch or
results. Stop the lane first; do not race cleanup against a running writer. Ignored build artifacts are removed
with the clone; put durable evidence outside it.

The bridge is a **same-user coordination channel, not an isolation boundary**: any local process that can reach
its port can read/change run state. Browser origins/rebinding hosts are rejected; there is no remote bind or CORS.
Do not run untrusted local workloads beside it. Queues/answers/session paths may be private; keep the run directory
out of Git. One server per run directory is required. It survives process restarts via atomic rename, not a
machine/power failure guarantee or multi-writer database. It does not parse full session logs into reviewer context.

### Bridge tests

`npm test` includes no-model server/CLI/extension/launcher regressions. Fast loop:
`npx vitest run --config tests/pi-bridge.config.ts` includes process lifecycle/retry, queue/disk/cancellation,
heavy gate and cleanup regressions with fake pi/drivers (no model). The opt-in **real installed pi** checks use quota:

```sh
PI_MODEL=cpa/gpt-6.1-sol PI_PROVIDER_EXTENSION=/path/to/existing/provider/extension.ts \
  BGT_BRIDGE_E2E_DIR=/path/to/private-scratch npm run test:bridge-e2e
PI_MODEL=cpa/model PI_PROVIDER_EXTENSION=/path/to/existing/provider/extension.ts \
  BGT_SUPERVISOR_E2E_DIR=/path/to/private-scratch node tools/harness/pi/supervise-e2e.mjs
```

The supervisor fixture creates an original tiny local Git repo (no dependencies/game files), two queued lanes
with real installed pi at thinking **low**, exact file/final-answer assertions and driver/supervisor exit assertions.
It retains private artifacts and stops its bridge. Use `PI_LANES_SANDBOX=0` only within existing operator isolation.

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
