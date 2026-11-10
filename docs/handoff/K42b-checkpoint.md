# K42b checkpoint — reviewer requested stop; continue fresh K42c

**Unfinished, not acceptance-certified.** Reviewer explicitly approved commit/checkpoint now while
serial detached jobs continue. No context compaction, push, web/install or game files. Branch lane/K42.
Base dc385a9; previous prototype b2ae065, checkpoint d138738. This checkpoint adds unverified repairs.

## Read first / constraints

AGENTS.md / CLAUDE.md; original brief /Users/dev/projects/pi-work/briefs/k42-savestates.md;
prior docs/handoff/K42-checkpoint.md contains decisions #388–#393 and complete original context.
Sandbox; CC0 fixtures; ask before ABI/game-visible changes; never weaken tests; background serial suites.
**NEVER DELETE scratch root /Users/dev/projects/pi-work/scratch-K42**. BGT_E2E_PORT=5294.
Disk ~6GiB available. Do not overlap jobs or kill unverified pids/shared gates. Host ps is denied.

## External vK42 FAIL and fixes written (not yet runtime-certified)

Review source b2ae065, evidence /Users/dev/projects/pi-work/inputs/vK42/REVIEW.md.
1. P1 expected shader compile failure made GPU history restore throw. Recorder now saves backend
   executeCode and shader completeCode; optional FrameReplay handled-outcome mode verifies those
   outcomes instead of rejecting expected failure. Default frame replay remains strict. Compaction
   emits only live resources (deleted failed shaders disappear). New savestate-failures E2E fixture
   covers live failed shader, deletion, handle reuse, two suffixes incl JSON, both modes/backends.
2. P2 Infinity/-Infinity/NaN globals: float globals now get appended bit-reinterpret getter/setter
   helper functions, after existing function/type indices. Existing code/index identities unchanged.
   Saved floats are i32/i64 bits (NaN payloads never pass through JS Global.value). JSON codec also
   tags arbitrary nonfinite JS doubles by bits. New exact f32/f64 NaN payload/Infinity unit regression.
3. P2 production code leakage: checkpoint capture/restore moved out of regular classes into test-only
   prototype adapters (savestate-host.ts, savestate-runtime.ts, renderers/savestate-surfaces.ts).
   Class declarations are type-only. Module instrumentation and service hook sites are compile-time
   gated by existing DEV||VITE_BGT_TEST; feature dynamically imported only with deterministic=1.
   main.ts awaits test API installation before starting. Reviewer clarified acceptance: production
   contains NO checkpoint/deterministic implementation and output bytes equal with implementation
   present vs removed; report actual production bytes vs dc385a9 and explain any delta. Literal
   baseline-byte identity is not required if guarded hooks/main orchestration account for it.
   New savestate-production.test.ts builds both variants and checks code absence + exact equality.
4. vK42 x64-gl-fbo browser crash likely RAM from whole 1GiB guest clones: now save sparse nonzero
   64KiB pages plus exact reserved length. Restore scans/clears initialized nonzero fresh-instance
   pages, grows, and writes saved nonzero pages, avoiding writes/commit of GiB zero ranges. This is
   a hypothesis repair, NOT proven crash diagnosis or success. Threaded exactness remains unproven.

## Bounded compaction implemented (requires adversarial validation)

bgt/runtime/savestate-gpu.ts: select common cut at frame boundary <=2 updates /100000 commands;
replay prior compact base + prefix into TEMP same-backend renderer, never guest code. Capture safe
native contents AT THE CUT (not suffix end), emit live resource descriptors/content + original
bounded residual in exact order. This retains resources/generations deleted/reused later.
Packed depth-stencil is not read back: prove each unavailable pre-cut aspect is fully reset before
any residual consumption and before snapshot end, or deleted unconsumed. Supports full load clears,
full unmasked/unscissored CLEAR_BUFFER aspect resets, full uploads. Rejects missing/partial/scissored
provenance. Residual may contain safe-resource mutations before the DS clear; those are preserved.
Buffers use native readback AND preserve separate original backend CPU shadows/generated flags.
Legacy render targets read natively; immutable legacy sampled texture CPU shadows are exact.
Physical retained screen and WebGPU logical screen captured/restored separately via test adapters.
Finite float/half native texture contents supported; nonfinite GPU values explicitly rejected
(native GL readback can canonicalize NaNs). Numeric wasm globals fully bit-preserved separately.

Recorder attempts compaction every120 updates or32MiB, so first explicit snapshot after a long
route need not replay from boot. Failures preserve history;256MiB cap still explicitly errors.
Successful snapshots reset recorder to compact base+residual; restore cost proportional to live
state+bounded residual. stats include nativeBytes/residualCommands/residualUpdates/snapshotMs.
Snapshot() validates/captures host first, then materializes; failed snapshot keeps running state.
No GPU/performance/exactness claim until actual E2E results. Inspect conservative proof carefully.

New CC0 tests/fixtures/c/savestate-gpu.c: per-update packed DS clear, draw sampling a texture
updated/deleted/reused AFTER the draw, copy to screen. NO_CLEAR defines retained-stencil rejection.
New savestate-compaction E2E:300-update history, bounded size, every suffix hash+framebuffer after
continuous and2 restores, JSON, both returned modes/backends; attachments record size/timings.
Existing savestates.spec records x64-gl-fbo/thread measurements now, no assertions weakened.

Probe search extracted to tools/probe/savestate-search.mjs for finally regressions (score/capture/
input/diagnostic failure). tools/probe/examples/savestate-search.mjs is actual sample2d integration:
file export/import, scored variants/screenshots, success/failure baseline restore. docs/savestates.md
updated for compaction/limits; example still must execute via queued focus runner.

## Live serial jobs — do NOT start overlapping suites

Detached baseline shell pid92932 still alive at latest check; focus shell pid4928 waits on
baseline-unit.exit. They were launched in previous session. Baseline started21:20; cold full examples
completed about22:07; now executing substantial native semantics compilation/test work. It may run
considerably longer. tail is many lifted probe lines, NOT a hung claim. No exit marker yet.

Root G=/Users/dev/projects/pi-work/scratch-K42/gates:
- doctor.exit=0 / doctor.log (previous actual pass).
- baseline-unit.log + baseline-unit.exit when done: npm test -- --maxWorkers=1. Source changed
  during this original baseline; cannot count as final-source certification even if green.
- focus.sh (root scratch): waits baseline, focused units (savestate-wasm/production/search), dual
  build sample2d/x64-gl-fbo/x64-threads, focused browser specs including services/transfer/failures/
  compaction with both required backends, probe integration both backends, typecheck and targeted lint.
  Script has stop-after-unit/build-failure behavior; build failure has no final browser marker.
- focus-unit.log/.exit; focus-build.log; focus-e2e.log/.exit;
  reports/k42-focus-results.json and reports/k42-focus-artifacts (timing JSON attachments).
- focus-probe-webgl2.log/.exit and focus-probe-webgpu.log/.exit;
  scratch/probe-webgl2 and scratch/probe-webgpu contain snapshot files/screenshots (remove large
  owned files after auditing evidence, never root).
- types-final-b.log/.exit and lint-final-b.log/.exit queued after browser/probe.
- types-f.log: last actual typecheck exit0 before last proof/probe/test edits; earlier b/c/d pass,
  types-e failed on trace annotation then fixed. Need final actual typecheck.
- Targeted/full lint NOT certified. New imports/adapters may need formatting/lint fixes.

## Next K42c work (no finish claim)

1. Inspect actual exit markers/logs. Fix focused regressions before any full-suite acceptance.
   In particular test production module removal stubs produce identical bytes; compile CC0 GPU
   fixtures with actual headers; inspect live-failed shader replay; exact GL prefix/reset ordering;
   x64-gl-fbo RAM/crash and live x64-threads suffix. Require true requested mode, not fallback.
2. Check buffer/texture native metadata, dependency proof, mip/layer/extents, retained screen,
   failed async pipeline links, GPU errors, and failed snapshot atomicity. Do not silently accept
   histories outside proven boundaries. FrameReplay default strictness must stay unchanged.
3. Obtain actual compacted snapshot sizes/restore times on x64-gl-fbo + game-like fixture (test
   attachments), file import, periodic compaction and probe integration. Update docs with numbers.
4. Independent fresh review/validation on final code (vK42 was on prototype only).
5. Tier1 still required: doctor, lint clang+GCC, types, final npm test; full E2E Asyncify+JSPI on
   both required native backends; leakcheck; EVERY pipeline oracle300. No full matrix green claim.
   Keep suites background/serial, BGT_E2E_PORT, audit/delete owned large outputs afterward.
6. Final docs/handoff/K42.md with exact actual evidence/limits; commit only branch, never push.

This continuation stopped as requested near150k without context compaction; no delegation claimed.
