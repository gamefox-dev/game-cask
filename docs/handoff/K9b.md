# K9b handoff — Q35 framebuffer blits checkpoint

## Status

Q35's bounded **single-sample** transfer path is implemented and browser-certified in this checkpoint; multisample allocation/resolve remains outside the existing ABI/profile capability, so unrestricted GL 3.3 Q35 conformance is not claimed. Q34 transform feedback is **unfinished** and must be the next lane continuation; no Q34 success or first-draw target claim is made. The branch contains no captured target shader/source or game files. All fixture sources are original CC0-1.0.

Implementation commit: **`3776c8e`** (`feat(gl): implement ordered framebuffer blits`). All checks below were rerun on its identical executable tree before the documentation-only handoff amendment. The final follow-up commit changes documentation only. Working tree was clean after the 26 final oracle runs. No push, web access, system installs or ENOSPC occurred.

## Q35 delivered

- Additive BGT §13.10 `BLIT` opcode `0x60`, 72-byte C/TS layout and encoder, with validation for 2D attachment textures, default logical screen, mip bounds, color-class compatibility, depth/stencil format compatibility, integer NEAREST-only rules, masks, filter, scissor and ordered outside-pass execution.
- WebGL 2 uses native `blitFramebuffer` for compatible transfers. A standalone raw-WebGL isolation reproduced Chromium's native scaled-stencil mismapping without a GL error; scaled/flipped stencil therefore uses a general fallback that extracts the rendered stencil with stencil tests and writes destination bits with masked `REPLACE`. It never reads upload shadows.
- WebGPU uses a native texture copy for compatible 1:1 transfers and draw-based color/depth transfers otherwise. Stencil is transferred through rendered bit planes and real stencil tests. Same-image transfers snapshot the source. Screen transfers use the shared logical staging texture.
- GL profile `glBlitFramebuffer` now validates source/draw FBOs, rectangles, filter/mask/aspect compatibility, default framebuffer and ordered command emission. GL §4.3.2 behavior is used: destination scissor clips the transfer; color/depth/stencil write masks are ignored. The fixture asserts both. Unsupported/invalid operations report GL errors rather than succeeding silently.

## Fixture and evidence

`examples/x64-gl-blit` is a normal Win64 -O2/CRT pipeline fixture with **46 guest checks** per real backend and four final image probes. It asserts scaled, flipped, linear, clipped, scissored and same-image color transfers; depth/stencil transfers; rendered stencil values different from upload data; default framebuffer source/destination; integer class rejection; invalid filter/mask/incomplete-FBO errors; and ordered repeated transfers. `tests/e2e/x64-gl-blit.spec.ts` runs both actual backends and exact cross-backend image comparison. The recording unit test deliberately expects raster-dependent failures and checks all BLIT transport/aspect/error items.

Focused/current evidence from this session:

- `npm test -- --maxWorkers=1`: **792 tests / 67 files passed**, exact-commit rerun 262.28 seconds.
- `BGT_REQUIRE_WEBGPU=1 npm run test:e2e`: **221 passed / 51 existing intentional skips / 0 failed**; includes 3 Q35 tests and both actual backends.
- Pipeline oracles: **26 examples × 300 frames = 7,800 identical pairs**, including `x64-gl-blit`; all exit 0, null errors, lifted `interp_insns=0`, empty stub lists. Every example was built first by the required e2e command. Explicit inventory: win32-conformance, win32-hello, x64-audio, x64-audio-init, x64-basics, x64-contracts, x64-cpp, x64-cpprt, x64-crt, x64-gl, x64-gl-blit, x64-gl-current, x64-gl-fbo, x64-gl-integer, x64-glsl, x64-gui, x64-handles, x64-input, x64-memory, x64-scale, x64-smoke, x64-sysdlls, x64-threads, x64-tls, x86-handles, x86-threads.
- `npm run lint`: pass, including ESLint, Clang/GCC host checks and example check-builds.
- `npm run typecheck`: pass.
- `npm run doctor`: pass on the final checkpoint.
- `npm run leakcheck`: pass, **542 committable files** checked.
- Raw native isolation: `/tmp/k9b/native-stencil.mjs` and `.log` (scratch only; not repository evidence).
- The final blit image has four expected colored quadrants, asserted by pixel probes; no separate screenshot-viewing claim is made.
- No independent source review was available: the bridge request timed out and defaulted to pending. Do not attribute these checks to an independent validator.
- Final exact-commit logs: `/tmp/k9b/commit-{doctor,lint,types,unit,e2e,leak}.log`, `/tmp/k9b/commit-oracle-*.log`, `/tmp/k9b/commit-oracles.json`; ignored `reports/oracle-*.json` and `reports/e2e-results.json` contain local structured results. Scratch paths are not durable artifact guarantees.
- Failed intermediate attempts are not passing evidence: the first full baseline invocation exceeded its 1,800-second tool timeout without a summary; later full runs above passed. The original native-stencil fixture failed on WebGL and correctly drove raw native isolation plus the fallback. A temporary debug fixture changed source color; it was repaired by restoring original uploaded colors after the source-stencil probe, not by relaxing any expected pixel. Final fixture has 46 checks, exact error assertions and 23 explicitly expected raster-dependent failures only in the non-rasterizing recorder.

## Executed GL gap census

Using the supplied localization and both later sample captures, excluding optional `wglGetProcAddress` misses:

| API | WebGL2 evidence | WebGPU evidence | outcome |
|---|---|---|---|
| `glTransformFeedbackVaryings` | executed stub | not observed in the later intersection | **Q34 unfinished**; current profile entry remains a truthful `GL_INVALID_OPERATION` stub |
| `glBeginTransformFeedback` | executed stub | executed stub | **Q34 unfinished**; truthful `GL_INVALID_OPERATION` stub |
| `glEndTransformFeedback` | executed stub | executed stub | **Q34 unfinished**; truthful `GL_INVALID_OPERATION` stub |
| `glBlitFramebuffer` | executed stub | executed stub | **Q35 single-sample path fixed** on both backends and profile |
| `glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER, …)` | executed API, target currently rejects non-`UNIFORM_BUFFER` | same profile path | **Q34 unfinished**, currently truthful `GL_INVALID_ENUM`; uniform-buffer form remains implemented |

No other GLSTUB name intersects the executed later samples. The large fixed-function compatibility-name list is optional lookup evidence, not executed-call evidence. The early 900-frame localization had no GLSTUB intersection.

## Exact continuation for Q34

1. Add a separate additive §13.11 transform-feedback ABI, mirrored in `bgt_gpu.h`, `bgt_gpu_cmd.h`, `runtime/abi.ts`, decoder/layout tests and both backends. It must carry linked vertex pipeline, primitive mode/count/instance ordering, selected output interface and interleaved/separate buffer bindings. Keep this in a new module; do not rewrite lane K9a's GLSL translator entry points.
2. Extend `Program`/GLSL profile state for `glTransformFeedbackVaryings` before link, INTERLEAVED/SEPARATE relink semantics, `glGetTransformFeedbackVarying`, transform-feedback buffer base/range bindings, primitive-mode errors, begin/end state, rasterizer discard and primitives-written queries. Unsupported paths must remain explicit GL errors until the ABI/backend path exists.
3. WebGL 2 backend should use native transform feedback with a linked varying declaration. WebGPU needs a general vertex-to-compute lowering module: invoke the canonical vertex stage over the same attribute/uniform bindings, preserve selected varying order and exact buffer layout, and make subsequent draws consume the captured buffer. Do not use a game-specific shader or CPU shadow substitute.
4. Add an original CC0 fixture for interleaved and separate capture, rasterizer discard, primitive-written query, pause/resume if exposed, then a draw from captured data, with exact buffer bytes, query values, errors, ordering and cross-backend pixels. Add the target-independent executed-API census to the next handoff.
5. Re-run leakcheck, full tier-1 checks, every pipeline oracle at 300 frames, and obtain a fresh independent validation session before claiming K9b completion.

## Known boundaries

- Multisample storage/resolve remains explicitly unavailable (existing MAX_SAMPLES=0); no multisample GL 3.3 acceptance claim is made.
- Q34 is not implemented; the profile still has four truthful transform-feedback stubs/related rejection as listed above.
- The Q35 fallback is deliberately scoped to the general GL transfer contract and is not a game-specific path. WebGL native behavior is retained for compatible color/depth/1:1 cases.
- This checkpoint does not claim the target reaches its first draw/title. The target evidence remains L0; no original executable was run.
