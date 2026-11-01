# K6b — Q22 GLSL preprocessing, reflection and translation

## Delivery and scope

Based on integration `ca2cd17`; implementation `f992e52`, followed by a fresh verifier session that reviewed,
fixed and ran the gates below. No dependency, ABI opcode or capability-bit changes. No input/game shader was
copied: the shader corpus and `examples/x64-glsl` are original CC0 sources. No web access or game execution.

Reviewer acceptance decision: reflect all GL 3.3 sampler kinds, render the representable 2D/shadow subset,
and explicitly reject active non-2D samplers rather than expanding the texture ABI in this lane. See the K6a
integration note below. Cube maps remain rejected.

## Architecture

| Piece | File |
|---|---|
| Bounded preprocessing, declaration parser, usage analysis, std140 layout, reflection, linking, canonical emission | `platforms/win32/w32_glsl.h` |
| Pooled allocator and shader/program storage | `platforms/win32/w32_gl_program.h` |
| GL compile/link, queries and uniform state entry points | `platforms/win32/w32_gl_shader.h` |
| WGSL frontend: structures, padded std140 forms, calling conventions | `bgt/renderers/webgpu/shaders.ts` |
| WebGL 2 noperspective emulation | `bgt/renderers/webgl2/shaders.ts` |
| Host build of the same C frontend, known-answer driver | `tests/native/glsl_driver.c`, `tests/support/glsl-native.ts` |
| Original GL fixture and shader assets | `examples/x64-glsl` |

`glShaderSource` keeps the individual string lengths; preprocessing concatenates before tokenization, including
split identifiers, directives, comments and function-macro calls, while tracking per-string `__FILE__/__LINE__`.
`glCompileShader` preprocesses/parses/analyzes and compiles a provisional single-stage module on the selected
backend. `glLinkProgram` merges stages, checks interfaces, assigns a common uniform/block/location layout, and
compiles the resulting canonical modules. Backend failures become GL status/info logs, not successful stubs.

Canonical output is §13.5 GLSL: default uniforms in `bgt_u0` after `vec4 bgt_gl_meta`, user blocks `bgt_u1..7`
(instance names retained), samplers `bgt_t0..7` (constant-indexed arrays expanded), explicit attribute/output
locations, hoisted structures and top-down texture-coordinate conversion. Inactive inputs and unreachable
function definitions are removed. Line counts are preserved; backend diagnostics use canonical/preprocessed
source positions, not a complete original-source diagnostic map.

## Supported constructs

- Object/function macros, nested arguments, recursive-expansion suppression, function aliases and `##`;
  `#if/#elif/#else/#endif`, integer operators, short-circuit `&&/||` and conditional expressions, `defined`,
  `#ifdef/#ifndef`, `#undef`, macro-expanded `#line`, `#error`, `#pragma`, `#extension`, version/profile defines,
  `__LINE__/__FILE__/__VERSION__`, `GL_ES` and multiple source strings.
- Precision/interpolation qualifiers, multiple declarators, arrays, structures (including arrays of structures
  and array members), std140 uniform blocks with/without instances, GL 3.3 numeric/sampler reflection.
- `glGetActiveUniform/Name/siv`, `glGetUniformIndices/Location`, `glGetUniformBlockIndex`,
  `glGetActiveUniformBlockiv/Name`, `glUniformBlockBinding`, program uniform/attribute/block query keys,
  `glGetActiveAttrib`, `glBind/GetAttribLocation`, `glBind/GetFragDataLocation`, `glGetUniform{f,i,ui}v`,
  `glValidateProgram`, `glGetShaderSource`, `glGetAttachedShaders`, array/struct/bool/matrix uniform state.

Bounds include 1 MiB sources/expansions, 1024 source strings, 384 macros, 16 macro parameters, 64 conditional
levels, 64 expansion calls, 128 expression levels, 192 interface declarations per stage, 512 reflected uniforms,
16 KiB ordinary uniform storage, 8 samplers, 7 user blocks, 16 attribute locations and 8 output locations.

## Verifier fixes

1. Source strings were previously lexed separately, breaking split tokens/comments/macro calls. Concatenate
   first and retain a bounded per-character source map for builtin expansion. Added host and real-backend probes.
2. `#line` did not expand macros; `#if` eagerly evaluated division by zero in inactive operands and lacked `?:`.
   Added expansion/short-circuit evaluation, recursion limits and defined host arithmetic for overflow/shift edges.
3. Macro aliases did not rescan against following invocation tokens; empty parameter lists with whitespace failed.
4. Unnamed uniform-block members were incorrectly reflected as `Block.member`. They now use bare member names;
   named-instance blocks retain `Block.member`. Both forms are asserted, including by the guest fixture.
5. Inactive uniforms were removed but unreachable functions referring to them were retained. Remove unreachable
   definitions too, so both native backends compile the valid program.
6. The merged vertex/fragment uniform-variable table had only one stage's capacity. Doubled it and added a
   383-distinct-uniform regression (ASan/UBSan covered).
7. Fixed GCC misleading-indentation/unused-variable diagnostics. Added the GLSL host driver to the persistent
   GCC lint gate, with tests for both compiler-failure cleanup paths.
8. Bounded the second guest source-length scan as well as the first. Centralized sampler support in
   `gs_sampler_capability` for integration. Replaced a fixed startup-frame guess in the fixture unit test with
   an explicit ready barrier before measuring four complete draw frames; retained the >=32 draw assertion.

## Verification (fresh verifier session)

**Tier 1 passed on the final tree.** `npm run doctor` passed. `npm run lint` passed: ESLint, Clang, real
`/opt/homebrew/bin/gcc-14` with `-std=c11 -O2 -Wall -Wextra -Werror`, and all **25/25** example check-builds.
The lint gate now compiles both `tools/x86/x86tool.c` and the new `tests/native/glsl_driver.c` under GCC.
`npm run typecheck` passed. `env -u PI_PROVIDER_EXTENSION npm test -- --maxWorkers=1` passed **616/616 tests,
54 files**, no skips. The earlier parallel full-suite attempt had four test/build timeouts plus a hook timeout
under concurrent load; unchanged assertions passed in the serial rerun, which is the authoritative result.
`BGT_REQUIRE_WEBGPU=1 npm run test:e2e` passed **203 tests**,
**51 skipped**, **0 failures**, across WebGL2/WebGPU/auto projects. `npm run leakcheck` passed with 480 committable
files. The focused final run passed **47/47 tests in 3 files**; the 40 GLSL tests also passed with ASan+UBSan.
The host known-answer driver compiled explicitly with both Clang and GCC. After adding the persistent GCC
check/cleanup tests, a full ESLint + GCC supplement passed on the final source (`K6b-lint-supplement-rerun.log`).

All **21/21 pipeline oracles** passed at 300 frames: **6,300/6,300 identical frame pairs**, null lifted and
interpreted errors, exit status 0, zero lifted interpreted instructions and empty lifted stub lists.
Browser project totals: WebGL2 **92 passed / 24 skipped**, WebGPU **103 / 26**, auto **8 / 1**. Skips are
backend/policy-specific tests, not a missing WebGPU adapter. The x64-glsl fixture passed **3/3 browser tests**:
all nine pixel probes on each backend, GL reflection/diagnostic guest checks, and cross-backend comparison
`different=0.00625`, `unmatched=0` (limits 0.015/0.001). The existing x64-gl fixture also passed **3/3**.
A separate native WebGL2 reflection probe confirmed bare members vs `Block.member` for instance blocks.

Evidence: ignored `reports/e2e-results.json`, `reports/oracle-<id>.json`; retained command logs and oracle
summary under `/Users/dev/projects/pi-work/scratch-K6b/verification/`. Verifier code commit: `77e98a5`.

The full example inventory is 25 builds, of which **21** have `pipeline` configurations (the previous handoff's
18-example count was stale). Every pipeline oracle is explicitly requested at 300 frames:
`win32-conformance`, `win32-hello`, `x64-audio`, `x64-basics`, `x64-contracts`, `x64-cpp`, `x64-cpprt`,
`x64-crt`, `x64-gl`, `x64-glsl`, `x64-gui`, `x64-handles`, `x64-input`, `x64-memory`, `x64-scale`,
`x64-smoke`, `x64-sysdlls`, `x64-threads`, `x64-tls`, `x86-handles`, `x86-threads`.

Commands (heavy tasks use the machine-wide FIFO shim; no duplicate runs):

```sh
npm run doctor
npm run lint
npm run typecheck
env -u PI_PROVIDER_EXTENSION npm test -- --maxWorkers=1
BGT_REQUIRE_WEBGPU=1 npm run test:e2e
npm run leakcheck
# For every examples/*/game.json containing pipeline:
npm run oracle -- examples/<id> 300
```

Focused runs used an untracked `vitest.k6b.config.ts` without the global example rebuild. It was deleted and
removed from `.git/info/exclude` before the final commit. ASan+UBSan used the host driver with
`-fsanitize=address,undefined -fno-sanitize-recover=all` (leak detection disabled: the short-lived diagnostic driver exits without freeing its process-owned result).

## Shared files and K6a integration

K6a also changes the GL profile:
- `platforms/win32/w32_gl.c`: four old Shader/Uniform/Block/Program typedefs replaced with the new header include.
- `platforms/win32/w32_gl_api.h`: 17 reflection/query stubs become implemented API entries.
- `platforms/win32/w32_gl_draw.h`: samplers use `slot_unit[]/nslots`; uniform upload uses `p->usize`.
- `tests/oracle/oracle.ts`: `x64-glsl` joins stream-comparing GL oracles.
- `examples/x64-gl/gl.c`: invalid-type rejection replaces the old unsupported-uniform-array expectation.
- `tools/build/check-host-gcc.mjs`: GCC now checks the GLSL frontend as well as x86 tools.

**K6a adds §13.7 `TEXTURE_CREATE_EX` for 3D/2D-array textures after this lane's base.** Active sampler rejection
is centralized in `gs_sampler_capability` (`w32_glsl.h`). At integration, enable 3D/array types there only together
with dimension-aware canonical sampler emission, coordinate transforms and binding metadata. Do not merely
remove the check: current canonical emission intentionally emits only 2D/shadow samplers. Cube maps stay rejected.

## Behavior and open limits

- Uniform locations are GL-style (consecutive array elements, base-name lookup, inactive uniforms -1).
  Default block binding is 0, not the block index. Uniform storage is per program (up to 16 KiB).
- A block with an instance reflects `Block.member`; a block without an instance reflects `member`.
  All members of an active std140 block are reflected. Active arrays/structures retain all declared elements/
  members. Enumeration order is declaration order, vertex first. Automatic locations use lowest-free assignment.
- Active samplers other than floating 2D/shadow are explicitly rejected. All sampler kinds reflect in host
  reflection-only tests. Shadow pixel coverage also exists in the renderer conformance fixtures; the new GL
  fixture's rendered sampler tiles use sampler2D arrays. This base profile cannot upload depth textures.
- Unsupported translation: row-major matrices, block arrays, in/out interface blocks, matrix/array/bool vertex
  inputs and varyings, integer fragment outputs, `gl_FragDepth/PointCoord/ClipDistance`, texture projection/
  offsets/gather/query-LOD, sampler function parameters, dynamic sampler indexing, uniform initializers,
  `switch`/`do`, bvec uniform storage and mat3x2/mat4x2. Native compilation or explicit profile logs report errors.
- Version must be supported desktop 130–330 or `300 es`, and present. No implicit int-to-float conversions on
  WebGL 2; backend compilers validate function bodies. This is not a complete GLSL optimizer/typechecker.
- Browser checks are desktop Chromium, not Safari/iPhone validation. No game-template compatibility claim is
  made beyond the original synthetic corpus. The fresh verifier session independently reviewed the original
  implementation; verifier corrections were regression-tested here, not delegated to a second new reviewer.

No new ABI opcode or capability bit was reserved or used.
