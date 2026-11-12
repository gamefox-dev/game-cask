# K46 checkpoint — reviewer #441 requests fresh gate-verification session

Branch lane/K46, base dev.30 **74bb2f7**. **Final source 4b1153d, coordinator-accepted.**
Implementation lineage: 1aa7dbb (hot-path repair), 2480dc6 (counters), 4b1153d (P1 repair/regressions).
**NOT COMPLETE / no Tier1 PASS claim.** No pushes, installs, network, game files or compaction.
New fixtures CC0. Main BGT_E2E_PORT=5302; small finished benchmark used5303;5173 untouched.

## Final behavior / decisions (settled; do not redesign)

- #432: guest glGetError reads/clears the C first-error latch; guest glCheckFramebufferStatus runs CPU
  resolve_fbo. Native errors are renderer diagnostics/E_IO, not guest GL codes. No C/ABI/flush changes.
- Validated binds/updates/draws/pass boundaries no longer poll. One production getError after each
  frame's final presentation/snapshot/requested readback. Debug retains per-command checks.
- Allocation, compilation, pipeline replacement, requested readback, blit and feedback correctness
  checks remain. Before synchronous transactions, bounded32 pre-dispatch drain reports errors from
  earlier unpolled work separately. Context loss or non-draining queue rejects deterministically.
  Existing catch drains remain. No inner drains after setup: they could hide the transaction's own errors.
- Successful completeness cache uses immutable native texture identity+mip+ordered attachments, never
  recyclable guest IDs. Bounded256 keys; failed checks uncached; restore clears; debug bypasses.
- Program reflection (locations/UBO sizes) cached per successful native link; short UBO rejection retained.
  MAX_ELEMENT_INDEX/MAX_DRAW_BUFFERS cached at initialization/restoration. WebGPU executable unchanged.
- #434: GPU-generated transform-feedback vertices requiring wide-stride/sparse-index repacking retain
  real getBufferSubData correctness readback. Upload-owned packing uses CPU shadows. GPU repacking is
  a follow-up, not stale-byte substitution/rejected supported draws.
- diagnostics().lastFrame.nativeSyncQueries exposes getError/checkFramebufferStatus and separately
  generatedBufferReadbacks; resets each rendered frame, WebGPU null. Counter/reset/restore/generated
  data and browser census assertions now tested. README documents residual barriers.

## Review boundary

Fresh coordinator-launched **vK46** reviewed1aa7dbb: **FAIL, one P1**. A real bufferSubData upload followed
by gl.enable(0xdead) leaves INVALID_ENUM pending; a later valid SHADER_CREATE/BUFFER_READBACK wrongly
returned E_IO. Native regression fails on2480dc6, passes repaired source with exact16-byte readback;
WebGPU control passes. Reviewer also verified cache/reflection, production/debug and first-error tests.
Actual baseline uniform-location count is512, not the reviewer's initial640 expectation.

Repair0e993fa was finalized/squashed as **4b1153d** (bounded32 drain, context-loss/non-draining test,
callback isolation and exposed count assertions). **Coordinator re-review accepted4b1153d**, no remaining
blockers. Do not claim vK46 reran final Tier1. Final-result review: inputs/vK46/final-result.txt.

## Measured evidence (done; do not repeat)

Evidence root **/Users/dev/projects/pi-work/scratch-K46**; NEVER delete root.
Fixture tests/fixtures/renderer-hotpath.ts:32×32,128 small draws,16 FBO/pass switches,16 UBO uploads,
16 texture updates and repeated bindings; native Metal Chromium both backends, exact red[255,0,0,255],
no diagnostics.8 warm frames,60 timed frames; explicit finish outside timed submission span.

- Original submission WALL ms/frame mean/median/p95:
  WebGL2 25.162/24.630/28.940 ->0.756/0.765/0.880;
  WebGPU0.543/0.480/1.245 ->0.508/0.505/0.555.
- Additional paired CDP TaskDuration **threadTicks**,5×60 frames: mean renderer-main-thread task CPU
  WebGL2 **4.985 ->0.220 ms/frame**, WebGPU **0.706 ->0.713**. Includes draw+explicit finish/await,
  excludes setup/compilation/GPU-process CPU. Reviewer accepted this labeled CPU/wall boundary.
- Steady per-frame WebGL2 getError832->1, completeness16->0, locations512->0,
  block index128->0, block size128->0; getParameter/readPixels/getBufferSubData0->0.
  WebGPU all0 before/after. No title-speed claim; porter will measure actual game impact.
- Original logs: baseline/hotpath3.log/.exit0, after/hotpath.log/.exit0; wall-summary.json exact stats.
- CPU: perf/cpu2.log/.exit0, perf/cpu-summary.json, perf/cpu.spec.ts and playwright.config.ts.
  Small copied source snapshots under perf/{baseline,after}; CPU after snapshot0e993fa has identical
  steady hot path to final bounded-drain source. First cpu.log failed import resolution, not PASS.
- Before-fix regression: perf/prefix.log/.exit1, expected WebGL2 failure plus WebGPU pass.
- Repaired browser: focused/final-browser.log/.exit0 **6/6** (before bounded32 guard; same happy path).
- Final bounded unit: focused/bounded-unit.log/.exit0 **8/8**, bounded-typecheck.exit0,
  bounded-eslint.exit0 (full ESLint). Earlier focused/unit.log32/32 included C error-order regressions.
- Retain historical repaired failures (early baseline typo/import, initial typecheck and lint-first).
  No skips, budgets, assertions or oracle contracts weakened.

## Detached Tier1 driver — inspect FIRST, do not duplicate

Original shell **PID14316**, child14317 (verify identity before intervention; ps may be sandbox-blocked).
Root **/Users/dev/projects/pi-work/scratch-K46/gates/**. run.sh script, launch.log, driver.log;
current progress; NAME.command/NAME.log/NAME.exit; missing .exit means unfinished, never PASS.
Terminal wrapper driver.exit/all.exit mark completion; all.exit0 only after every step.

**Last inspected current=unit**, still full-unit initial fixture builds (x64-scale). Existing successful
markers: doctor.exit0, lint-clang.exit0, lint-gcc.exit0 (real /opt/homebrew/bin/gcc-14), typecheck.exit0.
No unit/e2e/leakcheck/oracle exit yet. lint-first.exit1 is an earlier repaired lint failure, not final gate.
Final repair changed TS after early lint; final focused full ESLint/typecheck/unit proof is above.
C/fixture source unchanged. Main full unit imports tests after its initial builds; browsers will use final TS.

Driver serial order remaining: full npm test; full npm run test:e2e asyncify; full npm run test:e2e JSPI;
leakcheck; EVERY actual pipeline example oracle300 (inventory generated from examples/*/game.json).
Env BGT_REQUIRE_WEBGPU=1, BGT_E2E_PORT5302, BGT_BUILD_JOBS2, BGT_CACHE_MAX_MB128;
BGT_SUSPENSION_BUILD=dual, BGT_E2E_SUSPENSION=asyncify/jspi; trace off only, no assertion changes.
Copies structured e2e-{asyncify,jspi}-results.json and oracle-*.json to gates; AUDIT JSON, not exits alone.
Existing exact scale error contract must stay strict. Stops first failure; resume only remaining work.

Deletes only own node_modules/.cache/bgt between suites and e2e HTML/artifacts after JSON copy.
Guard waits if df free<3GiB; monitor during heavy suites too (porter parallel). Last free~15GiB.
Do not delete scratch root/other lane files; avoid5302 while browser gate owns it. Lightweight focused
config files use5302 and MUST NOT run concurrently with full browser gates.

## Fresh-session exact queue

1. Inspect df, gates/current, every .exit and current log FIRST; no duplicate driver/server or repeated gates.
2. Verify full unit and full browser matrix both backends×both suspension modes, leakcheck and all actual
   pipeline300 oracles. Preserve failures; fix real regressions without weakening tests. Monitor disk.
3. Audit structured results: expected skips only, no flaky/retry success, required native WebGPU present;
   oracle requested/compared frames300, identical hashes, null errors/first divergence, strict scale contract.
4. Finish **docs/handoff/K46.md**: currently a draft with accurate measurements/review and explicitly
   pending Tier1 section. Replace pending only after verified final exits/audit; add exact final totals.
5. Commit final docs, post-doc leakcheck/diff-check, clean only disposable lane caches after jobs; never push.
   Final reply<150 words. No source redesign needed absent gate findings.

Reviewer #441 explicitly requested this checkpoint/end. Fresh session must finish gates and final handoff.
