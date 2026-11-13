# K47b checkpoint — reuse repaired/reviewed; full gates live

**Superseded by [K47.md](K47.md): K47c completed final gates, measurements and structured audit.**
This file preserves the historical continuation state; its live-PID/pending instructions are no longer current.

Date: 2026-11-14 00:40 +07. Branch lane/K47, base dev.31 4951c3b.
Scratch root **/Users/dev/projects/pi-work/scratch-K47/** — preserve it, never delete the root.
Stop requested by coordinator bridge #456 at ~150k context. Do not redo completed implementation.

## Commits and independent review

- Existing item 0/census: 3de1f2e; initial checkpoint bc2b559.
- 89d3ec0: equal-size-only live BufferData reuse; counters; native and browser regressions; renderer-only orphan fixture.
- ee9c915: repair rejected-reuse semantics + eliminate per-command attribution strings (precomputed labels).
- 6d07db5: standalone browser reuse tests use paused backend=none shell to avoid background rendering.
- This checkpoint commit adds **draft** docs/handoff/K47.md and tests/unit/x64-gl-orphan.test.ts (new test not yet run).

Fresh independent vK47 reviewed 4951c3b..89d3ec0: found P1 rejected reuse retained old state where original
DELETE accepted / CREATE rejected would clear it; P2 per-command toString/concat allocation. Both repaired.
Fresh independent vK47b delta review of ee9c915 **PASS**, no new findings (bridge #455). Reviewer reproduced P1
baseline equivalence at every failure stage, with/without an earlier error; confirmed P2 fixed. No heavy suites
were delegated. Reviewer directed finish gates/performance/handoff; #456 now directs stop and fresh continuation.

## Final semantics / reviewer decisions (do not regress)

Equal-size live buffers only; no capacity retention/doubling. Growth/shrink keep original DELETE/CREATE.
Successful full UPDATE commits shadow/map reset/generated reset only after synchronous acceptance. TF-bound
BAD_OP precedes reuse, NULL data retains deterministic zero fill, earlier draws must see old contents.

**Rejected UPDATE**: restore pre-attempt guest first-error latch, then fall through the original DELETE/CREATE path
unchanged. Rejected DELETE retains old state; accepted DELETE + rejected CREATE leaves size/map/generated 0/0/0;
fully successful fallback has no speculative UPDATE error. Decoder rejects before shadow mutation or emitting a
native item, proven by new unit test. Do NOT restore the earlier implementation's unconditional retain behavior,
and do NOT tear down unconditionally if DELETE rejects.

Reviewer explicitly accepts existing kit bounded-work accounting: a rejected, well-framed speculative UPDATE
charges **40 wire bytes / 1 command / 1 submit** before fallback at the exact aggregate budget edge. It is not a GL
semantic contract; no ABI or decoder accounting change. Unit test pins the charge. This is documented in K47.md.

Counters (successful stores, cumulative): gl_buffer_respec_reused, resized, grew, shrank. Initial allocations and
failures excluded; equal-size fallback through allocation is not counted as reuse or resize. Strict query policy
requires explicit ?debug=1; API availability must not force it. Diagnostics report production/strict/null + per-op
nativeSyncQueryOps. No coalescing, allocation error deferral, pre-drain rewrite or completeness-cache change.

## Valid measurements already done

**Runtime capable path**: SwiftShader WebGL2, native Metal WebGPU; original CC0 examples/x64-gl-orphan.
Native Metal WebGL runtime fails existing 65536 UBO capability gate (host reports 16384), gate unchanged. Runtime
SwiftShader census and standalone native Metal renderer CPU were explicitly accepted as separately labelled evidence.

Valid before/after runtime logs: gates/runtime-{before,after}.log, exits both 0 (8/8 cases each). Original before wasm
retained at before/x64-gl-orphan/ (bc2b559). After built at 89d3ec0. All valid runs exact red, zero command errors.

- Before production: 161 getError/frame (BUFFER_CREATE 160; frameEnd 1), FBO 0.
- Before strict: 1247 getError, FBO 40. URL/policy assertions now verify strict works end-to-end; earlier invalid
  checkpoint debug confusion is superseded by these valid results.
- After equal production: **1 getError, FBO 0**, 80 reused stores/frame. 0 creates/deletes; 120 updates.
- After equal strict: 1087 getError, FBO 40.
- After varying: 161 production / 1247 strict; FBO 0 / 40. **80 resized stores: 40 grew / 40 shrank, 0 reused**.
- Both backends ABI submits **243 -> 163** equal-size; varying 243. Commands 603 -> 523, bytes 18248 -> 15688.
  163 = 80 respec updates + 40 private program-uniform updates + 3 texture updates + 40 full draw/pass lists.
- Runtime production main-thread CPU ms/frame: WebGL 2.186 -> 0.973; WebGPU 1.383 -> 1.374. Three batches of 20.
- Native Metal standalone renderer CPU ms/frame equal-size: WebGL 1.306 -> 0.207; WebGPU 0.630 -> 0.526.
  Five batches of 60 after eight warm frames; counts independently instrumented: WebGL 161 -> 1, FBO 0; WebGPU GL queries 0.

Timing is CDP TaskDuration threadTicks (main thread, not GPU-process CPU); not a game-speed/mobile claim. Detailed
other policy/size and wall results are in draft K47.md and perf/summary.json. These numbers precede ee9c915;
steady streams are unchanged but **final-source reruns are queued and must replace/update the handoff values**.
Standalone perf/cpu.spec.ts now uses an empty routed HTML page to isolate shell rendering and counts native GPUQueue
submits separately (that modified script has NOT been rerun yet). Original cpu.log / cpu.exit=0 retained.

## Live background drivers — DO NOT launch a second heavy suite

At 00:40 both PIDs passed kill -0 (ps is sandbox-denied):

- **PID 8347**: bash scratch-K47/gates/run.sh, stdout gates/driver2.log. Current **unit** (npm test -- --maxWorkers=1).
  Launched ~22:51; unit began ~23:35. This suite is slow (global example/native builds + many native compiler probes).
  It is progressing; latest log at 00:40 was lifting counts_exe / x86 codegen probes. Free disk **7.9 GiB**.
- **PID 43955**: bash scratch-K47/gates/final.sh, stdout gates/final-driver.log. It is waiting for gates/all.exit,
  then runs final typecheck / final clang lint / final-source performance / final leakcheck. Do not duplicate it.

Main driver run.sh sequence after unit:
1. delete lane-owned node_modules/.cache/bgt;
2. full npm run test:e2e Asyncify with dual build, required WebGPU, all projects, no scale exclusion;
3. copy reports/e2e-results.json to gates/e2e-asyncify-results.json, delete disposable browser artifacts;
4. same full JSPI run, preserve JSON; cleanup;
5. leakcheck;
6. derive **all 35 pipeline** examples, npm run oracle -- examples/<id> 300 each, copy JSON and delete cache after each;
7. gates/all.exit=0 / current=complete.
Environment: BGT_E2E_PORT=5307, BGT_BUILD_JOBS=2, BGT_CACHE_MAX_MB=128, BGT_REQUIRE_WEBGPU=1.
No software-pixel waiver or missing-device skip allowed. :5173 untouched. Clang check-builds delete each output
internally; disposable cache/browser outputs are removed between later suites. Watch df; never allow <3 GB.

## Gate state / known expected stop to handle

Passed: doctor, typecheck (before last repair), lint-clang (mixed pre/post repair; final rerun required and queued),
lint-gcc (post ee9c915), runtime before/after 8/8 each, initial focused 38/38, **delta-focused2 132/132 final repaired
native/query/decoder tests**. Individual .command/.log/.exit under gates/.

Preserved earlier failed attempts (not final evidence): early-typecheck.exit=2 (unknown metrics types, fixed);
respec-browser.exit=1 (new test incorrectly encoded PASS_BEGIN; fixed in 89d3ec0 before full matrix);
delta-focused.exit=1 (generated unaligned invalid-size rejection expectation; corrected 9 -> 12).

**Full npm test currently has a real, localized new-fixture inventory failure**:

tests/unit/build-cache.test.ts "test declarations build only the selected examples..." compares static declarations
against every example. New x64-gl-orphan originally had only browser tests, no unit declaration. The running suite
found that mismatch before the new unit file existed. No assertion was weakened. Added meaningful
**tests/unit/x64-gl-orphan.test.ts** with // @bgt-examples: x64-gl-orphan: real headless profile stream test verifies
80 reused stores, no creates/deletes, 120 updates, 40 indexed draws, owned vertex upload contents and zero errors.
It is **not yet run**, and current full Vitest discovery predates it. Run it plus build-cache after current suite
finishes, address any new-test issue, then decide full rerun vs reviewer-accepted composite coverage. Do not label
original failed npm test PASS. There may be other timing failures; inspect final unit.log, don't assume only one.
Main run.sh uses || exit on unit, so it will probably stop here; final.sh then remains waiting for all.exit.

## Exact continuation steps

1. Read this file first, CLAUDE.md, draft K47.md; git status/diff --stat. Check live PIDs and gates/current, tail unit.log,
   df -h. **Do not remove cache while unit is live.** No source implementation change is pending.
2. When unit.exit appears, inspect all failures/counts. Run the new fixture + repaired inventory test (background):
   npx vitest run tests/unit/x64-gl-orphan.test.ts tests/unit/build-cache.test.ts --maxWorkers=1
   Capture command/log/exit. This builds only declared orphan fixture. Request reviewer acceptance if proposing
   composite unit coverage; otherwise rerun full npm test, no test weakening or budget changes. Unit inventory is
   now 152 files / initial suite count + 1 new test; get actual counts from output, don't infer final total.
3. If main driver stopped on unit failure, resume **only its remaining gates** in another background driver after
   unit acceptance; copy sequence from run.sh starting cleanup/e2e (don't overwrite previous failures). Original
   PID 8347 will have ended. Keep final.sh waiting; eventually write all.exit=0 only on real remaining success.
4. Final driver final.sh (PID43955) will then run final-typecheck; final-lint-clang; clear disposable cache;
   final-cpu (empty-page native Metal standalone paired command streams + native GPUQueue submit counter);
   copy original before wasm; final-runtime-before (current renderer, old wasm); rebuild dual final orphan;
   final-runtime-after; final-leakcheck; cleanup; final-all.exit=0.
   It writes all these under gates/final-*.{command,log,exit}. It DOES NOT rerun full units/e2e/oracles.
5. Update perf/summary.json to use final-*.log (old summary uses initial runtime/cpu logs); report native queue
   submits separately from ABI submits, CPU/time boundary accurately, and original-vs-final source evidence.
6. Audit script prepared at gates/audit.mjs; run only once all final gate artifacts exist. Expects browser
   396 passed / 51 expected skips per mode (WebGL183/24, WebGPU205/26, auto8/1), every test retry0, no errors,
   no software pixel waiver, no device-missing skips; 35 oracles *300frames with exact final+trace hashes.
   It currently requires unit.exit=0; if reviewer accepts composite, adjust audit to validate original failures
   plus targeted coverage explicitly, NOT relabel original exit. Retain all failed-attempt evidence.
7. Finalize docs/handoff/K47.md (currently DRAFT, pending gates/timing), commit all final docs/test fixes;
   leakcheck/diff-check, clean branch, no pushes. Final reply <200 words. User requested no compaction.

No game/inputs files were accessed. Scratch root retained. No heavy reviewer suites running. Independent delta
review is complete; no new reviewer request pending. The remaining work is gates/new unit fixture validation/final
performance/audit/documentation, not new optimization design.
