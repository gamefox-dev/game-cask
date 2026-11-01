# K6a — Q21 GL texture and framebuffer contracts

Verifier continuation of `4db4115` ("WIP (untested)") on `lane/K6a`, based on integration `ca2cd17`.
This fresh session independently reproduced the handoff failures, reviewed the implementation, and repaired the
contracts below. No game files or host-native game execution were used. No push or integration-branch edits.

## Accepted scope (reviewer decision)

The reviewer explicitly accepted finishing/testing the existing Q21 scope, **not full OpenGL 3.3 conformance**.
Integer/SNORM/16-bit-normalised/R11G11B10F/RGB9E5 formats, layered attachments and depth transfers remain explicit
acceptance limits. Unsupported requests must remain visible as GL errors and/or `gl_approximation_kinds`; legal
CLAMP_TO_BORDER and LOD bias are approximated, retained for queries, counted, and do not produce GL errors.
This lane does not prove the unchanged target reaches its title or completes Q21/Q22.

## Implementation inherited and verified

- Additive ABI §13.7: `TEXTURE_CREATE_EX`, `TEXTURE_UPDATE_EX`, `SAMPLER_CREATE_EX`, `TEXTURE_READBACK`,
  `TEXTURE_GENERATE_MIPS` (0x59..0x5d). Both backends; legacy layouts/opcodes and the 80-byte limits struct unchanged.
- Texture storage, transfer validation/conversion, 2D/3D/2D-array state and queries in
  `platforms/win32/w32_gl_fmt.h` / `w32_gl_tex.h`; depth NULL allocation does not attempt a forbidden depth upload.
- Renderbuffers, framebuffer attachments/completeness, DrawBuffer(s)/ReadBuffer and queries in `w32_gl_fbo.h`.
  General pass/readback lowering in `w32_gl_draw.h`, sampler3D/sampler2DArray shader support on both backends.
- `examples/x64-gl-fbo`: original CC0 normally compiled Win64 -O2/CRT fixture, guest GL-error/status/value checks and
  eight pixel tiles. Explicit mip levels 0/1/2 remain separately uploaded and asserted; only volume/array use generation.
- Existing `x64-gl` fixture changes are legitimate: a one-level render texture needs a non-mip min filter, and its
  sampler object must be unbound for those texture parameters to take effect. The old fixture was incomplete in GL.

## Verifier repairs and regression evidence

1. **False "guest logs nothing" diagnosis:** logs start with `guest: `; the test filtered them all out. Eight updates
   also precede asynchronous shader/link/readback startup. Tests now wait for the explicit completion summary and
   inspect post-startup frames. Wrong RGBA16F assertion expected an extended opcode although format 4 uses legacy create.
2. **Framebuffer completeness:** read/draw buffer completeness rules apply to the object regardless of the query's
   binding target. The depth-only FBO now correctly returns INCOMPLETE_DRAW_BUFFER, then INCOMPLETE_READ_BUFFER,
   then COMPLETE; no fabricated success.
3. **Readback OOM:** each tiny texture query allocated a fresh 2 MiB band. Reuse bounded scratch sized to the actual
   band; the fixture no longer exhausts profile allocation space or raises spurious GL_OUT_OF_MEMORY.
4. **Disabled draw buffers:** distinct scratch images per discarded output; duplicate image 904 violated §13 when two
   outputs were disabled. Fixture draws with two GL_NONE outputs and keeps exact pass/command-error assertions.
5. **Transfer semantics:** RGB ignores uploaded alpha (alpha reads/samples as one); 2D transfers ignore image-height /
   skip-images state; requested row stride survives ReadPixels clipping; mip-size limits shrink per level. Fixture
   checks pixel-store skips/sentinels, RGB alpha, invalid nonzero-level size, and a clipped two-row rendered read.
6. **LOD/completeness:** honor MAX_LEVEL when clamping sampler LOD, reject BASE_LEVEL > MAX_LEVEL as incomplete,
   and preserve BASE_LEVEL for non-mip sampling. Three sections of the explicit-mip tile check LOD 1, MAX_LEVEL 1,
   and BASE_LEVEL 1. Nondefault 3D wrap-R exercises SAMPLER_CREATE_EX. Renderbuffer deletion detaches both bound FBOs.
7. **Recovery ordering:** snapshot the mip-generation upload source, replay generation before subsequent explicit
   uploads, and keep generated recovery shadows current for partial updates. New native browser regression checks
   base blue / explicit mip green / generated mip red, partial white over generated red, and request failure on loss,
   on both backends. Lost/error texture-readback paths finish requests instead of leaving them pending forever;
   WebGL defers extended resource operations during context loss as it does legacy resource operations.
8. **Fixture UB / stale state:** level-1 GetTexImage wrote 16 bytes into a four-byte array; corrected the buffer.
   Removed a uniform update using the previous program's location. Browser checks now reject unexpected GL errors
   in frames after the PASS summary, not just errors in startup.
9. New shared-helper unit checks cover canonical legacy ops, volume depth halving, independent array mip layers,
   nonzero generation base, sRGB-linear averaging, float values above one, and packed RGB10A2. Native browser tests
   round-trip all six additive formats in all three dimensions (18 cases/backend), before and after restoration.
10. **Enum/wire contracts:** DrawBuffers rejects aggregate BACK while accepting BACK_LEFT; ReadBuffer rejects
   FRONT_AND_BACK. Depth-only and depth-stencil external/internal format combinations are validated separately,
   including NULL depth-stencil allocation. Legacy sampler state now stores the LOD maximum as IEEE f32 bits,
   not the integer 1000. Resource-create results are asserted before testing comparison-sampler rejection.
11. The existing WebGPU opcode-coverage test compared a 0x40..0x58 filtered set against the newly extended enum.
   It now runs the FBO fixture as well and asserts **every opcode 0x40..0x5d**, rather than shrinking its assertion.

The recording backend deliberately does not rasterize or generate mip pixels. Its exact expected failed guest notes
are the eight render-dependent checks listed in `tests/unit/x64-gl-fbo.test.ts`; browser tests must pass every check.
It is not evidence for rendered pixels. `gl_approximations` is exactly **4** in this fixture: border wrap, nonzero LOD
bias, unsupported R32I, and depth ReadPixels. The corresponding four kinds are asserted, not silently accepted.

## Verification

**Tier 1 green on the final implementation.** Commands ran through the machine-wide FIFO npm/npx gate.

| Check | Actual result |
|---|---|
| `npm run doctor` | ready; Node 24.19.0, Zig 0.13.0, Chromium installed; original/ empty |
| `npm run lint` | exit 0: ESLint, host compiler checks with clang 21 and real `/opt/homebrew/bin/gcc-14`, **25 example check-builds** |
| `npm run typecheck` | exit 0 |
| `npm test -- --maxWorkers=2` | **54 files, 592/592 tests passed**, none skipped; 189.85 s |
| `BGT_E2E_PORT=5211 BGT_REQUIRE_WEBGPU=1 npm run test:e2e` | **205 passed, 51 expected skips, 0 failed / 0 flaky**; 256 selected, 298.62 s |
| `npm run leakcheck` | exit 0; staged pre-commit leakcheck also required |
| Pipeline oracles | **21/21 identical at 300 frames**, 6,300 compared frame pairs, no lifted/interpreted errors |

Browser breakdown: WebGL 2 **93 passed / 24 skipped**, WebGPU **104 / 26**, auto **8 / 1**. Skips are the existing
backend-only and opt-in/injected-availability cases, not skips of this lane's pixels or WebGPU absence.
All 22 FBO pixel probes and all guest self-checks pass on both backends. All **30 opcodes 0x40..0x5d** are observed
in the native WebGPU coverage test. Recovery/format tests round-trip **18 cases on each backend**, before and after
restoration. FBO images: `different=0`, `unmatched=0`. Existing GL images:
`different=0.011039737654320987`, `unmatched=0`; smoke comparisons range 0.011039737654320987–0.011047453703703703,
all with unmatched=0. Existing `gl_pipelines === 5` / seven scenes and smoke readback checks remain green.

All pipeline examples checked: win32-conformance, win32-hello, x64-audio, x64-basics, x64-contracts, x64-cpp,
x64-cpprt, x64-crt, x64-gl, x64-gl-fbo, x64-gui, x64-handles, x64-input, x64-memory, x64-scale, x64-smoke,
x64-sysdlls, x64-threads, x64-tls, x86-handles, x86-threads. Later unit tests overwrite some oracle reports with their
70/400/600-frame workloads; those three reports were refreshed afterward with explicit 300-frame CLI runs.

Intermediate failures are retained honestly: focused reproduction **122/124**, then **123/124**, then **124/124**;
focused native browsers **8/8**. First full unit run under heavy parallel compilation: **582 passed, 2 timed-out tests,
8 tests skipped by a timed-out setup hook** (54 files: 51 pass / 3 fail). No correctness assertion failed there;
rerunning the entire suite with two workers passed all 592 without changing timeouts/assertions. First full browser
run: **204 pass / 51 skip / 1 fail**, the stale opcode-coverage expectation fixed above. A concurrent full-unit/full-
browser rerun transiently observed a missing x64-gl manifest while unit tests rebuilt that output; the final full
browser run was sequential after units and passed all 205. No retry/allowlist/tolerance workaround was added.
The expected `file lock timeout ... group-test-*/same.flock` diagnostic belongs to the lock-exclusion regression;
its test passed. Final raw logs live outside Git in `/tmp/k6a-{test-final,e2e-green,lint-green,types-green,leak-final}.log`
and `/tmp/k6a-oracle-*.log`; machine-local paths are not a promise of permanent artifact retention.

Cross-backend tolerances remain `different <= 0.015`, `unmatched <= 0.001`; no tolerance was relaxed. The FBO spec
has **22** interior pixel probes (channel tolerances 2–3), GL-error assertions, all guest self-checks, and zero
runtime / command / unimplemented / stub errors. Hardware pixels and WebGPU are required in the final browser run;
no software-renderer pixel skip is requested. Desktop Chromium GPU validation is not iPhone verification.

## Acceptance limits / remaining kit gaps

- No integer/SNORM/16-bit-normalised/R11G11B10F/RGB9E5/compressed internal formats; GL error plus metric entry for
  known unsupported formats. Some low-bit normalized formats use wider storage; queries expose actual stored bits.
- No layered/3D attachments, depth 3D/array textures, cube/1D/rectangle/multisample textures, PBOs, or depth/stencil
  pixel upload/readback. No CopyTexImage / BlitFramebuffer / ClearBuffer*. Differing attachment sizes may return
  FRAMEBUFFER_UNSUPPORTED (reviewer-approved). Inconsistent mip chains are explicitly counted as unrepresentable.
- Swizzle, byte-swap and LSB-first are accepted as counted approximations. Border wrapping approximates edge;
  nonzero LOD bias is ignored with a metric, while original parameter values remain queryable.
- Restored generation is derived from upload snapshots; rendered contents are lost, as for all attachments.
  Generated recovery shadows use CPU box filtering; native rounding/odd-extent choices can differ. Explicit uploaded
  texels are preserved. Float32 filtering/blending requires the documented optional native features/extensions.
- Broader GLSL reflection/preprocessing and default vertex-attribute/source-query requests are outside this accepted
  texture/FBO scope; this is not a claim that the entire target startup or every GL 3.3 entry point is implemented.
- `docs/v03-status.md` is intentionally left for integration. The untracked `.k6a-focused.config.ts` was deleted;
  no local test configs are committed. This continuation itself is the fresh verifier session; no further agent
  delegation or hardware/iPhone validation is claimed.
