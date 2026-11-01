# K6a — Q21 GL texture and framebuffer contracts (WIP, UNTESTED beyond a partial unit run)

Branch `lane/K6a` on integration commit `ca2cd17`. **Status: code complete enough to verify, not verified.**
No Tier 1 gate, no browser run, no oracle run has been executed on this tree. This note is for the **verifier** who
continues in this clone. Nothing here claims a level, a pixel result, or a passing gate.

## What is implemented (all unverified in browsers)

### ABI additions (additive, ABI.md section 13.7, opcodes 0x59..0x5d, approved by the reviewer)
`TEXTURE_CREATE_EX` (2D/3D/2D-array, new formats RGB10A2=7, R16F=8, RG16F=9, R32F=10, RG32F=11, RGBA32F=12),
`TEXTURE_UPDATE_EX`, `SAMPLER_CREATE_EX` (wrap_w, min/max LOD), `TEXTURE_READBACK` (request based, colour only),
`TEXTURE_GENERATE_MIPS`. Legacy ops and the 80-byte limits struct are unchanged. Touched: `bgt/runtime/abi.ts`,
`bgt/include/bgt_gpu.h`, `bgt_gpu_cmd.h`, `bgt/runtime/commands-gpu.ts`, `bgt/runtime/commands.ts` (dispatch range now
ends at `TEXTURE_GENERATE_MIPS`), `bgt/renderers/types.ts` (`GpuItem.readback`), shared helpers in new
`bgt/renderers/gpu-texture.ts`, WebGL 2 (`webgl2/gpu.ts`, `shaders.ts`), WebGPU (`webgpu/gpu.ts`, `shaders.ts`
for `sampler3D`/`sampler2DArray`, `probe.ts` requests optional `float32-filterable`/`float32-blendable`).
WebGPU 3D mip generation is a CPU box filter over the upload shadow; 2D/array use render-pass blits.

### GL profile (`platforms/win32`)
New headers `w32_gl_fmt.h` (internal-format table, transfer validation, texel conversion, `gl_approximations`
metric), `w32_gl_tex.h` (textures, 2D/3D/array TexImage/TexSubImage, GenerateMipmap, all TexParameter/
SamplerParameter/Get* entries, GetTexImage, per-level state, proxies), `w32_gl_fbo.h` (renderbuffers, FBO attachments,
spec completeness, DrawBuffer(s)/ReadBuffer, attachment/renderbuffer queries). `w32_gl_draw.h` now resolves a
`Target` (multi colour, depth-only, stencil-only, default FB), builds passes from it, uses texture completeness with
(0,0,0,1) fallback textures, pads fragment outputs missing from the pass with a scratch target, and has a general
`glReadPixels`. `w32_gl_shader.h` handles `sampler3D`/`sampler2DArray` (`bgt_gl_uv3`) and fragment output counting.
`w32_core.c` publishes `gl_approximations` and `gl_approximation_kinds`.
Per reviewer item 1: CLAMP_TO_BORDER, non-zero LOD bias, swizzle, byte-swap/LSB-first are accepted and counted as
approximations; unsupported internal formats raise `GL_INVALID_ENUM` and are listed in the same metric.

### Fixtures and tests
`examples/x64-gl-fbo` (new, CC0, -O2 CRT Win64): guest self-checks (`x64-gl-fbo ok|FAIL <name>` log lines, final
`x64-gl-fbo PASS failures=0`) plus eight screen tiles. Tests: `tests/unit/x64-gl-fbo.test.ts`,
`tests/e2e/x64-gl-fbo.spec.ts` (20 pixel probes, cross-backend comparison, tolerance 1.5 percent different /
0.1 percent unmatched, same as x64-gl), new cases in `tests/unit/gpu-commands.test.ts`, extended
`abi-layout.test.ts` and `tests/fixtures/c/gpu_probe.c`. `tests/support/x64-gl-stream.ts` recorder now completes
`TEXTURE_READBACK` from uploaded texel memory (never rendered output). `tests/oracle/oracle.ts` includes `x64-gl-fbo`.

### Changes to existing tests/fixtures (review these)
- `examples/x64-gl/gl.c`: added `glTexParameteri(MIN_FILTER, LINEAR)` on `render_texture` and unbinds the sampler
  object around that one draw. Exact completeness made the old fixture sample black on a real driver.
- `tests/unit/x64-gl.test.ts`: `glGenerateMipmap` is now asserted as one `TEXTURE_GENERATE_MIPS [1,0]` op and a single
  level-0 upload (previously a CPU-built level-1 upload `[127,127,127,128]`). Reviewer item 2 (explicit level
  uploads asserted level by level) is covered in `x64-gl-fbo.test.ts` (levels 0,1,2 as separate `TEXTURE_UPDATE`s).
- `api_ClearColor` no longer clamps to [0,1] (float targets); blend constant still clamps.

## Evidence so far (honest)
Two partial runs. Run 1 (full global setup, `x64-gl`, `abi-layout`, `gpu-commands`): **13 failures / 80**. The cause I
found: `commands.ts` only dispatched GPU opcodes up to 0x58, so the new ops returned `E_UNSUPPORTED` (fixed).
Run 2 (`.k6a-focused.config.ts`, 7 files, includes that fix): **120 passed / 4 failed of 124**. Passing in run 2:
`x64-gl.test.ts` (including its 300-frame oracle), `abi-layout`, `gpu-limits`, `gpu-webgpu-shaders`, `webgpu-probe`,
the other `gpu-commands` cases. The 4 failures:
1. `gpu-commands` "accepts every GPU op": the set of ops lacked 0x59..0x5d. **Fixed in test** (added a block).
2. `gpu-commands` §13.7 rejects: `TEXTURE_UPDATE_EX [1,1,0,0,0,1,1,2,...]` returned 0. Mip 1 of the 2x2x4 volume is
   1x1x2, so depth 2 is valid; my expectation was wrong (E_INVALID vs E_NOT_FOUND was a different, earlier run-1
   line: `-5` there was `E_NOT_FOUND`). **Fixed in test** (depth 3, 12 bytes → `E_BOUNDS`). The earlier
   `inPass(O.TEXTURE,[0,8,8])` expectation (`E_INVALID`) may still be wrong: in run 1 it returned -5 (`E_NOT_FOUND`);
   likely cause is the sampler/texture 8 creation being rejected earlier in that test. Check by reading the statuses of
   the two preceding `t.send` calls.
3. and 4. `x64-gl-fbo.test.ts`: **no `x64-gl-fbo` log lines at all** and no `DEPTH32F` `TEXTURE_CREATE` in 8 steps. The
   guest apparently never reached its first note. **Root cause unknown** (not reproduced since). Prime suspects, in
   order: (a) the guest hit `ExitProcess` in `shader()`/`program()` (profile `collect()` rejecting a uniform, or link
   failure); the unit test now prints all guest logs on failure; (b) a NULL function pointer from
   `wglGetProcAddress` for a name missing from the registry; (c) the guest never ran (loadHeadless/manifest). Run
   `node tools/build/build.mjs examples/x64-gl-fbo` then the unit test and read the logged guest output first.

## Suspicious / likely-wrong tests and expectations
- The `RENDER_DEPENDENT` list in `x64-gl-fbo.test.ts` is my prediction of notes the recording backend cannot satisfy
  (render and GPU mip results); the exact list may differ.
- `gl_approximations` is expected to be exactly 2 (`internalformat unsupported 0x8235`, then
  `glReadPixels of depth/stencil or integer data`); any extra `approximate()` call changes it.
- E2E probe colours (e.g. depth 64/191, RGB10_A2 `[255,128,0]`, RGBA16F `[191,32,0]`, 3D quadrant colours) are
  computed by hand, never observed. Tolerances 2 to 3.
- `x64-gl` e2e still expects `gl_pipelines === 5` and the existing seven-tile goldens; the FBO texture tile relies on
  the fixture change above and must be rechecked on both backends.
- Possible WebGL 2 issue: depth-only passes whose shader declares a colour output are padded with a scratch target
  (`program->nout`); check pipeline creation succeeds on both backends.
- WebGPU: `float32-filterable` requested via `probe.ts`; mocks without `adapter.features` are tolerated (`?.`), but
  `webgpu-probe.test.ts` passed in run 2 only because requestDevice is called with `undefined` when none is available.

## Known limits (document in release notes)
No layered/3D attachments (FramebufferTextureLayer/3D remain unsupported stubs), no cube/1D/rectangle/multisample, no
integer/SNORM/16-bit-normalised/R11G11B10F/RGB9E5/compressed internal formats (GL error plus metric entry; the
reviewer prefers real support where both backends have native equivalents, not done), differing attachment sizes
report `FRAMEBUFFER_UNSUPPORTED`, depth/stencil pixel upload and depth readback unsupported, no PBOs, no
CopyTexImage/BlitFramebuffer/ClearBuffer*, depth 3D/array textures unsupported, GENERATE_MIPS after device restore is
recomputed from uploads (rendered content lost), 32-bit float linear filtering/blending needs backend extensions.

## Commands for the verifier (all through the gate; port 5211 for Playwright)
```sh
cd /Users/dev/projects/pi-work/lane-K6a
export PATH=/Users/dev/projects/pi-work/harness/shim:$PATH
node tools/build/build.mjs examples/x64-gl-fbo          # then read guest output of the unit test
npx vitest run --config .k6a-focused.config.ts          # 7 files; keep .k6a-focused.config.ts (untracked on purpose)
npm run doctor && npm run lint && npm run typecheck && npm test
BGT_E2E_PORT=5211 npm run test:e2e                       # both backends; x64-gl and x64-gl-fbo specs
npm run leakcheck
```
Pipeline examples (20 from I4 plus `x64-gl-fbo`): win32-conformance, win32-hello, x64-audio, x64-basics, x64-contracts,
x64-cpp, x64-cpprt, x64-crt, x64-gl, x64-gl-fbo, x64-gui, x64-handles, x64-input, x64-memory, x64-scale, x64-smoke,
x64-sysdlls, x64-threads, x64-tls, x86-handles, x86-threads.

## Remaining finish-line items
1. Diagnose and fix the `x64-gl-fbo` guest not logging (above); then align `RENDER_DEPENDENT`.
2. Run Tier 1: doctor, lint (all example check-builds, now one more example), typecheck, `npm test`, `test:e2e`
   on WebGL 2 and WebGPU, leakcheck, every oracle at 300 frames.
3. Observe real pixels in `x64-gl-fbo.spec.ts` on both backends; fix probe values or bugs; record the cross-backend
   comparison numbers and the tolerance in this file.
4. Check `x64-gl`/`x64-smoke` e2e (`gl_pipelines === 5`, seven tiles, readback `13,13` / `0,22,0`).
5. Consider real SNORM/integer format support (ABI formats, integer samplers, integer fragment outputs).
6. Update `docs/v03-status.md` only at integration, not here.
