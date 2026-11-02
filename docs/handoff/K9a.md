# K9a — GLSL integers, aggregate equality and copy-in/copy-out expressions

## Delivery

Branch `lane/K9a`, base `957d837`. Implementation commits **`cf04f67`** and **`3dbd9e0`**; subsequent handoff-only
commit records this evidence. No game files, captured source, external dependencies, web access, system installs,
success stubs, pushes or edits to the parallel transform-feedback lowering module. Every committed regression
shader is original **CC0-1.0**. Private capture sources were read directly from the supplied external inputs only;
no copied captures or captured shader modules exist anywhere under the repository.

### Contracts

- **Q33:** decimal, octal, hexadecimal (`0x`/`0X`), `u`/`U`, exact full-width 32-bit values and conversions,
  unsigned arithmetic wrap and constant expressions (arithmetic/bit/shift/comparison/logical/conditional forms).
  BigInt constant evaluation retains signedness, scopes and lazy inactive operands. The signed minimum emits
  `(-2147483647i - 1i)`, not an invalid positive WGSL `2147483648i` literal under unary negation. Oversized and
  malformed literals fail compilation. Integer array extents and constructors are covered.
- **Q36:** vector `==` becomes `all`, `!=` becomes `any`. Matrices, arrays and structs recursively compare
  components through value-argument helpers: each original operand evaluates once, and the result is scalar bool.
  Tests include all scalar/vector element types, all nine 2..4-column/row matrix shapes, nested aggregates,
  equal/non-equal late components, and assignment/if/while/ternary contexts with side effects.
- **Q37:** expressions can emit ordered statement preludes. Ternary branches and short-circuit operands retain
  their own preludes, so only the selected branch runs. While conditions execute their preludes on every test;
  for loops put step preludes in WGSL `continuing`, preserving `continue` behavior. `in` parameters are mutable
  local copies; every out/inout argument uses fresh function storage, copy-in for inout, then caller copy-out.
  Indices are fixed at argument evaluation. Direct swizzles, scalar array elements, struct members, global caller
  storage, forwarded parameters and aliases are covered. Aliases do not share parameter storage; WG copy-out is
  left-to-right where GLSL leaves order undefined. User overloads are matched by type/arity and get distinct WGSL
  names, preserving built-in overloads of the same name. No address of an immutable WGSL parameter is taken.
- Additional independently tested fixes: nested swizzles vs struct-member names, signed-minimum handling,
  unsigned constant scoping, prefix/postfix evaluation, non-square matrix constructors and padded std140
  two-row matrices. These are WG frontend improvements; the separate C GL profile's existing matrix limits
  are not silently changed.
- GLSL permits implicit derivatives under divergent flow with undefined results. Translated WGSL disables only
  `derivative_uniformity` diagnostics, rather than falsely rejecting legal GLSL. The regression uses one-level
  nearest sampling for a defined known pixel; it does **not** claim portable derivatives in nonuniform flow.

Files: `bgt/renderers/webgpu/{shaders,glsl-integers}.ts`, `bgt/renderers/webgl2/{shaders,glsl-boundaries}.ts`,
original corpus `tests/support/glsl-storage-regressions.ts`, existing corpus/probe/spec wiring, and unit tests.
No ABI wire/layout/enum/language-mask additions; ABI §13.5 documents the language contract and native boundary.

## Accepted native boundary (reviewer decision)

Chromium/ANGLE cannot reliably execute an out/inout argument that dynamically indexes a multi-component swizzle:
**`put(v.wy[i++])`**. An early synthetic probe left subsequent native shader compilation failing with an empty
native log. Reviewer explicitly accepted containment instead of a new typed GLSL-ES rewriting compiler.

WebGL now rejects this construct **before native compilation**, with shader `E_IO` and the explicit diagnostic
`WebGL 2 native boundary: out/inout argument indexes a multi-component swizzle`. Storage/struct/overload-aware
validation distinguishes ordinary scalar-array members named `rgba`/`xy`, by-value overloads, direct swizzles and
array elements. Parenthesized vector bases and comma-separated struct fields are covered. The browser regression
requires exactly two named rejections (one per language), then compiles **and renders unrelated normal programs
in that same WebGL context**. No compiler/context poisoning or silent later failure is accepted. The equivalent
WGSL case renders its known answer. This form remains unsupported on WebGL, not claimed generally conformant.
The boundary is also named in ABI §13.5 and `docs/v03-status.md`.

## Complete private captured-source audit — scratch only

Sources were fed unchanged into both repository translators, then native WebGL shader compilation and native
WebGPU `createShaderModule`/`getCompilationInfo`. The scratch config uses the pinned repository Playwright/Vite,
an explicit checkout cwd, and owned test port **5223** (`BGT_E2E_PORT`), never developer `:5173`.

| External input | Submitted stages | WebGL native | WGSL native |
|---|---:|---:|---:|
| mm6 resume5 WebGPU capture | 50 | 50 pass | 50 pass |
| mm6 resume5 WebGL2 capture | 79 | 79 pass | 79 pass |
| mm5 resume4 WebGL2 contract capture | 4 | 4 pass | 4 pass |
| mm5 resume4 WebGPU contract capture | 2 | 2 pass | 2 pass |
| **Total (61 unique source strings)** | **135** | **135 pass** | **135 pass** |

This is **270 native stage compilation results**, not pipeline linking, transform-feedback execution, captured
rendered pixels or target startup/playability certification. The blank old standalone WebGL diagnostic file is
not substituted for the actual contract sources. No capture was edited (including hex-to-decimal substitution).
Scratch script/config/results and logs remain external in `/tmp/k9a/`; final log `complete-private-audit.log`.

Construct audit: early matrix/uniform/selector/texture helpers still compile; later unsigned bit/hash arithmetic
now clears Q33; particle helper inout and nested conditional paths clear Q37; palette aggregate comparisons clear
Q36; the resulting divergent texture flow compiles under the documented GLSL derivative policy. Every additional
repair has an independent original regression, not a checked-in reproduction of target shader text.

## Original numerical regression strength

- **87 regular fragment cases × 2 languages × 2 backends = 348 rendered/read-back RGBA results**, plus the one
  accepted-boundary case on WebGPU × 2 languages = **350 total**. The previous 43-case corpus remains intact;
  **44 new regular cases + one WG boundary case** add **178** numerical results. Every case uses the common
  independently compiled vertex selector/array constructor. Every pixel channel is within **1 UNORM8 code**;
  no tolerances/assertions/skips were weakened.
- Two explicit WebGL rejection results are counted separately, never as successful pixels. The spec asserts exact
  case/result/rejection counts. No silently missing shader result or poisoned context can pass.
- Native compilation, pipeline creation/linking and actual rendering are required. The corpus includes runtime
  uniforms, textures, globals and storage effects, not just a no-errors compilation smoke test.
- Old frontend spelling assertions were updated to follow explicit ordered temporaries and fresh copy-out storage:
  the texture-bias test expands let definitions and retains its original exact coordinate/bias assertions. The old
  rejection of global out storage is replaced with a positive copy-out assertion plus actual global-storage pixels.

## Final verification

All gates below passed on final executable implementation **`3dbd9e0`**; final handoff changes are documentation only.

| Gate | Result |
|---|---|
| `npm run doctor` | ready; original/ empty |
| `npm run lint` | ESLint + clang + real GCC host checks, **28 example check-builds**, pass |
| `npm run typecheck` | pass |
| `env -u PI_PROVIDER_EXTENSION npm test -- --maxWorkers=1` | **939 passed / 68 files / 0 failures**, 277.37 s |
| `BGT_REQUIRE_WEBGPU=1 npm run test:e2e` | **218 passed / 51 existing intentional skips / 0 failures**, 4.5 min |
| `npm run leakcheck` | pass, 540 committable files before this handoff; pre-commit gate rerun |
| All pipeline CLI oracles at 300 frames | **25/25**, **7,500 identical pairs**, null errors, lifted `interp_insns=0`, `stubs=[]` |
| Scratch private/native + numerical audit | **6/6 tests**, 135 stages/backend plus numerical corpus above |
| Fresh independent final correction review | **PASS**, bounded read-only source/lightweight translation scope |

Browser projects: WebGL2 **98 pass / 24 skips**, WebGPU **112 / 26**, auto **8 / 1**. Skips are unchanged existing
backend/policy exclusions, not absence of either adapter. No iPhone/Safari/Firefox or original game claims.
`npm run test:e2e` builds examples before testing; all 25 pipeline examples were then explicitly oracle-checked:
win32-conformance, win32-hello, x64-audio, x64-audio-init, x64-basics, x64-contracts, x64-cpp, x64-cpprt,
x64-crt, x64-gl, x64-gl-current, x64-gl-fbo, x64-gl-integer, x64-glsl, x64-gui, x64-handles, x64-input,
x64-memory, x64-scale, x64-smoke, x64-sysdlls, x64-threads, x64-tls, x86-handles, x86-threads.
Native BGT examples have build/browser coverage, not fabricated interpreter oracles.

External final logs: `/tmp/k9a/complete-{doctor,lint,type,test,e2e,leak}.log`,
`complete-oracle-<id>.log`, `complete-oracles.json`, `complete-private-audit.log`. Normal ignored reports retain
browser/oracle evidence. Logs are machine-local evidence, not a durability guarantee. Temporary failed browser
artifacts were cleaned; no ENOSPC occurred (16 GiB free at the last check).

### Honest intermediate failures and independent validation

The first focused run exposed old WGSL-spelling assertions; the first full units ran **926/928** (two such old
assertions), then **936/936**, and final after boundary regressions **939/939**. An early focused repository-browser
command omitted `build:examples` and failed because sample2d was absent; the proper full command built all examples
and passed. These are not claimed passing runs. No timeout/assertion tolerance was increased.

A genuinely fresh independent session found signed-minimum spelling, scalar-user/builtin overload interception,
and false rejection of indexed struct members. All were fixed and numerically regressed. A second review invocation
ended with provider/agent exit 1 and no verdict; not approval. A third fresh session confirmed those corrections but
found parenthesized/comma-member boundary bypasses and a by-value-overload false rejection; repaired and regressed.
A **fourth fresh independent session** reviewed exact **`3dbd9e0`**, ran lightweight in-memory translation checks,
and returned **PASS within bounded read-only scope** (`/tmp/k9a/independent4-result.txt`). It did not run the developer's
Tier 1, private capture or native pixel suite; those checks above are author evidence, not delegated attribution.

## Remaining scope

Q33/Q36/Q37 and the captured-stage audit finish line are delivered, subject to the explicit reviewer-accepted
WebGL native boundary. No remaining K9a gate is deferred. Parallel Q34 transform feedback and Q35 blit are not
implemented or certified here. This is a bounded GLSL frontend, not complete GL 3.3 compatibility, a target first
draw/title result, selected-loop success, or a physical/mobile hardware certificate.
