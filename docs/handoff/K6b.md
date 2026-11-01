# K6b — Q22 GLSL preprocessing, reflection and translation

## Delivery

- Branch `lane/K6b` on integration `ca2cd17`. No ABI change, no new opcode/capability, no dependency, no game
  binary, no web access. Shader test sources are our own CC0 files; nothing from `inputs/mm4` was copied.
- The GL profile no longer assumes `uniform TYPE NAME;`. Every `glCompileShader` runs a real front end and every
  `glLinkProgram` a real linker whose result is the canonical §13.5 source sent to the backends.

## Architecture

| piece | where |
|---|---|
| Preprocessor, declaration parser, std140 layout, reflection, link, canonical emission (libc-free C) | `platforms/win32/w32_glsl.h` |
| Shader/Program types and the pooled allocator behind it | `platforms/win32/w32_gl_program.h` |
| GL entry points (compile, link, queries, uniform state) | `platforms/win32/w32_gl_shader.h` |
| WGSL translator extensions | `bgt/renderers/webgpu/shaders.ts` |
| WebGL 2 `noperspective` emulation | `bgt/renderers/webgl2/shaders.ts` |
| Host build of the same C for known-answer tests | `tests/native/glsl_driver.c`, `tests/support/glsl-native.ts` |
| Fixture | `examples/x64-glsl` (shaders are asset files, read by the guest and by the unit tests) |

Flow: `glShaderSource` keeps each string. `glCompileShader` preprocesses all strings (GL semantics: per-string
`__LINE__`/`__FILE__`, `#version` must come first, prepended `#define` strings work), parses global declarations,
finds statically used variables by reachability from `main`, and compiles a provisional single-stage module so the
backend's real compile result and log become `GL_COMPILE_STATUS` / the info log. `glLinkProgram` merges both
stages (uniform/block/varying/type checks), assigns locations and std140 layouts, re-emits both stages against the
program-wide layout and compiles them. Reflection answers come from that link result.

Canonical output: ordinary uniforms flattened into one `layout(std140) uniform bgt_u0` (after a `vec4 bgt_gl_meta`),
user blocks renamed `bgt_u1..7` (instance names kept), samplers `bgt_t0..7` (arrays expanded, constant index only),
explicit attribute/fragment-output locations, inactive inputs removed, precision/`invariant`/`centroid` dropped,
hoisted struct definitions, `texture*`/`texelFetch` coordinates flipped for the top-down texture convention.
Line numbers stay aligned with the preprocessed source.

## Constructs supported

Macros with arguments and `##`, `#if/#elif/#else/#endif` with `defined`, full integer operators, `#ifdef/#ifndef`,
`#undef`, `#line`, `#error`, `#pragma`, `#extension` (require/enable/warn/disable), `__LINE__ __FILE__ __VERSION__`,
`GL_ES`, `GL_core_profile`; `precision`, `layout(location|std140|shared|packed|column_major)`, interpolation
qualifiers, multiple declarators, arrays, structs (also arrays of structs and struct members that are arrays),
uniform blocks with and without instance names, every GL 3.3 numeric and sampler type in reflection,
`glGetActiveUniform(Name|sv)`, `glGetUniformIndices/Location`, `glGetUniformBlockIndex`,
`glGetActiveUniformBlock(iv|Name)`, `glUniformBlockBinding` (default binding 0), `glGetProgramiv` (all uniform,
attribute and block keys), `glGetActiveAttrib`, `glBind/GetAttribLocation`, `glBind/GetFragDataLocation`,
`glGetUniform{f,i,ui}v`, `glValidateProgram`, `glGetShaderSource`, `glGetAttachedShaders`, array/struct/bool/matrix
`glUniform*` with GL conversion and `INVALID_OPERATION` rules.

## Verification status (for the verifier who continues in this clone)

Work stopped by reviewer request before the Tier 1 gates. Nothing below is claimed beyond what is listed.

**Passed on the final code (focused runs, through the gate):**
- `tests/unit/glsl.test.ts`: 33 tests, 32 passed in the first run; the one failure (a wrong line index in the test,
  now fixed to `[1]`) was re-run only together with `x64-gl`/`x64-glsl` where `glsl.test.ts` passed too.
  The later `noperspective` rename (`bgt_internal_np_<name>` on both stages) changed one assertion that was **not
  re-run**.
- `tests/unit/x64-gl.test.ts` (5 tests incl. 300-frame oracle) passed after the sampler-kind fix.
- `tests/unit/x64-glsl.test.ts` (2 tests incl. the 300-frame lifted-vs-interpreted oracle) passed.
- `tests/e2e/x64-glsl.spec.ts` on `chromium-webgl2` and `chromium-webgpu` (BGT_REQUIRE_WEBGPU=1): 3/3 passed, exact
  pixels in all nine probes, cross-backend `different: 0.00625`, `unmatched: 0`.
- `tests/e2e/x64-gl.spec.ts` on both backends: 4/4 passed (run before the last `noperspective` change, which does
  not touch x64-gl shaders).
- `npm run typecheck`, `npm run doctor`, `npm run leakcheck`, and `eslint` on the touched TS files: clean.
  (`doctor`/`leakcheck`/`typecheck` ran on the commit before this handoff text.)

**Not run / unverified:**
- `npm run lint` (ESLint + GCC + all example check-builds with warnings-as-errors) was started and killed: the
  new `w32_glsl.h`, `w32_gl_program.h`, `w32_gl_shader.h` and `examples/x64-glsl/glsl.c` have only been built by the
  normal zig pipeline; the `--check` mode and host GCC (`-Wall -Wextra -Werror`) were not exercised. Some lines are
  over 120 columns.
- `npm test` (whole unit suite), `npm run test:e2e` (all specs, both backends) and the other 17 pipeline oracles at
  300 frames were not run. Expected risk areas: other GL-using fixtures (`x64-smoke`, `x64-gl32`) because uniform
  locations/default block binding changed; `tests/unit/gpu-webgpu-shaders.test.ts` (frontend refactor; an earlier
  gated run of it never reported back).
- Real-WebGPU validity of the generated WGSL beyond the fixture scenes; WebGL 2 beyond the fixture and x64-gl.

**Known failures:** none open that I know of. History worth knowing: the first e2e run failed because WebGL 2
needs the same varying name on both stages (fixed: `bgt_internal_np_<name>` on both sides).

## Commands

Focused config kept in place (untracked, listed in `.git/info/exclude`): `vitest.k6b.config.ts` (no global example build).

```sh
export PATH=/Users/dev/projects/pi-work/harness/shim:$PATH BGT_E2E_PORT=5212
env -u PI_PROVIDER_EXTENSION npx vitest run --config vitest.k6b.config.ts          # glsl, x64-glsl, x64-gl (~1 min)
node tools/build/build.mjs examples/x64-glsl && BGT_REQUIRE_WEBGPU=1 npx playwright test x64-glsl.spec.ts x64-gl.spec.ts --project=chromium-webgl2 --project=chromium-webgpu
# needs `mkdir -p node_modules/.cache/bgt` once, and `npm run build:examples` before browser runs
npm run doctor && npm run lint && npm run typecheck && env -u PI_PROVIDER_EXTENSION npm test && npm run test:e2e && npm run leakcheck
for g in x64-audio x64-basics x64-cpp x64-cpprt x64-crt x64-gl x64-glsl x64-gui x64-input x64-memory x64-tls win32-hello; do npm run oracle -- examples/$g 300; done
# plus every other example the oracle suite lists (see docs/handoff/integration-i3.md for the full 18)
```

Host known-answer driver by hand: `cc -std=c11 -Wall -Wextra -Werror -o drv tests/native/glsl_driver.c`, then
`./drv --vs examples/x64-glsl/assets/quad.vert --fs examples/x64-glsl/assets/tile0.frag` (JSON on stdout; `--pp`,
`--reflect-only`, `--attr NAME=LOC`, `--frag NAME=LOC`).

Remaining finish-line items: Tier 1 gates above (lint/test/e2e/all oracles at 300 frames), fix whatever they find,
fill in counts here, and the final handoff polish. K6a merges touch the same GL profile files (see below).

ABI: no opcodes >= 0x60 and no capability bits were used or reserved by this lane.

## Shared-file edits (K6a also works in the GL profile)

- `platforms/win32/w32_gl.c`: the `Shader/Uniform/Block/Program` typedefs (4 lines) replaced by
  `#include "w32_gl_program.h"`.
- `platforms/win32/w32_gl_api.h`: 17 `GLSTUB` lines turned into `API` lines (names listed above).
- `platforms/win32/w32_gl_draw.h`: the sampler loops use `p->slot_unit[]/p->nslots`, the ordinary uniform buffer
  size is `p->usize` (was a constant 4096). Nothing else in `draw()` changed.
- `tests/oracle/oracle.ts`: `x64-glsl` joins the GL stream-comparing oracles.
- `examples/x64-gl/gl.c`: the "uniform array is rejected" check now uses an invalid type, because uniform arrays
  are supported.

## Behavior changes worth knowing

- Uniform locations are now GL-style (array elements consecutive, base-name lookup, inactive uniforms -1).
- Default uniform block binding is 0 (was the block's index).
- Unused vertex inputs are removed from the translated source (they are inactive in GL as well); active ones
  must be enabled in the VAO as before.
- Ordinary uniform storage is up to 16 KiB (was 4 KiB) and allocated per program.

## Open limits (explicit, reported as compile/link logs)

- No implicit int-to-float conversions on WebGL 2 (ES rule); function bodies are not type-checked by the profile,
  so desktop-only sloppiness surfaces as the native ES compiler's log. WebGPU's translator is more tolerant.
- Only `sampler2D` and `sampler2DShadow` can be *active*; other sampler types reflect correctly but fail with a
  clear message (§13 has no 3D/array/cube/integer textures). 8 texture slots, 7 user blocks, 16 attribute and 8
  output locations.
- Not translated: `row_major`, arrays of blocks, in/out interface blocks, matrix/array/bool vertex inputs and
  varyings, integer fragment outputs, `gl_FragDepth/PointCoord/ClipDistance`, `textureProj/Offset/Gather/QueryLod`,
  sampler function parameters, dynamic sampler-array indexing, uniform initialisers, `switch`/`do`, `bvec` uniform
  storage, `mat3x2/mat4x2`. `#version` must be 130–330 (or `300 es`) and present.
- Reflection lists all elements/members of an active array or structure, and reports a block's members only when
  the block is active. `GL_ACTIVE_UNIFORMS` order is declaration order (vertex first).
- Out-of-bounds: location assignment of automatic attributes/outputs is lowest-free (GL leaves it open).
- Texture-coordinate flipping is by function: `texture`, `textureLod`, `textureGrad`, `texelFetch`, `textureSize`.

No new ABI opcodes or capability bits were added.
