# K8b — Q22 typed GLSL selectors and runtime shader audit

## Delivery

Engine-independent renderer changes, based on `0838b00`. No game sources, captured shader text, ABI changes,
dependencies, system installs, network access or success stubs. All committed regression shaders are original
**CC0-1.0**. No push. The captured sources and scratch checks stay outside the repository.

- **WGSL:** boolean-selector `mix(x, y, a)` becomes typed `select(x, y, a)` (true selects **y**), for scalar and
  vec2/3/4 float32, int32, uint32 and bool values. Reject mismatched selector/operand shapes. Numeric mix remains
  numeric mix. Preserve integer precision, evaluation of both arguments exactly once, and nonselected NaN/Inf
  components without arithmetic interpolation. Honor an explicitly defined matching user function overload.
- **Boolean access:** retain bool type through vector swizzles and indexing, including comparison results used
  as selectors; do not infer float for `bvecN` members/elements.
- **GLSL ES:** ES 3.00 lacks the integer/bool-valued selector overloads. Inject their exact typed, component-wise
  helper overloads only into shaders using mix. Native float/numeric mix stays native. Preserve matching user
  definitions/prototypes instead of introducing duplicate overloads. This is a bounded portable frontend
  lowering, not a higher advertised GLSL/GL version or arbitrary desktop-extension support.

Files: `bgt/renderers/{webgpu,webgl2}/shaders.ts`; `tests/support/glsl-regressions.ts`;
`tests/unit/{gpu-webgpu-shaders,glsl-regressions}.test.ts`; `tests/e2e/gpu-glsl{,-probe}.ts` (spec is
`gpu-glsl.spec.ts`). No profile or other-lane files changed.

## Private capture audit (scratch only)

The supplied `resume4-runtime-canvas-webgl2.glsl` contains only a newline. Used the actual `SHADER_CREATE`
source/argument records from both supplied contract captures instead; WebGPU's two modules duplicate the first
WebGL pair. Audited **four unique canonical modules**: provisional vertex/fragment and final linked
vertex/fragment. The numbered raw WebGPU diagnostic template was also read with its recorded defines. Scratch
code imports the repository translator and passes the private source strings directly to native browser
compilers; no capture is stored under the repository, even in ignored reports.

**PASS on both actual backends:** all four captured modules compile; the **final common-layout pair links**
(WebGL program link / WebGPU asynchronous render-pipeline creation). The provisional pair is compile-only:
it intentionally has independent uniform-block layouts before GL linking, so linking those two unmerged
modules directly is invalid. An initial scratch check exposed that expected mismatch; the final scratch check
correctly links the final canonical pair. Original capture sources were not edited to make them pass.

Construct-by-construct active-source audit:

| Construct | Finding / independent regression |
|---|---|
| bool-selector mix + lessThan(vec2) | Actual WGSL compile blocker; typed select repair, all 16 supported value shapes × both mask polarities |
| vec2/3/4 constructors, swizzles/member reads, scalar/vector math, abs/floor/max/sqrt/dot | Compile/link unchanged; arithmetic and swizzle known answers retained/added |
| mat4 uniform loads, matrix-vector multiplication, local matrix copies | Captured modules compile/link; existing x64-glsl matrix pixels plus new matrix-conversion/diagonal shader |
| bool uniform reads, if/else, local bool/float/vector declarations, nested blocks | Captured modules compile/link; existing padded uniform coverage and new predicate/conditional renders |
| texture(sampler2D) + textureLod, UV helpers | Captured fragment modules compile/link; original fetch/size/LOD known texel test |
| std140 mat4/float blocks and ordinary-uniform canonical block | Both final native pipeline links succeed; existing x64-glsl reflection/layout/pixel suite unchanged |
| gl_Position, gl_PointSize, varyings, depth remap, scalar compound add and swizzle assignment | Captured vertex modules compile/link; new vertex selector + fullscreen triangle, existing depth/attribute pixels |
| integer helper arithmetic, % and vector constructors in canonical prelude | Native compile succeeds; original signed/unsigned shift/bit/cast/large-uint known answers |

Also numerically tested comparison builtins (all six), any/all/not, boolean indexing/swizzles, negative mod,
round and roundEven (negative and positive ties for roundEven), dFdx/dFdy/fwidth, texelFetch/textureSize/textureLod,
array constructors, matrix constructors, swizzle assignment and local out/inout parameters. No additional gap
was exposed by the active captured modules. Unselected template branches are **not** an executed shader variant
claim: skeleton/lighting/instancing definitions not enabled in this capture do not establish inverse-matrix,
integer-texture or general engine support. Integer texture storage/sampler work belongs to K8a/Q21. Existing
frontend limits (including no f64 shader values) are not silently expanded or declared complete.

Scratch evidence: `/Users/dev/projects/pi-work/scratch-K8b/audit-browser.log`, `captured-audit.spec.ts`,
`playwright.audit.ts` and the external capture files. Final native scratch result: **2/2 passed**, one per backend.

## Regression / verification

- **43 independent known-answer fragment cases × 2 source languages × 2 backends = 172 rendered/read-back
  results**, every RGBA channel within **1 UNORM8 code** (quantization only), actual shader and pipeline
  compile/link, no backend/command/console errors. Every case also uses a vertex-stage boolean selector.
- 32 selector cases cover all 4 component types × 4 scalar/vector widths × 2 mask polarities. Additional cases
  cover the contracts above, nonselected runtime half-float NaN/Inf texels, argument evaluation counts and
  preservation of a legal user-defined mix overload. Test output count is asserted, not just no-errors/boot.
- Focused host suite: **159/159 tests in 3 files**, no skips.
- Doctor **ready**; ESLint + clang + **real GCC** lint and **27/27** example check-builds **pass**;
  typecheck and leakcheck **pass** (507 committable files before this handoff).
- Full required-WebGPU `npm run test:e2e`: **210 passed / 51 existing intentional skips / 0 failed / 0 flaky**.
  WebGL2 **95/24**, WebGPU **107/26**, auto **8/1**. No assertion, tolerance or skip policy weakened.
- **23/23 pipeline examples × 300 frames = 6,900 identical frame pairs**, exit 0, null errors, zero lifted
  interpretation and empty lifted stub lists. Native BGT examples have build/browser checks, no fake oracle.
- Local `env -u PI_PROVIDER_EXTENSION npm test -- --maxWorkers=1`: **748 passed / 5 failed**, 60 files.
  The failures are precisely the already documented sandbox-denied ps/FIFO/liveness tests in
  `tests/unit/pi-harness.test.ts` (Q25/K7i), not shader failures. The provider environment is unset to isolate
  inherited provider configuration, not to skip tests. No local all-green Tier 1 claim while this gate is open.
  Initial inherited-provider full-suite attempt timed out; the clean-environment full run above is authoritative.

Logs: external scratch `doctor.log`, `lint.log`, `typecheck.log`, `focused.log`, `unit.log`, `e2e.log`,
`leakcheck.log`, `oracle-*.log`; ignored repository `reports/e2e-results.json` and `reports/oracle-<id>.json`.
Full oracle inventory is the 23 example `game.json` files with `pipeline` (`oracle-paths.txt` in external scratch),
not unit-test-generated diagnostic fixtures. Heavy tasks use npm/npx FIFO shims; tests own `BGT_E2E_PORT=5219`.
Temporary outputs are cleaned after checks; no ENOSPC occurred in this lane. The machine-wide disk-guard pause
was reported by the operator; tests resumed only after space recovery.

## Remaining gates / boundaries

- Q22 captured compile/link finish line and original numerical regressions are met; no game draw/title or
  startup claim. Other Q21/Q23/Q24 blockers and inactive shader variants remain outside this lane.
- Q25 needs K7i or exact-final-tree external harness validation. Reviewer bridge requests defaulted on explicit
  timeouts to external validation rather than changing another lane's harness or weakening tests.
- Independent validation requires a fresh session; do not infer it from this developer's own reruns.
- Desktop Chromium WebGL2/native WebGPU only, not iPhone/Safari/Firefox certification.
