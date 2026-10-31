# Lane GL — Win32 OpenGL 3.3 command-stream profile

## Delivered finish line

Original CC0 `examples/x64-gl` is compiled normally for Win64 with `crt:true` / `-O2`, without overrides or BGT
imports. It runs fully lifted, emits seven scenes, and matches an interpreter-only build for 300 frames. Scenes:
indexed VAO/VBO/EBO triangle, alpha quad with CPU-generated mipmaps, FBO render-to-texture and screen sampling,
depth plus stencil, indexed/array instanced sprites, base-vertex variants, ordinary uniforms and a uniform block,
and blocking screen `glReadPixels`. The fixture also verifies deliberately invalid calls, a rejected uniform-array
compile with a readable log, 300 shader-name create/delete cycles, and whole-buffer UBO binding before allocation
and after resize. WGL capability absence is visible and does not pretend to render.

- WGL pixel-format/context/current-context/swap/interval functions and context-attrib extension are registered.
- `w32_gl_api.h` records **360 names: 146 implemented entry points, 214 explicit unsupported core thunks**.
  This is a bounded GL profile, not a claim of all GL 3.3 behavior. Known unsupported thunks preserve i386 stdcall
  argument cleanup, set `GL_INVALID_OPERATION`, and record the exact name. Unknown dynamic names return NULL and
  record the name. Common ARB/EXT suffix aliases resolve to the same core signatures.
- State includes buffers, interleaved VAOs/attributes, texture units/parameters/mips/unpack state, separate samplers,
  color FBO/depth RBO attachments, shaders/program status and logs, uniform/block mappings, render state and draws.
- Immutable §13 pipeline descriptors use FNV state hashes plus full collision checks. Seven repeated scene draws
  reuse **four** descriptors, including a descriptor for retained blend factors while blending is disabled.
- Ordinary uniforms use profile uniform slot 0 (std140, 4 KiB); blocks use slots 1..7 in program declaration order,
  independently of GL block binding points. Samplers use texture slots 0..7 in declaration order, independently of
  GL texture units. Fixture: block binding point 3 -> slot 1, sampler unit 2 -> texture slot 0.
- GLSL330 rewriting preserves original punctuation, decimal/exponent literals, operators and comments; it renames
  bindings/IDs, converts clip depth, sampling orientation and fragment coordinates. Vertex inputs/fragment outputs
  need explicit locations. Module requests are waited/read/closed before pipeline creation; failures expose logs.
- Screen readback uses the existing ordered §12 READBACK path permitted by §13, waits through `bgt_yield`, closes
  the request and converts BGT top-down rows to GL pack rows. No ABI change or new GPU texture alias was added.
- Metrics: `gl_calls`, `gl_draws`, `gl_state_changes` (successful state-setting calls), `gl_pipelines`,
  `gl_unimplemented`, and `gl_stubs` (visible list). Fixture has `gl_unimplemented=0`, `gl_stubs=[]`.
- Static import coverage recognizes `opengl32.dll` and uses the exact GL API/stub registry. The fixture's three
  opengl32 imports all classify implemented. The full census has 59 implemented / 0 stubs / 2 unknown; the two
  pre-existing non-GL classifier gaps are kernel32 `VirtualProtect` and `__C_specific_handler`, not executed GL gaps.

## Evidence and important boundary

The runtime §13 validator is exercised by a **recording-only** backend, not bypassed or replaced. It completes
shader requests and returns documented deterministic readback transport bytes. It does **not** compile GLSL or
rasterize. Pixel correctness, native-driver GLSL compilation and actual GPU readback remain backend integration
work explicitly excluded by this lane's brief. Existing browser backends correctly decline GPU-capable WGL.

`tests/unit/x64-gl.test.ts` asserts zero runtime command errors, exact initial draw words, matching pass counts,
pipeline creation/cache counts, depth/stencil state, slot masks/bindings, interleaved vertex layouts, mip/upload
bytes and orientation, translated source spelling, expected GL errors, readback request/row conversion, compile
failure/log propagation, and unsupported-capability behavior. A separate i386 fixture checks stdcall doubles,
ARB aliases, sticky errors across valid setters, and visible unsupported entries. A digest regression checks that
uniform/upload/source differences are detected while transport address changes are ignored.

The ordinary CLI oracle opts into this recorder **only in test code for x64-gl**. Each frame compares API hashes
**and normalized semantic GPU words, owned upload bytes and shader source**. Transport pointer fields are excluded;
shader/resource handles and all other words remain compared. Both 300-frame runs must have zero validation errors.
No fixture-specific runtime/lifter/renderer behavior was introduced.

Fresh independent sessions ran read-only review and the focused tests. Initial review found GLSL lexical damage,
missing differential stream comparison, stale whole-UBO sizes, shader-name leakage, and constant-alpha factor
mis-lowering. All received fixes/regressions. A follow-up sticky-error concern was withdrawn after inspecting the
per-call dispatch wrapper and rerunning the explicit i386 blend regression. Logs are lane-local, not committed.

## Gates

Final sequential commands and counts are recorded in the lane scratch `final3-*` logs:

- `npm run doctor`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run leakcheck`.
- Unit suite: **199 tests / 22 files** (five focused GL tests). Browser suite: **85 passed, 4 existing skips**,
  lane port **5188**. Final x64-gl oracle metrics: 7,862 GL calls, 2,065 draws, 4 pipelines (2,061 cache hits),
  zero interpreted instructions, zero unimplemented calls. Final combined API/GPU hash: `c8234ada:777fa3d8` on both.
- All **11** CLI oracles: every `examples/x64-*` (audio, basics, cpp, cpprt, crt, gl, gui, input, memory, tls) and
  `win32-hello`, **300 frames each / 3,300 frames total**. No oracle skips or divergent/error runs.
- `git diff --check` and 120-column checks for new sources/tests are clean.

The first full unit attempt inherited `PI_PROVIDER_EXTENSION`, causing two pre-existing fake-pi fixture tests to
reject an extra provider extension. Re-running gates with `env -u PI_PROVIDER_EXTENSION` passes without any test
or harness weakening. The bridge remains enabled; only the unrelated inherited provider injection is removed.

The requested `/Users/dev/projects/pi-work/scratch-GL` is outside this sandbox's writable roots. Actual harness
scratch is `/Users/dev/projects/pi-work/runs/p2d/scratch-GL`; all logs and independent review evidence are there.
No ENOSPC occurred in this resumed session. No downloads, installs, original game files, pushes or status-doc edits.

## Ownership exceptions / integration

Minimal outside-owned hooks, all marked `/* LANE-GL */` (or the existing combined lane marker):

1. `platforms/win32/w32_core.c`: registry, screen presentation ownership, metrics/stub-list exposure.
2. `tools/build/pipeline.mjs`: add the GL translation unit to both 32-/64-bit profile builds.
3. `tools/x86/imports-coverage.mjs`: scan the GL registry and classify explicit GLSTUBs as stubs.
4. `tests/support/headless.ts`: opt-in generic GPU backend/frame-consumer injection, preserving deferred requests.
5. `tests/oracle/oracle.ts`: select the fixture recorder and compare semantic per-frame stream digests.

These extend the resumed session's existing hooks. The reviewer bridge timed out to the stated safe default of
using the explicit recording harness so the required CLI oracle exercises the actual GL scenes, not GPU absence.
`docs/v03-status.md` and `docs/verification.md` are untouched. No ABI changes were needed.

## Bounded compatibility / next integration lane

Resource names are bounded to 255 per GL object type; pipeline/sampler caches to 128 descriptors. GPU handles obey
§13's separate namespaces. One current WGL context and one attached shader per stage are supported. Shared/multiple
contexts are rejected visibly. Shader source/upload copies use the profile arena; repeated shader-source/upload
replacement retains arena bytes (the common allocator has no free), so this is not an unbounded-resource promise.

Uniform arrays/structs and preprocessing-dependent reflection need a fuller GLSL frontend and currently fail with
a compile log. Non-square matrices, attribute-location assignment/reflection APIs, mapping/query/sync APIs and other
unimplemented entries are the explicit registry stubs. Supported vertex formats are float1..4, normalized u8x4,
and integer i32/u32 vectors via `glVertexAttribIPointer`; unsupported conversions are rejected, not bit-reinterpreted.
Attribute divisors are 0/1. Only 2D textures, one color FBO attachment, and depth/depth-stencil RBO storage are mapped.
Depth texture uploads, conversion between float/normalized texture formats, scissored/masked clears, reversed depth
ranges, out-of-bounds viewports, arbitrary FBO readback, and constant-alpha blend-factor combinations are explicitly
rejected rather than silently approximated. ReadPixels currently supports in-bounds screen RGBA/u8 only.

Next lane: connect real GPU backends, compile the emitted GLSL on a real driver, add pixel/orientation/alpha/depth/
stencil scene goldens and real readback assertions. This lane's completion is the agreed command-stream finish line;
it makes no general OpenGL conformance or game-playability claim.
