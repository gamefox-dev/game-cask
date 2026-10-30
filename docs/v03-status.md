# v0.3 merged implementation status

Integration I1 on `integration/p1` combines the existing Task 1/2a work and lanes **S1, E, G, WG, F, GL, W2, C**.
This is still **0.3.0-dev.1**, a bounded kit-development delivery, not unrestricted Windows/OpenGL compatibility,
a release certification, or a new game-playability claim. This merged ledger supersedes the old per-stage missing
lists. Historical measurements remain in [verification.md](verification.md); lane details are in [handoff/](handoff/).

## Merged verification

- Doctor ready; lint (ESLint plus all example check-builds), typecheck and leakcheck pass.
- Unit: **231 tests / 25 files passed**. Bridge fixtures clear inherited `PI_PROVIDER_EXTENSION` internally and
  restore the caller's environment; extension assertions are unchanged. Full inherited-environment verification
  is recorded in the integration handoff.
- Browser: **135 passed / 50 intentional skips / 0 failures**, with WebGPU required: WebGL 2 **70/20 skipped**,
  WebGPU **60/30 skipped**, auto **5 passed**. Skips are four older backend/tour exclusions plus 28 W2-only cases
  in the WebGPU project and 18 WG-only cases in WebGL 2. Neither GPU backend was skipped as unavailable.
- **13 explicit 300-frame oracles = 3,900 compared frame pairs**, identical, both errors null, lifted
  `interp_insns=0`: all eleven `x64-*` examples, `x86-threads`, and `win32-hello`. Exact IDs and commands:
  [verification.md](verification.md#integration-i1--merged-tree).
- Browser tests now always own their server; an unrelated SPA's catch-all HTTP 200 cannot be reused as kit readiness.
  Integration runs use free port **5292**, never the developer's `:5173`.
- Independent fresh-session review found a pending-GPU fallback hole, repaired with host-state guards and unit/browser
  regressions. A second fresh recheck found that blocker fixed, no further concrete scoped issue, and independently
  passed **34 focused tests / 2 files**. Details: [integration handoff](handoff/integration-i1.md).

## Delivered implementation

| Area | Merged behavior / evidence | Explicit boundary |
|---|---|---|
| AMD64 execution, Task 1 | Shared decoder/interpreter/lifter, baseline SSE/SSE2, Win64 callbacks, TLS, MinGW C++ SEH/unwind; known-result and zero-interpretation fixtures | Not arbitrary Win64, MSVC personalities, AVX, general x87 or precise nondefault FP environment |
| CRT + memory, Task 2a | Shared 396-name CRT registry, normal -O2 C/STL native-reference fixtures, 600 MiB touched/153600 pages checked in a configured 2048 MiB window | Default 1024 MiB guest window, images 16–64 MiB; locale/files/math/formatting remain bounded |
| S1 GPU ABI §13 | All 25 opcodes 0x40..0x58, C/TS layouts/encoders, resource/pass/budget validation, owned uploads/source, deferred shader results and negotiated limits | Frozen old IO/commands retained; capability and language support are separate |
| WG WebGPU | All §13 commands; native WGSL plus kit GLSL330/ES300→WGSL frontend; formats, MRT, depth/stencil, indexed/base-vertex/instances, recovery and ordered 2D/GPU screen/readback | Practical frontend, not unrestricted GLSL; explicit errors for unsupported syntax; language mask 7 |
| W2 WebGL 2 | All §13 commands; GLSL330/ES300 execution, portable IDs/strides, MRT/depth/stencil/mips, interleaving/readback and actual context-loss restoration | WGSL is **WebGPU-only**; mask 6; CAP_GPU requires extensions and portable limits |
| GL OpenGL profile | WGL and bounded GL 3.3 state→§13 command stream; 360 registered names, 146 implemented / 214 explicit unsupported thunks; seven-scene `x64-gl` | Not all GL 3.3; recorder-based semantic oracle is not a native-driver pixel golden |
| E COM/audio/input | Class registry/identity/refcounts/task memory, WASAPI shared stereo float32/int16 + virtual clock, Raw Input, separate four-slot gamepads, XInput and best-effort rumble | No general COM marshaling, capture/exclusive audio, WinMM/DirectSound expansion, full HID or physical rumble verification |
| C threads | Deterministic cooperative i386/AMD64 workers, waits/events/mutexes/semaphores/CS/SRW/CV/address waits, TLS/FLS/TEBs/last error and instruction quantum | Bounded single process; native callback continuations are LIFO, not general native fibers |
| F codegen | Register-local AMD64 integer/common SSE emission, conservative flag liveness, guarded flat-memory spans, cold semantic/quantum boundaries | Correctness gates green; literal x64-crt performance acceptance remains **unmet** |
| G reviewer bridge | Workspace-only extension, persistent loopback queues/status/waits/live and no-tools fork questions, independent-clone launcher | Same-user coordination, not authentication/isolation; settled does not mean tests passed |
| Existing UI/files/slices | Phase 0 UI/font fixes, streamed read-only Win32 files, coverage-guided strict code/data slices and explicit outside-slice stops | Not minimum loader images, lazy wasm chunks, complete Win32 APIs or multi-million-insn feasibility |

Details: [GPU ABI](../bgt/abi/ABI.md#13-v03-gpu-layer-additive-interface),
[WebGPU backend](../bgt/renderers/webgpu/README.md), [WebGL 2 backend](../bgt/renderers/webgl2/README.md),
[threads](../platforms/win32/THREADS.md), [pipeline](pipeline.md), [trials/bridge](trials.md).

## Integration decisions (not lane replacement)

1. Keep all E COM/audio/input, GL and kernel/USER/GDI import tables and every profile DLL. Give thread-aware
   duplicate APIs priority; preserve C's scheduler, per-thread errors, deferred-result traces and continuation tables.
   Compile audio/COM/input/GL/thread/scheduler sources for both guest widths.
2. Replace E's temporary main-thread event adapter with scheduler-owned events. Native audio signaling validates the
   shared event namespace and wakes waiters without changing guest arguments/last error. COM apartment mode/nesting
   is per guest thread. The audio fixture now joins a worker woken by WASAPI, checks isolated STA/MTA nesting and
   last error, and retains its exact sample/amplitude/frequency/duration checks.
3. Keep F's optimized emitter, not C's older generic emitter. Its cold CALL path returns on a pre-execution quantum
   transfer before invoking the unexecuted target. Existing thread spin/continuation and codegen CPU/RAM regressions pass.
4. Share CAP_GPU/backend negotiation and restoration events. Fail closed on **host logical resources, queued GPU work
   or renderer objects**, including loss before first GPU draw. Resource-free legacy 2D fallback may renegotiate to
   WebGL 2; no live §13 language/resource migration is performed. This resolves WG/W2 policy overlap using the explicit
   safe default after a reviewer timeout; existing fallback and GPU-loss assertions were preserved.

## Remaining limits / deferred acceptance

### F-PERF-CRT remains open

Lane F's saved same-toolchain whole-module benchmark reports CPU-heavy code **4.85× smaller / 3.65× faster**, but
`x64-crt` only **1.55× smaller / 1.10× faster**, below the literal ≥2× size-and-speed requirement. `x64-cpp` and
`win32-hello` did not improve execution time in that sample. These are lane measurements, **not rebenchmarked on the
larger merged profile**. Cache differences prevent claiming compilation speedups; no 7M-instruction feasibility or
universal speedup. See [codegen handoff](handoff/codegen.md) and its committed before/after JSON.

### GPU / GL

WGSL is not translated for WebGL 2. The maintained WG frontend does not implement unrestricted preprocessing,
extensions, user-struct/out-parameter syntax, ordinary non-block uniform or sampler-array contracts. Both renderers
restore uploaded resources but lose rendered attachments and emit reset/targets-lost events. Unrecoverable GPU
resources are never silently migrated.

GL names are bounded to 255 per object type, caches to 128 descriptors, one current WGL context and one shader per
stage. Replaced source/uploads retain arena bytes. Uniform arrays/structs and preprocessing-dependent reflection,
non-square matrices, mapping/query/sync APIs, arbitrary framebuffer readback, depth uploads, conversions outside
float1..4/normalized-u8x4/i32/u32 attributes, divisors other than 0/1, scissored/masked clears, reversed depth ranges
and constant-alpha combinations are unsupported or visibly rejected. ReadPixels is in-bounds screen RGBA/u8 only.
See [GL handoff](handoff/gl-profile.md) for the exact exclusions. I1 proves GL semantic stream generation and each
backend's native §13 scenes separately; full end-to-end GL scene pixel/orientation goldens remain deferred.
The equivalent native backend scene fixtures remain separate rather than being silently treated as one golden.

### Threads / COM / audio / input

64 lifetime thread slots (including primary), 1023 non-reused synchronization handles, 512 live lock addresses;
retained stacks/TEBs, unnamed single-process objects. No APC delivery, priority, asynchronous thread termination,
fibers or general cyclic parked-native continuation switching. CPU rotation is deferred inside native callbacks;
frame yields still occur. InitOnceExecuteOnce and broader CRT per-thread locale/errno/x87 were not expanded.
COM apartment initialization is thread-local; this is not general apartment marshaling. Audio has a 19,200-frame
source ring and deterministic non-bandlimited resampling; locked/full browser queues may drop samples. No capture,
endpoint notification/enumeration, exclusive/extensible formats, BSTR/variant arrays, raw wheel/full HID enumeration
or low-bit async key latches. No physical actuator/listening or mobile fidelity claim.

### Existing general / packaging / hardware boundaries

C/ASCII locale, UTC localtime, empty environment and bounded CRT formatting/math. Shipped read-only files plus
process-local writable/temp CRT files, not persistent general filesystem writes. Unsupported instructions/APIs fail
explicitly. Substitute fonts/icons are not Windows-pixel parity; arbitrary fonts/non-ASCII and broad GDI algebra
remain limited. DOS/consoles have no systematic profile. Minimum loader-image data, instruction-level coverage,
lazy wasm code, automatic multi-reload coverage union and long representative real-game stability remain future work.
Physical iPhone/Safari/Firefox, remote Ubuntu/CI and nested sandbox validation were not performed by I1. No new game
input, dependencies, system installs or engine-specific runtime path; no test weakening or push.
