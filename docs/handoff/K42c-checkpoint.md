# K42c checkpoint — reviewer requested immediate checkpoint, fresh K42d implements provenance

**Unfinished; do not claim finish line.** Source **592f844**, branch lane/K42 from dc385a9.
Reviewer approved known-constant packed-aspect provenance extension (below), then explicitly
requested checkpoint NOW; no implementation of that extension yet. No context compaction,
ABI change, game files, web/install or push. Scratch /Users/dev/projects/pi-work/scratch-K42
MUST NEVER BE DELETED. BGT_E2E_PORT=5294. Suites serial/background; disk ~9GiB free.

Read AGENTS.md/CLAUDE.md; original /Users/dev/projects/pi-work/briefs/k42-savestates.md;
K42-checkpoint.md and K42b-checkpoint.md for decisions388–395 and prototype review fixes.
External vK42 FAIL on b2ae065: /Users/dev/projects/pi-work/inputs/vK42/REVIEW.md.
Fresh vK42b independent re-review still REQUIRED, not yet requested (original ordering: Tier1 first).

## What ran / actual outcomes

- Previous detached baseline **completed exit0**:142 files /2408 tests,7375s (21:20–23:23).
  gates/baseline-unit.log/.exit. Source changed while running: not final-source full certification.
- Focus initially failed production absence test: const TEST=false left one testHarness.services
  expression in minified output despite other sites folding away. Fixed by directly inlining
  DEV||VITE_BGT_TEST at every runtime guard. Removed TEST alias; production test now passes
  (implementation present vs removed produces identical bytes, and no checkpoint symbols).
- gates/production-size.json: same Vite production-entry options vs dc385a9, baseline292906 JS
  bytes;592f844-related head292377 (-529). Temporary baseline archive removed by measurement
  script. This is production entry JS, not gzip/assets. Hooks/module implementation absent; main
  orchestration and expression/code-shape changes explain difference, no baseline-byte claim.
- Focus units **4 files/19 tests pass**, including new command-only provenance adversaries.
- Focus browser **36/36 pass**, WebGL2 and REQUIRED WebGPU, both actual requested suspension
  modes. gates/focus-e2e.log/.exit=0; reports/k42-focus-results.json (inline measurement attachments).
- Probe integration example **both backends exit0**, file export/import, score variants/screenshots,
  finally restoration after intentional score failure. gates/focus-probe-{webgl2,webgpu}.log/.exit;
  scratch/probe-webgl2 and scratch/probe-webgpu outputs (owned temp snapshots can be removed
  after auditing; never delete scratch root).
- Typecheck/targeted lint **exit0**: gates/types-final-b and lint-final-b.log/.exit.
  These predate the last long-test-only changes; full final gates remain required.
- **New stronger long x64-gl-fbo gate FAILS**, correctly/conservatively, not weakened:
  reports/k42-long-results.json; gates/long-e2e.log/.exit=1,13 pass/1 fail. WebGL2
  x64-gl-fbo Asyncify snapshot after303 updates rejects packed default-depth texture900 consumed
  before full clear. WebGPU long case passes. No pixel mismatch or memory crash here.
- Full Tier1 chain NOT STARTED: final-runner.sh stops after this failed long gate. No owned
  suite remains running at checkpoint. Doctor earlier exit0 only. Full lint clang+GCC, final units,
  full browsers both modes/backends, leakcheck, every pipeline oracle300 all still required.

## Source repairs/new proofs in592f844

- Texture CPU upload/mipmap metadata now preserved separately from native contents, like buffer
  validation/repacking shadows. Test-only surface adapter, no production methods. Native rendered
  contents must not overwrite a backend's original CPU recovery/generation metadata.
- Failed native mutations other than handled shader/pipeline creation explicitly reject compaction
  (backend may mutate before error). Never credit failed clears as reset provenance. Units test
  full clears, incomplete aspects, partial scissor/write masks, read-before-reset, deletion/reuse.
- Services E2E now covers returned Asyncify+JSPI and true suspended Asyncify (local stack survives,
  memory grows, entropy/time/audio/storage/file handles/input). True suspended JSPI explicitly
  rejects and continues, never fake JSPI fallback. compileC + owned temporary Binaryen transform.
- x64-threads originally failed an incorrect sensitivity check: it completes in update2, so suffix
  updates2..25 are constant. Independent probe proves update1 hash cd490007/exited0 -> update2
  hash57670827/exited1, checksum d494e6e3159c5fea processed96 exits406 errors0 PASS.
  Test now asserts saved LIVE hash differs from first suffix hash and exit1, plus every-update
  hashes/pixels equal across original/in-memory/file restores (24 updates); no existing test weakened.
  JSPI x64 fixtures are suspended and explicitly unsupported as approved; returned fixture proves
  actual JSPI restoration separately. Probe evidence scratch/thread-timing/probe.json.
- x64-gl-fbo early checkpoint exact suffixes pass both backends, sparse memory avoids prior crash.
  Last source added early-vs303-update serialized size bound; this exposes the new failure below.

## Measurements (focused run, not long failing run; local Apple M4/Chromium)

Inline attachments in reports/k42-focus-results.json are source evidence. No game or hardware claim.
- CC0 packed-stencil clear-per-frame fixture after306 updates: WebGL2 file3012163 bytes,
  early3012129; residual10commands/1update; snapshot343ms; restore12ms(in-memory)/79ms(file).
  WebGPU2990397 vs2990364; snapshot63ms; restore13/83ms. Returned JSPI comparable.
- x64-gl-fbo early Asyncify: GL8714673 bytes, snapshot90ms, restore33/309ms;
  WebGPU8535581 bytes, snapshot58ms, restore32/291ms. These are EARLY checkpoints only.
- Threads early Asyncify:9250456 bytes, GL restore22/315ms; GPU24/317ms.
- Three suffixes every-update hashes and framebuffer bytes match in focused tests. Long9-minute
  real game, cross-browser/vendor pixels, suspended JSPI and physical device guarantees NOT claimed.

## Approved next design: exact known-constant per-aspect packed provenance

Reviewer response this session:
“Approve the exact known-constant per-aspect provenance (from initialization and full clears;
invalidated by any potentially writing draw per pipeline write masks/ops, blits, uploads, copies),
with regressions for each invalidation path and both backends. Checkpoint now with the plan;
a fresh session implements it and restarts gates; don't weaken the long x64-gl-fbo test.”

Why: x64-gl-fbo default texture900 format5 initializes depth1/stencil0, clears depth every frame,
never clears or uses stencil. Current proveResidual forgets exact initial constants and requires
both aspects reset inside2updates, so long WebGL2 snapshot rejects unnecessarily.

Plan for next session (NOT implemented):
1. Extend resource/provenance scan in bgt/runtime/savestate-gpu.ts to keep per-mip/aspect known
   constant values (depth bit pattern, stencil byte), initialized by actual TEXTURE_CREATE and mip
   allocation semantics, refreshed ONLY by proven full clears. Current base.frame must encode
   these proofs so periodic re-compaction does not forget provenance. Handle resource generations.
2. Track current pass, pipeline, scissor and immutable write masks/ops. Any potentially writing
   DRAW/DRAW_INDEXED invalidates the aspect unless proven no writes (depth_write false, stencil
   disabled/zero mask/all ops KEEP, etc). Do not assume depth-test failure, full coverage or shader
   behaviour. BLIT/copy destination aspect invalidates conservatively; uploads invalidate (even
   if constant-looking unless exact full-data proof added deliberately). Reallocation initializes
   new mips; deletion discards generation. Native failed mutations remain unsupported.
3. Emit synthetic native pass/full-aspect clear commands in compact base for the known constants
   (no guessed depth/stencil readback). Restore known constants exactly; residual proof requires
   full resets before consumption/end only for UNKNOWN aspects. All safe resources are still
   read back at the residual START in a temporary renderer; preserve bounded suffix dependencies.
4. Common cut still <=2updates/100000commands. Unknown aspects outside window explicitly reject.
   New regression: immutable initial stencil0 + changing depth accepts after300+; potentially
   writing stencil/depth draws, masked/scissored clears, blits, uploads/copies invalidate known
   constants and require residual clear or reject, both backends. No skipping/weakening long test.
5. Re-run exact focus/long gates; save new measurements. Then serial full Tier1 and independent
   vK42b review; fix findings before acceptance. Update docs/savestates.md and docs/handoff/K42.md
   with actual supported limits/proof, no prototype history-scaling claim.

## Runnable scripts / restarts

No suite running now. Scripts under scratch (never delete root):
- focus.sh: focused4unit specs, production-size.mjs, dual sample2d/x64-gl-fbo/x64-threads builds,
  all savestate E2E both required backends, example probes, types+targeted lint. Current tests
  include failing long case inside savestates.spec.ts; script continues probes after E2E failure,
  so inspect focus-e2e.exit separately. Logs overwritten on rerun: archive old evidence first.
- final-runner.sh: long savestates.spec.ts both backends then tier1.sh, stops on fail. Launched
  pid96032 this session, finished after long failure; not alive/active work claim.
- tier1.sh: doctor/lint/types/finalunits/dualbuild/fullE2E bothmodes/leak/oracles serially, stop
  on fail. Every pipeline config automatically listed in gates/oracle-targets.txt. It does NOT
  explicitly require NodeJSPI oracle second matrix yet; inspect accepted pipeline finish contract.
- production-size.mjs: archive base only bgt/web, link installed dependencies, measure same
  build options as production unit, remove owned archive. No installs/web.

Never modify running shell scripts (K42c did so while old focus waited; it happened to reread
correctly, but avoid relying on that). Full unit baseline took2hours cold; final cache may help.
No push; commits only lane/K42. Fresh session should inspect exit markers first, implement approved
provenance extension, then background serial gates and independent re-review. End without compaction.
