# Integration I5 — K6a textures/FBOs with K6b GLSL, and dimensional sampler enablement

## Delivery

`integration/p1`, starting at `6187dc8`, merges `lane/K6b` (`0b941ad`) with **`--no-ff`** after the already merged
K6e, K6a, K6c and K6d. No push, dependency/system install, web/private-game-file access, host-original execution or context
compaction. Only original CC0 kit fixtures are used. Browser validation owns **port 5216**, never developer `:5173`.

**Tier 1 is not claimed fully green:** the final unchanged default unit suite has five failures in
`tests/unit/pi-harness.test.ts` caused by sandbox-denied `ps` in the merged K6e gate. Reviewer decision: keep the
sandbox/tests unchanged, do not cherry-pick K7i's pending sandbox-safe repair, complete all other gates here, commit,
and have the reviewer validate that file outside the sandbox on the exact committed tree. **Sandbox ps denial,
external validation pending.** The reviewer will append that result; this handoff does not invent it.

## Meaning-based conflict resolution

- `platforms/win32/w32_gl.c`: K6b's pooled shader/program/frontend objects replace the old fixed reflection objects;
  K6a texture, sampler, renderbuffer and FBO state remains in its dedicated headers.
- `w32_gl_shader.h`: retain K6b preprocessing, real backend compile/link status/logs, source/attachment queries,
  active uniform/block/attribute reflection and uniform state. K6a's output span is computed from **linked** output
  locations, not raw source: preprocessing, implicit locations and `glBindFragDataLocation` affect pass lowering.
- `w32_gl_draw.h`: retain K6a framebuffer completeness, general pass/MRT/depth/scratch-output lowering, feedback
  detection, texture completeness, fallback textures, extended samplers and readback. Iterate K6b reflected sampler
  slots and `slot_unit[]`, and upload/bind exactly `p->usize`, not the former fixed 4096 bytes.
- `tests/oracle/oracle.ts`: the stream-comparing set is the union: `x64-gl`, `x64-gl-fbo`, `x64-glsl`, `x64-smoke`.
- K6a's `w32_gl_tex.h`, `w32_gl_fbo.h`, `w32_gl_fmt.h`, ABI §13.7, and native backend `gpu.ts` implementations are
  unchanged by this integration. All old opcodes/layouts/80-byte limits are retained. No lane test was dropped.

## Enabled hook and regression evidence

`gs_sampler_capability` now permits floating `sampler3D` and `sampler2DArray` alongside 2D/shadow. Reflection retains
GL enums; per-slot ABI `slot_dim[]` metadata is separate from sampler texture-unit values. Constant sampler-array
elements retain their slot dimensions. Draws bind the selected target on the selected unit; differently typed active
samplers aliasing one unit produce `GL_INVALID_OPERATION`. Dimension-correct completeness fallbacks and wrap-R/LOD
sampler descriptors are retained.

Canonical emission uses the correct GLSL sampler declarations. Sampling flips **Y only**, preserving volume Z and
array layer; volume gradients use vec3, array gradients vec2, and integer fetches retain Z/layer. WebGL 2 emits GLSL
ES 3.00 `sampler3D`/`sampler2DArray`; WebGPU emits `texture_3d<f32>`/`texture_2d_array<f32>`. Optional shader bias is
lowered to `textureSampleBias` for 2D/3D/array, rather than silently dropped or misinterpreted as an offset.

- Host frontend tests cover typed reflection, dimensional sampler arrays, GLSL ES and WGSL declarations/bindings,
  Y-only coordinate/gradient/fetch conversion and all three shader-bias forms. The existing negative capability
  tests now distinguish the newly supported floating types from still-unsupported cube/integer types.
- `examples/x64-gl-fbo` adds guest `glGetActiveUniform` type/size checks and sampler-unit getter checks for **units
  3 and 5**. Unit-zero 3D/array bindings are explicitly cleared before sampling, so a draw lookup incorrectly using
  unit zero cannot pass. Original slice/layer/FBO/mip/format probes remain; an additional lower-row voxel probe and
  two positive-bias strips bring the browser to **25 interior pixel probes per backend**, unchanged tolerances 2–3.
  Volume bias selects the generated terminal mip `[124,139,139]`, not white base texels; array bias selects an
  explicitly uploaded yellow mip-1 layer, not green base texels. Generation independence is checked before that upload.
- K6b's original fixture used active sampler3D as its unsupported-type diagnostic. It now checks **samplerCube**,
  retaining the negative test; dimensional positive compilation/reflection/pixels are checked separately.
- Recording-backend tests still require the exact eight documented render-dependent failed notes, not fabricated
  pixels. Real browser guest checks must all pass; the fixture's four approximation kinds remain exact.

**Cube maps stay explicitly rejected:** reflection-only host tests can enumerate their GL kinds, but active cube
samplers fail compile/link with a diagnostic. §13.7 has no cube storage. Integer/array-shadow/rectangle/1D/MSAA samplers,
layered attachments, depth transfers and K6a's unsupported format families remain outside the accepted subset.
This is not unrestricted GL 3.3 or game/engine compatibility.

## Independent review and additional repair

Two actual fresh independent pi sessions ran read-only with the bridge disabled, not delegated test claims:

1. `01a195c2-2a04-7673-8167-3e460751dede` found optional shader bias mishandling and the unit-zero pixel-test hole.
   Both were repaired as above, with additive regressions.
2. `01a195cd-c14b-757c-9079-8dda0e652dac` rechecked the repairs and preserved K6a/K6b connections: **PASS within bounded
   static scope**. It ran no builds/tests/browser commands. The integrator's native pixels and suites below supply
   execution evidence, not a claimed independent Tier 1 pass.

The first full browser run also exposed an unrelated timing flaw in the existing pre-first-draw loss regression:
separate `page.evaluate` calls allowed the queued create+delete work to drain before simulated loss (the runtime
can render presentation/resize frames even when guest stepping is paused). Its trace shows the live-handle case correctly stopping, followed by resource-free WebGL fallback in the
create+delete case. Decoding and loss are now in **one browser task**. Both original variants, status, alert and
backend assertions are retained; no retry, timeout, allowlist, skip or tolerance change was added.

## Validation

Final command results are recorded from the retained logs below. Heavy commands run serially through inherited
operator **FIFO npm/npx shims** (`/private/tmp/bgt-heavy-queue`, kill-zero liveness), explicitly directed by the reviewer.
The merged repo's ps-based FIFO gate is precisely the sandbox-blocked subject, not a gate bypass. An initial
foreground lint invocation reached the harness timeout before finishing; the later serial lint gate is authoritative.
The original long full unit run completed before an attempted interrupt (the owned processes had already exited);
no duplicate run or context compaction was used.

| Gate | Result |
|---|---|
| doctor | ready, exit 0 |
| lint | exit 0, including final post-repair recheck: ESLint, clang 21 and real GCC 14.2, all **27 example check-builds** |
| typecheck | exit 0, including post-repair recheck |
| default `npm test -- --maxWorkers=1 --reporter=verbose` | **655 passed / 5 failed**, 59 files; only the five sandbox ps/liveness tests fail, no skips; external file validation pending |
| full required-WebGPU `npm run test:e2e` | **208 passed / 51 expected skips / 0 failed / 0 flaky**, 259 selected, 245.21 s |
| leakcheck | exit 0, including post-repair recheck; staged pre-commit hook also required |
| all pipeline examples at 300 frames | **23/23 identical**, **6,900 frame pairs**, all errors null, zero lifted interpretation and empty lifted stub lists |

Intermediate results are not hidden: first default units **653 passed / 6 failed** (five sandbox failures plus the old
sampler3D-negative fixture expectation); after replacing that expectation, an unchanged-assertion diagnostic run of
the other files passed **625/625 in 58 files**. A subsequent bias regression adds one test, giving the final 660-test
inventory above (**626 non-harness tests plus 29 harness tests passed**). The first full browser run was **207 passed / 51 expected skips / 1 failed**, the queue/loss test race
localized above. Focused dimensional pixels plus native WebGPU contracts then passed **9**, with **6 backend-specific
skips**, and FBO cross-backend `different=0`, `unmatched=0`.

Final browser breakdown: WebGL 2 **94 passed / 24 skipped**, WebGPU **106 / 26**, auto **8 / 1**. All skips are existing
backend-only/tour and opt-in/injected-availability policies; no GPU absence or software-renderer pixel skip is used.
All 25 FBO and nine GLSL probes run on both actual backends. FBO `different=0`, `unmatched=0`; GLSL `different=0.00625`,
`unmatched=0`; existing GL `different=0.011039737654320987`, `unmatched=0`. Smoke ranges
0.011039737654320987–0.011047453703703703 with unmatched=0. Existing bounds **different <= 0.015 / unmatched <= 0.001**
are unchanged. §13.7 format/recovery tests retain 18 round trips per backend before/after restoration; all 30 GPU
opcodes remain required. The integrator also opened both focused FBO screenshots and inspected the volume/array
regions and bias strips; native pixel assertions, not visual similarity alone, provide the numeric evidence.

All oracle reports were re-read and validated against the configuration-derived inventory: requested/completed
frames exactly 300, identical true, null failure stage/error/divergence, exit 0, both errors null, lifted
`interp_insns=0` and `stubs=[]`. The summary is `reports/integration-i5-oracles.json` (ignored).

Pipeline inventory (**23**): win32-conformance, win32-hello, x64-audio-init, x64-audio, x64-basics, x64-contracts,
x64-cpp, x64-cpprt, x64-crt, x64-gl-fbo, x64-gl, x64-glsl, x64-gui, x64-handles, x64-input, x64-memory, x64-scale,
x64-smoke, x64-sysdlls, x64-threads, x64-tls, x86-handles, x86-threads. Four native BGT examples retain build/browser
coverage, not a fabricated guest interpreter oracle. Explicit 300-frame CLI oracles run **after** units/browsers so
reports are not left overwritten by their 70/400/600-frame test workloads.

Private/local evidence: `/tmp/integration-i5/` command logs and exit markers, first-failure trace/console extraction,
`review.md`, `recheck.md` and fresh-session transcripts; ignored `reports/e2e-results.json`, `reports/oracle-*.json` and
`reports/integration-i5-oracles.json`. These machine-local paths are not a permanent artifact-retention promise.
No physical iPhone, Safari/Firefox, remote CI or general real-game compatibility certification is claimed.
