# Lane L-BR — harness hardening

## Delivery

Commits on `lane/LBR` (never pushed):

- `02d8a42` — queued supervision, process-owned bridge exits, bounded same-conversation retries, heavy gate,
  verified cleanup, documentation and no-model acceptance coverage.
- `d75fbfb` — fail closed on an unwritable heavy-command exit marker; regression prevents rerunning a real
  command returning 75 after marker-write failure.
- The containing handoff commit records final verification; no ABI/profile/lifter/game changes.

All **six requested harness areas** are implemented and covered. No input measurements or game files were copied
into the repository; the external iteration requests were read as evidence only. No installs, web browsing, global
pi changes, test weakening, port work or pushes.

## Cause and contracts

### 1. False finished / real exits

The previous bridge conflated `agent_settled` with process completion. Its driver `ended` command had no run
identity and copied whichever status occupied the lane, so nested harness invocations inheriting `PI_LANE` could
publish a timeout/error against their still-working parent. A persisted agent phase could also satisfy a newly
started wait without any driver exit.

The extension now publishes **agentPhase**, not completion. `/lifecycle` is process-owner-only by convention:
`started`/`ended` carry a unique run ID independent of session IDs. Late statuses/exits from another driver are
rejected; a second live driver cannot take over the lane. Session forks retain driver identity. End is idempotent,
late agent status cannot resurrect an exited driver, and old finished events without matching current lifecycle
proof are ignored. `finished` means the worker was reaped and retries exhausted, **including failures**, and carries
`exit=N`. `error` may still indicate a tool/provider problem while pi works; it is not process death or acceptance.

`run-pi.sh` is the public frontend to `driver.py`; `drive-pi.sh` is the internal single-attempt print/TUI worker.
Print mode returns real pi codes, normalizes signal deaths to 128+signal, uses timeout 124 and usage/setup 2.
Cancellation kills/reaps the private worker group before notifying the bridge. TUI retains its older 3/4/5 codes.
Nested test/reviewer drivers must disable the bridge or use a distinct lane. Legacy persisted state cannot prove a
real driver exit; use a new run rather than trusting its agent-only finished phase.

### 2. Wait grammar / supervisor exit

`EVENT[,EVENT...]` (no spaces): `question`, `finished`, `error`, `stalled[:MINUTES]`, `context:PERCENT`,
`supervisor-exit`. Positive decimal minutes; percent 0–100. Bare stalled uses `--stalled-minutes` (default 10).
Supervisor exit is run-wide, independent of lane filters, level-triggered and cursor-addressable, with its real
exit code. Supervisor events from an earlier run cannot complete a replacement supervisor.

### 3. Retry

`PI_MAX_ATTEMPTS` defaults to **1 including the initial attempt**. Failed print attempts with a current stderr
HTTP/status/error 429/500/502/503/504 and a saved session can retry. Backoff defaults to 30 seconds, doubles, caps
at one hour. Each attempt forks the immediately previous session into a fresh `OUT.attempt-N.d`, with a continuation
brief, never reopening the old file to write or restarting the task. Both answer and artifact paths must be fresh.
Only current-attempt stderr/session paths are inspected. No retry on success, timeout, cancellation, permanent
error or absent session. `OUT.d/driver.json` records attempts/exits; `OUT` receives the latest answer; old artifacts
are retained. TUI retry is explicitly unsupported.

### 4. Supervisor

`supervise.sh SOURCE BASE_COMMIT NEW_RUN QUEUE`, Bash 3.2. Queue rows:
`LANE|WORKDIR|SCRATCH|PORT|BRIEF[|BRIEF...]`, all absolute fresh paths. Full preflight rejects duplicates,
overlapping destinations, malformed decimal ports and missing briefs. Lazy independent remote-free clones,
branches at resolved base, installed dependencies copied without `.cache`, isolated HOME/agent/scratch and composed
briefs. `PI_LANES_MAX` defaults 2. No installs or writable shared Git/build caches.

Seed is **cpa-only**: filters auth.json and models.json, optionally copies its connection config, never copies
packages/settings/extensions. Generated local settings disable compaction/internal retries/cache warming/telemetry.
The supervisor adds the heavy gate to PATH, defaults to the fail-closed macOS sandbox wrapper, supports explicit
already-isolated execution and explicit fake-driver/isolation-adapter overrides.

Disk guard checks run and every destination filesystem before dispatch/poll (`PI_LANES_MIN_FREE_KB`, default 1 GiB).
Low/unreadable space stops running groups, reaps them, starts no queued clones. TERM/INT use the same stop path.
Every lane receives atomic `RUN/results/LANE.json`; scheduler events are in `supervisor.log`, driver output in
`LANE.log`. Codes: disk stop 73, unexpected supervisor failure 74, signal stop 143. Supervisor exit 0 only when all
drivers exit 0; normal failed/stopped aggregate 1; setup/usage 2. Bridge remains for final review; stop bridge.pid
explicitly. `launch-lanes.sh` is the legacy-format compatibility frontend to this supervisor.

Isolated HOME required preserving the **original** HOME's global credential deny paths in `sandboxed-pi.sh`;
otherwise its old GLOBAL_AGENT deny would also deny writes to the lane's own agent directory.

### 5. Heavy gate

Portable user paths, BSD `/usr/bin/lockf -s -k -t 0`, retained slot inodes under `/private/tmp/bgt-heavy-v1-slot-N.lock`.
All cooperating processes must use the same slot count/namespace (`BGT_HEAVY_SLOTS`, default 2). npm/npx commands
matching tests/builds/oracles/playwright/lint/bench/probe acquire a slot; nested calls pass with BGT_HEAVY_HELD=1.
Light commands pass without a slot. Real executable paths are resolved before PATH injection or found by excluding
the shim. A per-invocation result marker distinguishes actual exit 75 from lock contention; failed marker writes
return 74 without rerunning the command. Missing lockf fails closed for heavy commands. Test namespaces remain
under `/private/tmp`; production must share the default. This is scheduling, not security; direct node/zig/browser
invocations are not intercepted. Linux needs an operator-supplied compatible lockf, no ungated fallback.

### 6. Cleanup

`cleanup.sh CLONE TARGET_REPO TARGET_BRANCH` refuses non-independent Git dirs/worktrees, dirty/untracked trees,
dirty submodules, nonexistent target branches, and HEAD not ancestral to the named branch **in the target repo**.
Only then deletes the clone, never scratch/results. Stop writers before cleanup; ignored build artifacts go with
the clone, so keep durable evidence in scratch.

## Final verification

Private evidence: `/Users/dev/projects/pi-work/scratch-LBR/` (not committed).

| Gate | Result | Evidence |
|---|---|---|
| doctor | ready | `doctor-final.log` |
| lint | ESLint + **gcc** + all 20 example check-builds green | `lint-final.log` |
| typecheck | clean | `typecheck-final.log` |
| npm test | **426 tests / 34 files passed** | `unit-final.log` |
| focused harness | **53 tests / 2 files passed**, no model | `harness-final.log` |
| npm run test:e2e | **195 passed / 45 existing skips / 0 failures** | `e2e-final.log`, owned port **5199** |
| every pipeline oracle | **16 × 300 = 4,800 frame pairs identical**, both errors null | `oracle-*-final.log`, ignored `reports/oracle-*.json` |
| leakcheck | **379 committable files, clean** after adding handoff | `leakcheck-final.log` |
| real supervisor | **two real installed-pi lanes, thinking low**, exact written markers/final answers, driver exits 0, supervisor exit 0 | `supervisor-e2e-final.log` |
| existing real bridge e2e | **5/5 passed** (status, no-tools fork, live steering, reviewer answer, finished wait) | `bridge-e2e-final.log` |
| shell/Python syntax, git diff --check | clean | final command checks |

Required gate command count: **22 green** (doctor/lint/typecheck/unit/e2e/leakcheck + 16 explicit oracles), plus
focused harness and both opt-in model-backed integrations. No tests/skip counts weakened. `phase0-tools.test.ts`
now explicitly disables inherited bridge/provider injection for fake pi, preserving fake-session assertions; its
timeout assertion changes from legacy 4 to the documented print timeout **124**.

Oracles: win32-conformance, win32-hello, x64-audio, x64-basics, x64-cpp, x64-cpprt, x64-crt, x64-gl, x64-gui,
x64-input, x64-memory, x64-smoke, x64-sysdlls, x64-threads, x64-tls, x86-threads. Reviewer accepted native BGT
examples using their build/browser gates rather than inventing a nonexistent interpreter oracle. Correction to the
initial question's count: **four** examples are native (bench, gpu-readback, gpu-scenes, sample2d); win32-conformance
is pipeline-based and its 300-frame oracle is included.

Real supervisor artifacts: `supervisor-e2e-final/run-ncIKo4/`; real bridge artifacts:
`bridge-e2e-final/run-nALoLq/`. Both used cpa/gpt-6.1-sol, thinking low, existing explicit provider extension,
isolated scratch credentials/HOME, no global installs or writes. The supervisor fixture ran **inside the existing
operator sandbox** (`PI_LANES_SANDBOX=0`), not an untested claim of nested seatbelt execution. Bridges were stopped
after assertions. Tiny synthetic repos/results are retained as evidence, not game files.

## Independent validation

A genuine fresh pi session `01a18fd0-d526-774e-8107-ebc98f04de58` inspected code and ran 43 no-model tests. It
found signal-code normalization and answer-only output collision blockers. Both fixed with regressions; also added
its requested transient-stderr timeout, dirty-submodule/external-worktree and **three lanes at max=2** coverage.
Fresh follow-up `01a18fd5-ce9a-75c9-a9f7-2d0770bf6e85` inspected the fixes, independently ran **52/52** tests,
and found **no blocker** (`review.txt`, `recheck.txt`). The final marker-write safety regression adds one test
(**53**) and is self-tested, not retroactively attributed to the independent reviewer.

## Open limits / next operator

No open requested feature/blocker. Same-user loopback service is coordination, not authentication. Uncatchable
SIGKILL of the outer monitor cannot publish completion; the supervisor's reaped final result remains authoritative.
Power-loss durability/multiwriter bridge state, disk exhaustion during result-file writes, malicious processes
escaping their group, native Linux lockf availability and actual nested macOS seatbelt execution are not claimed.
The disk guard is preventive, not a filesystem reservation. No engine-scale compatibility/performance claim.
