virtual_ms/present: 183.333 -> 16.667 | instructions/present T1: 18000067 -> 18000067, T2: 1891678.889 -> 181625, T3: 177.556 -> 17 | updates/present: 11 -> 1

# K50 WIP checkpoint — stop requested by reviewer #477

Branch lane/K50, base 0342416 (dev.34 + K49). This is NOT the final handoff or an acceptance claim.
No compaction, no web, no game files, no npm install, no pushes. New fixture is original CC0 source.
Scratch root MUST survive: /Users/dev/projects/pi-work/scratch-K50. Port BGT_E2E_PORT=5302.
Independent validation is coordinator-owned and has NOT run here.

## State / completed work

- Read AGENTS/CLAUDE, requested pipeline/thread/savestate/suspension documentation and relevant code.
- Built examples/x64-time: real normal CRT -O2 Win64 executable. Main does several quanta of work and
  glClear/SwapBuffers. A real WASAPI event worker fills audio and performs extra CPU work; third thread
  exercises Sleep/QPC/timeGetTime. Measured BEFORE changing timing. Ten interval-1 presents / nine
  contained intervals: 183.333 ms and 11 updates/present; audio/Sleep wakes 94/9 = 10.444 per present.
- Implemented provisional shared Win32 guest clock/scheduling model (details below), added tests/docs.
- Measured after: both real Asyncify and JSPI give exactly 16667 us/present, one update/present,
  audio/Sleep wakes one/present. Main instruction work unchanged. Audio worker ~90.4% less instructions.
  Test also verifies deterministic reruns in each mode, a QPC spin limiter finishing in exactly 1000 us,
  interval 2 cadence of 33334 us, interval 0 no vsync snap, and a non-presenting cap hit.
- tests/unit/guest-time.test.ts: 3/3 PASS in both suspension modes (test has two mode cases + config).
  Log scratch/logs/after.log; full raw before.json, after.asyncify.json, after.jspi.json retained in scratch.
  Committed compact observations: docs/handoff/K50-measurements.json. Initial after-first measurement
  preceded extra spin/interval/cap suffix; final after.* includes it. First ten workload bodies unchanged.
- git diff --check passed at checkpoint.

## Reviewer rulings #474–#476 / implemented contract

The reviewer approved the overall design but specifically required nominal CPU-rate progress, literal
positive swap intervals and a configurable cap. All ABI/timing changes below have prior approval:

1. Existing 2M dispatch-unit quantum rotates guest contexts, no automatic host frame or 16.667ms charge.
   New Win32 clock includes nominal CPU progress at fixed 4000 budget units/us, not wall time and not
   opt-in retired-instruction counters. Units include existing REP iterations. Partial budgets commit at
   scheduler boundaries and reads include active context uncharged budget; no new hot instruction hook.
   x86_cooperate publishes x86_quantum_insns before resetting the context budget; pre-exec overflow is
   clipped to 2M. w32_core owns virtual_units, per-thread charged debt and process-frame units.
2. pipeline.timeModel.instructionCap default 64M, validated integer 2M..256M. Manifest records version 1,
   instructionCap, unitsPerUs 4000, frameUs 16667. Cap checks also include partial scheduler transfers
   so Sleep(0) cannot evade the cap. Cap diagnostic count added; maximum overshoot one quantum.
3. Successful SwapBuffers snaps forward for interval N>=1 to global grid point at least N*16667 after
   previous present and >= current virtual time. Interval zero does not snap. Present then host-yield,
   workers run only on resume after updated host input/services. Idle progress is credited, not doubled.
   GDI dirty batch observed at deterministic legacy USER/cap/idle boundary, never just host render.
4. All-idle scheduler jumps to earliest thread finite deadline, audio 10ms notification or USER timer,
   clipped to next clock frame. Infinite deadlock yields periodically. External file/range/GL readback
   waits use transport-only yield, not elapsed host latency. Legacy USER waits still clock boundaries.
5. Optional additive read-only double bgt_guest_time_us export APPROVED. Browser deterministic time/audio
   services use it (native BGT fallback remains completed updates*16667). Simulated audio drain timestamp
   added to savestate service state and validator. Clock/budget state lives in wasm, restored normally.
   QPC changed from millisecond quantization to matching 1MHz microsecond clock, enabling spin limiter.
6. step(n) remains n consumed host updates, not quanta or guaranteed presents. Native BGT unchanged.
   Pipeline page loop max one update/rAF, dropping backlog; no wall-time-dependent guest schedule or
   hard wall-ms preemption claim. Reviewer explicitly approved this tradeoff.

Docs updated: platforms/win32/THREADS.md, docs/pipeline.md, docs/savestates.md, docs/suspension.md,
bgt/abi/ABI.md (optional export and pacing text were explicitly approved). Still audit all details against
implementation and failing tests: this WIP is not validated globally yet.

## Sandbox / shared node_modules workaround (reviewer approved)

Original node_modules symlink points to ../shared-node_modules with non-writable .cache. Reviewer approved
replacing ONLY this clone's node_modules symlink by a local directory of per-package symlinks to the same
shared install, .bin symlink, with local writable .cache, .vite, .vite-temp. No package/lockfile changes.
An attempted one-line build-lock cacheDirectory change was REVERTED: no build.mjs diff remains.

Shared install's directory name is not literally node_modules, so Node/Vite realpath resolution can fail
on std-env/@vitest/utils. Scratch resolve-local.mjs registers a Node resolve hook mapping shared package
URLs back through this clone's node_modules. Use:

    source /Users/dev/projects/pi-work/scratch-K50/env.sh

This sets NODE_OPTIONS=--preserve-symlinks --import=<scratch>/resolve-local.mjs, BGT_E2E_PORT=5302,
BGT_SUSPENSION_BUILD=dual, BGT_TEST_JSPI=1. Do NOT add --preserve-symlinks-main: it breaks npm/npx's
relative cli.js lookup. Earlier typecheck/time-oracle exit=1 files are stale SETUP FAILURES due to that
flag, not validation results. env.sh is now corrected; npm --version, Vitest/Playwright --version work.
The live focused suite started with the older preserve-main flag but does not itself use npm for builds;
its failures must still be diagnosed, not assumed environment-only.

## Live background work (do not duplicate / keep one heavy suite)

- PID 31590: bash scratch/focused.sh. At checkpoint kill -0 says LIVE. Runs focused units with accounting
  and dispatch counters ON. Log scratch/logs/focused.log, completion sentinel focused.exit (not yet present).
  Its preliminary typecheck + x64-time oracle attempts failed from npm setup (stale .exit=1), then units ran.
  Focused selection: guest-time, threads, guest-accounting, retirement, decode-cooperation, audio-init,
  audio-input, savestate-*, *recording*, abi-layout. Global setup built six examples successfully.
  CURRENT OBSERVED RED: audio-input.test.ts 2 failures (input state + x64-input 300 oracle). No detailed
  final report yet. Other cases still running. Diagnose these first after suite completes.
- PID 35900: bash scratch/gates-next.sh. kill -0 LIVE. It WAITS for focused.exit, then uses corrected env
  to rerun typecheck and BOTH 300-update x64-time differential oracles with accounting/dispatch ON.
  Logs typecheck.log, time-oracle-asyncify.log, time-oracle-jspi.log and corresponding .exit; copies reports
  to scratch/oracle-x64-time-{mode}.json. It does not run full all-fixture oracle/browser/lint gates.
- Completed measurement PID 28897 is no longer work to repeat; after.log says 3/3 PASS.
- ps is sandbox-denied; use kill -0 and log tails. Files in scratch/logs include old failed setup attempts.
- Disk at checkpoint: 6.6 GiB free; keep >3GB. node_modules/.cache ~212MB, Zig scratch cache ~260MB,
  web/public/games ~28MB at recent check, but unit temp builds growing. Delete BUILD OUTPUTS BETWEEN
  suites (never scratch root), do not delete files a live suite uses. Artifacts can be rebuilt via cache.

## Exact next steps / open items

1. Read logs and confirm live PIDs before launching anything. Wait focused/gates-next serialized work.
   Get final failure details; fix real issues and update only tests whose timing contract intentionally
   changed. Existing tests were NOT weakened or edited yet. audio-input currently red; old update-count
   assumptions and new GDI present boundary/virtual timer behavior need localization, not guessing.
2. Read typecheck log after corrected rerun. New Savestate.services.audioTimeUs may require fixtures that
   construct service objects to be updated. New e2e guest-time test has NOT run or typechecked yet.
3. Verify x64-time 300-update differential oracle BOTH modes (new oracle streamOptions includes x64-time).
   Do not confuse passing within-mode rerun test with lifted/interpreted equivalence. Watch debt accounting
   at exact quantum/pre-execution attempts, callback parks and resets. Both guest widths need validation.
4. Audit boundaries/risks: uncommitted debt on thread restore; nested native parks; cap while callbacks;
   no clock backwards for override caps >64M; idle deadline accuracy; transport counter currently includes
   SwapBuffers host suspension too (name may be misleading; avoid unapproved timing changes); GDI present
   snapshots now occur before host render; positive interval accepted range up to signed INT_MAX unchanged.
   Need evidence for input timing and oracle consistency, not just new fixture.
5. Add/fix focused C/TS tests as necessary for nominal spin clocks, GDI/transport no-time and saved audio
   timestamp. Confirm cap config reaches actual runtime. Current config test only validates helper +
   default manifest; custom-cap runtime test is still missing. Fixture has non-presenting cap proof.
6. Run lint (clang + real gcc), typecheck, focused units for all touched areas. Native gl_frontend_driver.c
   stubs w32_wait_frame only, now adapter references w32_wait_transport and w32_clock_present; likely needs
   test stubs updated with meaningful assertions. No lint has run. Must not silently skip GCC.
7. Every pipeline oracle at 300 updates (user finish line says all, not only new fixture; both modes safest).
   Enumerate examples/*/game.json pipeline. Use serial loop and cleanup each fixture outputs before next,
   preserve small JSON evidence in scratch and commit compact summary. Ordinary builds counters OFF;
   fixture measurement/guest-accounting needs ON explicitly. Several focused tests build variants themselves.
8. Browser: savestate, recording, determinism (gameplay.spec.ts), threads, new guest-time on BOTH backends,
   BOTH suspension modes; plus full chromium-webgl2 JSPI cell. Build dual examples first. Test port5302,
   no developer5173. Global setup prepares slice fixtures. No browser has run this lane yet. Do not set
   software-renderer flags to weaken assertions unless established environment needs explicit gate reporting.
9. leakcheck; disk cleanup between suites. Finish docs/handoff/K50.md with fixed numeric header FIRST,
   exact before/after + gates, mention any deliberately changed test contracts and environment/hardware gates.
   Independent review/tier2/full tier1 are coordinator responsibilities. Commit on lane/K50, never push.

The user requested no compaction and final reply <200 words. Reviewer #477 explicitly requests this clean
checkpoint then STOP; a fresh session continues. Do not claim task finished or tests globally green.
