# K42 checkpoint — continue in a fresh session on lane/K42

Reviewer explicitly requested this checkpoint/end after approving the compaction architecture.
No compaction of the agent session occurred. **This is an unfinished prototype, not the finish line.**

## Source / environment

- Clone /Users/dev/projects/pi-work/lane-K42, branch lane/K42, base dev.26 dc385a9.
- Prototype commit **b2ae065**. No push. No game files, installs or web access; original CC0 fixtures only.
- Read AGENTS.md / CLAUDE.md first; user brief remains authoritative. Full Tier1 must run unchanged.
- Scratch **/Users/dev/projects/pi-work/scratch-K42** — NEVER DELETE THIS ROOT. Test port5294
  from BGT_E2E_PORT. Suites serial/background. About6.3GiB free at checkpoint.
- Doctor exit0, typecheck passed after typing repairs. No completed browser/exactness/full-unit claim.
- Reviewer launched **fresh vK42 source review on b2ae065**. It had not returned findings to this
  session at checkpoint. Fresh continuation will receive them; fix them before acceptance claims.

## Reviewer decisions #388–#393 (design evolution)

The bridge approved the following boundaries, replacing the original impossible/ambiguous parts:

1. Full suspended **Asyncify** checkpoints. True suspended **JSPI** continuations cannot be cloned
   through JS; JSPI snapshot/restore only at actually returned-update boundaries. Explicit
   unsupported-state error at suspended JSPI; use Asyncify fallback to search pipeline loops.
   Never quietly claim Asyncify execution is JSPI.
2. Renderer command journaling from startup into a fresh renderer, including GPU-written
   attachments, not just CPU uploads. Both native backends required.
3. Explicit deterministic test mode before boot. Browser __BGT_TEST__ previously used real
   performance.now(), Web Crypto, audio wall time and live input; there is no existing fully
   deterministic browser environment to reuse. Reviewer approved seeded entropy, fixed-update
   guest host-clock, simulated audio queue, isolated memory storage and scripted input. Make it
   usable by ordinary port regression tests too. **Route guarantee is within deterministic mode**;
   not arbitrary wall-clock gameplay. Prove Asyncify search route replays from boot in JSPI under
   that mode, plus exact continuous/snapshot suffixes on both backends.
4. Numeric globals/function tables exported by opt-in, integrity-verified module instrumentation.
   Fresh wasm instances are necessary because wasm memory/table growth cannot shrink in place.
   No ABI/layout/code/index-space change; no production/default-mode instrumentation.
5. Initial256MiB history journal is **not enough for the nine-minute use case**. Reviewer requires
   bounded restore work through live-resource compaction; measure size/restore latency on
   x64-gl-fbo and a CC0 game-like per-frame-clear fixture.
6. Packed depth24plus-stencil8 has no portable exact WebGPU readback (existing FrameReplay
   intentionally skips it). Reviewer approved readback-safe resources plus **clear-based residual
   provenance** for resources without exact readback: retain draws since last full clear of ALL
   aspects. If no full clear is within2frames/Ncommands, explicitly reject the snapshot, never
   keep unbounded history or silently omit stencil. Report residual size per snapshot.
7. Crucial dependency catch: those residual draws may sample resources updated/deleted later.
   Replaying them against safe resources read back at the END of the suffix is incorrect.
   Reviewer approved **prefix-materialized bounded residual compaction**, described below, and
   explicitly requested checkpoint/end now, fresh session continues in this lane.

No implementation of compaction exists in b2ae065. docs/savestates.md accurately describes the
current prototype's history-scaling limitation, which is **not final accepted scope**.

## Implemented in b2ae065

- bgt/runtime/savestate-wasm.ts: add exports for all globals/functions/tables without touching
  code/index spaces, snapshot memory/grown pages/numeric globals/function-table identities.
  Fail closed for engine-owned passive/declarative segment state, starts, multiple/imported
  memories, exception tags, unsupported references/NaN payloads. Marker rejects noninstrumented
  snapshots. Tests include hidden i64>2^53, table growth/mutation, memory growth and codec.
- bgt/runtime/host.ts: host lifecycle/Asyncify state and GPU validation tables, completed requests,
  frame/input metadata; snapshot only consumed boundaries. Guest scheduler/thread/TLS/timer/
  TSC/clock/RNG/GL object state is in memory. Host profile wall-time isn't a replay oracle.
- requests.ts / vfs.ts / input.ts: explicit state/cursor/ID/visibility/edge snapshots.
- savestates.ts: deterministic services from boot, optional hooks, quiescence/identity/configuration
  validation, fresh renderer GPU-journal replay, fresh host restore, replace only after replay.
- savestate-file.ts / testapi.ts: snapshot/restore plus Map/Set/typed-array/bigint/-0 JSON codec.
  __BGT_TEST__ flag deterministic=1 (alias savestates=1); ordinary/default services unchanged.
- tools/probe/probe.mjs: JSHandle snapshots (don't cross Playwright's lossy JSON serialization),
  import/export files, branch search with input/update/score/screenshot + restoration in finally,
  BGT_E2E_PORT respected. Porter example in docs/savestates.md.
- New tests: tests/unit/savestate-wasm.test.ts; tests/e2e/savestates.spec.ts,
  savestate-services.spec.ts, savestate-transfer.spec.ts; CC0 tests/fixtures/c/savestate-game.c.
  These are **written but not yet run**. No assertions/skip policies in existing tests weakened.

## Background jobs / exact evidence paths — DO NOT START OVERLAPPING SUITES

At end, baseline is STILL BUILDING all examples in unit global setup (at full12078-owner scale).
Do not kill unverified pids/touch shared gates. ps is sandbox-denied. No suite was labelled green.

- Baseline shell launched at recorded pid92932:
  npm run doctor -> gates/doctor.log, gates/doctor.exit=0;
  npm test -- --maxWorkers=1 -> gates/baseline-unit.log, gates/baseline-unit.exit once done.
- **/Users/dev/projects/pi-work/scratch-K42/focus.sh** launched at recorded pid4928. It waits for
  baseline-unit.exit, then runs focused units, dual-builds sample2d/x64-gl-fbo/x64-threads, then
  both required-backend focused E2E. It stops after unit/build failures (build failures have no
  final E2E exit marker; inspect logs!). Focus unit global setup may rebuild examples again.
- gates/focus-unit.log/.exit; gates/focus-build.log; gates/focus-e2e.log/.exit;
  reports/k42-focus-results.json (Playwright output uses configured port5294).
- gates/types-initial.log: latest typecheck pass.
- gates/lint-initial.log: targeted ESLint produced no output, but detached command did not save
  exit marker: do NOT count it as a certified gate. Full lint/real clang/GCC still pending.
- Full doctor/lint/types/final npm test, full browser suite in both modes/backends, leakcheck and
  every pipeline oracle300 are **not done**. Commit hook leakcheck checked18 staged files only.

Use read/tail with narrow output. Suites are background; don't delete scratch. Remove owned
large temporary outputs after auditing/hashing evidence, not unrelated/shared cache trees.

## Approved compaction implementation plan / next steps

1. Read vK42 findings and actual baseline/focus exits; repair correctness before compaction.
   In particular prove Asyncify suspended checkpoint and exact requests/GL/thread suffixes;
   our x64-threads test intentionally snapshots at update1 and asserts it has not exited yet.
   Ensure tests require real requested JSPI artifacts, not loader fallback.
2. Add a test-only compactor that tracks live resource generations and a bounded suffix cut:
   every live unreadback-safe resource must have a full ALL-aspect clear inside <=2updates /
   explicit N-command cap. Partial/scissored/masked clears are NOT reset points. Also track
   blits/copies/feedback and inputs/dependencies, including resources deleted after their use.
3. At snapshot, replay GPU prefix up to the suffix cut into a **temporary** same-backend renderer
   (never replay guest code). Read native safe resource contents there, not after the residual.
   Materialize descriptors, shader sources/pipelines/samplers/buffers/textures + contents for
   resources LIVE AT THE CUT, not just those live at snapshot end. Preserve handle generations.
   Uploaded buffers/textures can use exact current CPU shadows only where proven unmodified
   by GPU. GPU-generated buffer data needs native readback. Capture mip/layer/format extents.
4. Rebuild journal as compact base state at cut plus original bounded residual commands in exact
   order. Keep the original resource inputs/uploads/deletions/generations within that residual.
   Packed stencil begins at its proven complete clear, with no unavailable pre-clear contents
   consumed by earlier suffix work. If a common safe cut doesn't exist, fail snapshot explicitly
   rather than assume dependencies away. Full-screen/legacy render target contents need capture
   too (screen0 can be a copy/readback source in later updates).
5. Restore replays only this compact base + capped residual into fresh renderer, then restores
   fresh host. Snapshot itself may initially cost history replay; subsequent snapshots use the
   compacted journal. Restore must be bounded by live state + residual, not route length.
   Reset live recorder to compact form only after successful materialization. Failed snapshot
   must leave running game/input/services/GPU history valid.
6. Record serialized bytes, native resource bytes, residual command/frame count, snapshot time,
   restore time; measure x64-gl-fbo + CC0 game-like clear-per-frame fixture. Compare every suffix
   state hash AND every framebuffer byte after continuous and two restores; include file import
   and original-from-boot deterministic-mode JSPI route transfer. Test missing-clear cap fails.
7. Add actual probe helper integration example run and failure/finally test. Update docs to
   distinguish prototype limitations removed vs remaining (JSPI suspension, deterministic mode).
8. Final independent fresh validation, serial Tier1 (doctor, lint clang+GCC, types, npm test,
   full E2E required WebGPU/WebGL2 Asyncify and JSPI, leakcheck, every pipeline oracle300),
   docs/handoff/K42.md with exact actual results/limits. Commit only lane; never push.

No game performance, nine-minute restoration, hardware/iPhone, completed Tier1 or exactness
certification is implied by this checkpoint.
