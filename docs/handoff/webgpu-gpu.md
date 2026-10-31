# Lane WG — WebGPU v0.3 GPU execution

## Finish-line delivery

- All 25 §13 operations execute on WebGPU; runtime CAP_GPU negotiation and extended language mask = 7 are wired.
  No ABI field/layout/opcode changes. Decoder remains the ordering/validation authority.
- `bgt/renderers/webgpu/gpu.ts`: native resources, every format/state/binding/draw, compact upload shadows,
  byte-update alignment, byte-aligned UNORM attribute repacking, strip expansion without primitive restart,
  signed base vertex/nonzero first instance, derived pipeline caching and diagnostics.
- `shaders.ts`: dependency-free kit-maintained runtime GLSL330 / ES300 → WGSL frontend; WGSL native compilation.
  Tests exercise blocks/matrices/samplers/name-linked varyings, FragCoord, discard, helpers/loops/derivatives,
  portable IDs and readable errors. No downloaded dependency, web access, engine-specific shader substitution,
  native compiler subprocess, or precompiled shader lookup. See backend README for grammar/error boundaries.
- `depth.ts`: exact-value non-comparison depth filtering via textureLoad, avoiding WebGPU's filtering-depth
  sampler restriction; nearest/bilinear/mip/wrap specialization by immutable sampler descriptor.
- `webgpu.ts`: GPU and legacy commands share a logical RGBA8 screen in stream order, then letterboxed present;
  readback observes the command point. Frames without GPU passes keep the frozen physical-pixel 2D raster path.
  This preserves fractional-scale 2D edge coverage and unchanged cross-backend conformance tolerances.
- `examples/gpu-scenes-wgpu`: original CC0 native C fixture, all eight required scene categories, exact guest
  readback, pending shader deletion/reuse, WGSL and GLSL compile-failure requests, and disposable resources.
- Device recovery restores uploaded resources/shaders/pipelines, emits attachment loss, completes pending shader
  requests exactly once with loss text, and verifies recreated pipelines. Four recovery scenes cover sampled
  uploads, MRT, depth/stencil and translated GLSL. Unrecoverable loss with live GPU resources stops explicitly;
  the existing 2D mid-game WebGPU→WebGL 2 fallback remains green.

## Evidence (final sequential run)

Port **5187**; no duplicate suite/oracle processes. Logs are clone-local ignored `.scratch-WG/`.
The requested external `/Users/dev/projects/pi-work/scratch-WG` was not writable under the sandbox, so the existing
lane-only `.scratch-WG` was used instead. No ENOSPC occurred in this resumed session; final free space was approximately 6 GiB.
No game files, installs, downloads, status/verification edits, pushes or test weakening.

| Gate | Result | Evidence |
|---|---|---|
| `npm run doctor` | ready / exit 0 | `final-doctor.log` |
| `npm run lint` | exit 0, including every example build check | `final-lint.log` |
| `npm run typecheck` | exit 0 | `final-typecheck.log` |
| `npm test` | **216 passed / 22 files** | `final-test.log` |
| `BGT_REQUIRE_WEBGPU=1 npm run test:e2e` | **102 passed, 21 skips** | `final-e2e.log` |
| `npm run leakcheck` | exit 0, 265 committable files | `final-leakcheck.log` |
| all required differential oracles | **10 passed × 300 frames = 3,000 identical frames** | `oracles.exit`, `oracle-*.log` |
| `git diff --check` | clean | command run after code changes |

Browser skips are the four existing backend/tour skips plus 17 intentional WebGL2 skips for WebGPU-only tests;
**all 17 new WebGPU cases actually passed**, with WebGPU required rather than optional. Existing 2D conformance,
WebGPU/WebGL2 image comparison, resize/DPR, 2D readback, and recoverable/unrecoverable legacy fallback tests passed.
The all-op test requires all 25 GPU opcodes in coverage with zero renderer/command errors. Direct backend tests
also allocate/render all seven texture formats, exercise strips, unaligned attributes, byte writes, negative base
vertex, first instance, pending loss, and bilinear depth sampling. Unit frontend tests: 22 cases.

Oracle IDs: x64-audio, x64-basics, x64-cpp, x64-cpprt, x64-crt, x64-gui, x64-input, x64-memory, x64-tls,
win32-hello. Each explicit `npm run oracle -- examples/<id> 300` exited 0 with identical=true.

**Unit environment caveat:** the harness injects `PI_PROVIDER_EXTENSION`. The unrelated fake-pi launcher fixture
assumes its bridge is the first `-e`; inherited provider injection breaks that assertion. The final unit command
was `env -u PI_PROVIDER_EXTENSION npm test` (no test edits/skips), which passes all 216 tests. The failed initial
attempt was localized to this inherited-environment issue, not GPU code. Other gates ran with normal lane env.

## Ownership exceptions / integration

Outside renderer/fixture/owned tests, only these necessary hooks were changed, each marked `/* LANE-WG */`:

- `bgt/runtime/runtime.ts`: CAP_GPU + HostConfig.gpuBackend wiring, EVENT_TARGETS_LOST on GPU recovery, and explicit
  stop rather than silently falling back with live §13 objects. These are generic hooks also useful to WebGL2.
- `bgt/runtime/host.ts`: optional backend renegotiation in `setBackend`, clearing CAP_GPU, old GPU state, and guest
  IO capability bit when fallback has no executable GPU layer. This fixes a stale lost-device executor after the
  otherwise successful legacy fallback. No live GPU-handle migration is implied.

New frontend unit tests are lane-owned tests. Backend README documents implementation, grammar and recovery.
No `bgt/abi/ABI.md` change: no wire/interface addition was needed. `docs/v03-status.md` / `docs/verification.md`
are untouched for reviewer merge.

## Decisions, boundaries and next lane

- Read §13 as requiring explicit stop when live resources/languages cannot be restored on WebGL2; do not claim
  a cross-backend live-resource migration. Existing no-GPU fallback still plays and restores 2D textures.
- Accepted the requested GLSL `gl_FragCoord` spelling as a top-left alias of ABI `bgt_frag_coord`. GL clip-space z
  conversion remains a profile responsibility; GLSL gl_Position already holds BGT [0,w] depth at this interface.
- No acceptance question required the reviewer bridge. The local frontend implements the requested practical
  shader features, not unrestricted desktop GLSL preprocessing/extensions/user-struct/out-parameter syntax.
  Unsupported source constructs produce logs; broader language coverage should extend the general frontend or
  use a pinned translator later, never engine-specific patterns. Ordinary non-block uniforms and sampler arrays
  remain outside §13's shader binding contract. WGSL uses the native compiler; non-comparison depth samples have
  the narrowly scoped backend lowering described above.
- Merge the equivalent `gpu-scenes` / `gpu-scenes-wgpu` fixtures and cross-backend pixel expectations later; no
  parallel-lane files were edited here. Physical hardware/mobile verification was not performed.
- A separate fresh pi reviewer session inspected all changed files and ABI ordering/recovery/shader rules, and
  independently ran the original 20 focused frontend tests. It found two blocking GLSL miscompilations: premature
  float conversion of integer expressions and eager ternary branch evaluation. Both were corrected and now have
  unit plus native readback regressions. The initial pixel `[0,0,64,255]` caught both findings; the final
  regression is `[0,128,64,255]`, additionally checking single evaluation of matrix/remainder arguments.
  Implicit depth-sampling coordinates also evaluate once through generated helpers.
  The reviewer rechecked the actual fixes and closed both findings with no confirmed remaining blocker in that
  scoped recheck. It did not independently rerun browser tests or certify unrestricted GLSL/hardware coverage.
  Review artifacts: `.scratch-WG/independent-review-finish.txt.d/stdout.txt` and
  `.scratch-WG/independent-review-recheck.txt.d/stdout.txt`. The first review timed out, then the same independent
  session was resumed to finish. Its focused Vitest command unexpectedly invoked the existing global setup and
  rebuilt example artifacts; no source changes were made by that reviewer.

The recovered uncommitted files were reviewed and retained; no truncated file was found. Final commit includes
all recovered and resumed source/test changes together. This note is the lane's status, not a shared-status edit.
