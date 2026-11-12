# K46 checkpoint — fresh continuation requested by reviewer #435

Branch lane/K46, base dev.30 74bb2f7. Implementation commit **1aa7dbb**; following WIP commit adds
residual query counters and this checkpoint. **Not complete / no Tier1 PASS claim.** No compaction,
pushes, installs, network or game files. New synthetic fixtures CC0. BGT_E2E_PORT=5302; :5173 untouched.

## Decisions / implementation

- Reviewer **#432** approved preserving current guest CPU-shadow semantics, no new ABI/flush import.
  api_GetError reads/clears first-error latch; api_CheckFramebufferStatus calls CPU resolve_fbo. Native
  errors are renderer E_IO/diagnostics, not guest GL codes. Reviewer additionally required **one production
  getError poll per presented frame**, after final work, to detect unexpected errors.
- Ordinary validated binds/updates/draws/pass boundaries no longer poll. Allocation, shader/pipeline,
  requested readback, blit allocation and feedback transaction/setup/capture checks remain immediate;
  catch/error drains remain. Debug polls every command and bypasses framebuffer caching.
- Successful completeness caches actual immutable native texture identities+mips+ordered attachments,
  never recyclable guest IDs. Bounded256 keys; restore clears; failed checks not cached. Blit config cached.
- Uniform locations and block sizes cached on successful native link; draw range checks remain. Native
  MAX_ELEMENT_INDEX/MAX_DRAW_BUFFERS cached at initialization/restoration. WebGPU executable unchanged.
- Reviewer **#434** approved retaining rare implicit getBufferSubData for GPU-generated transform-feedback
  vertices requiring wide-stride/sparse-index repacking. Upload-owned packing remains CPU-shadow based.
  Must document and count separately so porter can see it become hot. GPU repacking is a follow-up.
- WIP instrumentation exposes GpuBackend.nativeSyncQueries and diagnostics().lastFrame.nativeSyncQueries:
  getError, checkFramebufferStatus, generatedBufferReadbacks; reset each beginFrame, WebGPU null.
  Stencil fallback passes a status callback so checks counted. **Counter wiring NOT tested yet.**
  README documents residual correctness barriers. No C profile/guest implementation or ABI changes.

## Measured before implementation, then after

Original fixture tests/fixtures/renderer-hotpath.ts: 128 small draws,16 passes/FBO switches,16 UBO uploads,
16 texture updates, repeated pipeline/UBO/texture/scissor bindings per frame;32x32 rotating targets/screen.
Native Metal Chromium on both backends; red pixel [255,0,0,255], no diagnostics. Eight warm frames,60 timed.
Timing is synchronous drawFrame submission span via performance.now (includes native waits), **not OS CPU
or GPU time**. Explicit finish between samples is outside timed span to bound queue backlog. Improve CPU
measurement or label correctly in final; do not overclaim title performance.

Per steady frame before -> after WebGL2:
- getError **832 ->1**; completeness **16 ->0** (warm cache).
- getUniformLocation **512 ->0**; getUniformBlockIndex **128 ->0**; block-size query **128 ->0**.
- getParameter/readPixels/getBufferSubData **0 ->0**.
- WebGPU: all counts0 before/after, no corresponding synchronous-query cost.
- Baseline submission samples about18–32ms; after0.6–1.1ms; WebGPU about0.45–0.55ms with occasional
  outliers. Compute exact mean/median/p95 from retained JSON; these ranges are not exact summary stats.

Successful evidence under **/Users/dev/projects/pi-work/scratch-K46** (never delete root):
- baseline/hotpath3.log + .exit0: original source before change, identical workload measurement.
- after/hotpath.log + .exit0: first repaired measurement.
- focused/browser.log + .exit0: 4/4 PASS: hotpath and native-cache tests, both backend projects.
- focused/unit.log + .exit0:32/32 PASS (gpu-webgl2-queries + gl-frontend-memory).
- focused/typecheck2.log + .exit0; focused/doctor.log + .exit0.

New tests: native error-order mode verifies first-error wins in both orders, GetError reset, incomplete
status is not GL error, invalid target BAD_ENUM, queries submit nothing, attachment redefinition/detach
immediately changes completeness. Browser cache test verifies repeat config, handle reuse, storage growth,
mip identity, shader/program reuse with larger reflected block rejects short UBO. Units cover debug polls/
drains, production frame poll, native-identity/mip cache, incomplete retry, bounded/debug-bypass cache.

Retained early failures (repaired): baseline/hotpath.log newline typo; hotpath2 wrong import URL;
focused/typecheck.log unused opts/implicit callback types; gates/lint-first.log unsafe Function type.
None is a passing gate; successful later records above. No tests/skips/assertions/budgets weakened.

## Live detached Tier1 driver — inspect FIRST, do not duplicate

Driver shell **PID14316**, child14317 (verify identity before any intervention). Launched background and
continues after this session ends. Root **scratch-K46/gates/**:
- run.sh script; launch.log, driver.log; current progress file.
- NAME.command / NAME.log / NAME.exit per step; missing .exit means unfinished, never PASS.
- driver.exit terminal shell status; all.exit written0 only when all steps complete.
- Last observation **current=lint-clang**, doctor.exit0, lint-clang building x64-cpp; not done.
- Sequential: doctor, lint-clang, lint-gcc (real /opt/homebrew/bin/gcc-14), typecheck, full npm test,
  full npm run test:e2e asyncify, full npm run test:e2e jspi, leakcheck, EVERY pipeline example oracle300.
- Env BGT_REQUIRE_WEBGPU=1, BGT_E2E_PORT=5302, BGT_BUILD_JOBS=2, BGT_CACHE_MAX_MB=128;
  browsers use BGT_SUSPENSION_BUILD=dual and BGT_E2E_SUSPENSION=asyncify/jspi. --trace off (not assertions).
- Copies structured e2e-{asyncify,jspi}-results.json and oracle-*.json into gates/. Actual pipeline inventory
  generated from examples/*/game.json. Audit frames/hashes/errors, not only exits; existing scale exception
  oracle contract must remain strict.
- Stops first failure. Resume remaining steps from script, do not repeat completed work blindly.
- Deletes only own node_modules/.cache/bgt between suites and e2e HTML/artifacts after copying JSON.
  Disk guard before each suite loops when df free<3GB. Watch DURING cold suites too; porter runs in parallel.
  Last free~17GiB. Never delete scratch root or other lane files.
- **Final counter wiring changed TS while lint-clang already running**: its early eslint may have used older
  TS. C/fixture source unchanged. Rerun affected final lint/typecheck/unit proof after WIP settles; ensure
  browsers consume final TS. No frozen all-source gate claim yet.
- Scratch hotpath.config.ts / focused.config.ts run standalone browser specs without wasm/global setup,
  absolute clone path, existing Vite, Metal. Avoid port5302 while main browser gate owns it.

## Independent review

Reviewer launched fresh **vK46** static/focused review on **1aa7dbb**, told not to run redundant heavy
suites. Still running at checkpoint. No PASS/delegation claim. Collect findings via reviewer bridge and
notify review of counter WIP commit. Review was coordinator-launched, not simulated by this session.

## Exact continuation queue

1. Inspect driver/current/logs/exits and df first. No duplicate suite driver/server. Follow 3GB pause rule.
2. Typecheck/lint final counter wiring; extend tests for exposed counters and generatedBufferReadbacks;
   verify all renderer-owned getError/status calls routed. Last WIP is not validated.
3. Collect/address vK46 review with regressions/commits; notify coordinator WIP hash.
4. Finish serialized Tier1 both backends ×both suspension modes; doctor, clang/GCC lint, typecheck, full
   unit, leakcheck, all actual pipeline oracles300. Preserve failures; no retries/timing/skip relaxations.
5. Exercise final production/debug, restore cache invalidation, allocation/feedback failure regression via
   existing suites. Audit semantics/query coverage and structured oracle/browser results.
6. Compute exact before/after statistics; current spans are sync submission wall time, not OS CPU. Native
   query-count reduction measured first is deterministic. Add actual CPU measurement if required.
7. Create final **docs/handoff/K46.md** (not yet exists): full query audit, #432/#434 decisions, residual
   exception+port-visible counter, exact gates/commits/independent findings, no unsupported game claims.
8. Commit, post-doc leakcheck/diff-check, clean own disposable caches after jobs; never push. Final<200 words.

Reviewer #435 requested checkpoint/end, not task completion. Fresh session must finish.
