# v0.3 merged implementation status

Integration I5 on `integration/p1` merges **K6b** with `--no-ff` after **K6e, K6a, K6c and K6d**. K6a's texture/FBO
and additive ABI §13.7 contracts coexist with K6b's GLSL preprocessor, shader/program objects and reflection.
I5 enables floating 3D and 2D-array samplers through typed reflection, per-program texture-unit bindings, GLSL ES
3.00 and WGSL; cube maps remain explicitly rejected. The earlier I4 CRT buffering/slice-discovery integration
and I3 shared VFS, priority/protection, x87, bridge and scale work remain in place.
This is still **0.3.0-dev.1**, a bounded kit-development delivery, not unrestricted Windows/OpenGL compatibility,
a release certification, or a new game-playability claim. This merged ledger supersedes the old per-stage missing
lists. Historical measurements remain in [verification.md](verification.md); lane details are in [handoff/](handoff/).

## I5 merged verification

Doctor, clang + real GCC lint (**27 examples**), typecheck and leakcheck pass. Full required-WebGPU browser suite:
**208 passed / 51 existing intentional skips / 0 failed / 0 flaky** (WebGL 2 **94/24**, WebGPU **106/26**, auto **8/1**).
All **23 pipeline examples × 300 frames = 6,900 identical pairs**, null errors, zero lifted interpretation and empty
lifted stub lists. The unchanged default unit suite is **655 passed / 5 failed**, 59 files, no skips: only the merged
K6e FIFO gate's sandbox-denied `ps`/liveness regressions fail. Reviewer-directed **external validation of
`tests/unit/pi-harness.test.ts` on the exact commit is pending**; no sandbox change, skipped acceptance test or K7i
cherry-pick is substituted. No full Tier 1-green claim is made while that gate is pending. Details and intermediate
failures: [I5 handoff](handoff/integration-i5.md).
The original CC0 `x64-gl-fbo` fixture now verifies typed sampler reflection, nonzero units 3/5 with unit-zero
bindings cleared, distinct 3D slices/array layers, and shader-biased mips; all existing FBO/pixel assertions remain.
Host frontend regressions cover dimensional sampler arrays, Y-only coordinate/gradient/fetch conversion,
GLSL ES 3.00 declarations, WGSL texture types and retained shader bias. No tolerances or assertions were weakened.

## Historical I3 merged verification

- **Tier 1 green on final implementation `d5f836c`:** doctor ready; lint (ESLint, real GCC and all **22 example
  check-builds**), typecheck and leakcheck pass. Explicit host builds also pass with **clang 21 and GCC 14.2**,
  `-O2 -Wall -Wextra -Werror`.
- Unit: **504 tests / 43 files passed**, zero skips/failures. The first merged run exposed K3's standalone harness
  missing K2 protection metadata; repaired with definitions only, without changing any x87 assertions. Final suite
  was rerun after the last empty-path regression. Bridge fixtures still isolate/restore inherited provider settings.
- Browser: **196 passed / 51 existing intentional skips / 0 failures**, WebGPU required: WebGL 2 **89/24 skipped**,
  WebGPU **99/26 skipped**, auto **8/1 skipped**. Skips are unchanged backend/tour exclusions and opt-in no-adapter /
  injected-broken-device policy cases; neither GPU backend was unavailable. No skip policy was added or weakened.
- **All 18 pipeline examples × 300 frames = 5,400 identical frame pairs**, both errors null, lifted
  `interp_insns=0`, empty stub lists. Includes K1 sysdlls, K2 contracts and LSC scale. Smoke additionally compares
  20 startup frames; its existing unit/browser workloads retain 600 GL loops. Four native examples have no guest
  interpreter and retain their build/browser/known-answer coverage, not a fabricated differential self-oracle.
  Exact inventory and commands: [I3 handoff](handoff/integration-i3.md).
- Browser tests own port **5203**, never developer `:5173`; unrelated SPA readiness cannot be reused.
- Real fresh independent sessions inspected the merges/hooks and later repairs. Final fresh reviewer independently
  passed **55 focused tests / 5 files** at `d5f836c`, including both guest widths/execution modes, x87, codegen,
  bridge and host entropy/scheduler checks; **PASS within bounded scope**. Broad Tier 1 gates above are integrator
  evidence, not attributed to that reviewer. Earlier I1/I2 reviews remain in their historical handoffs.

## K6d follow-up verification

The Q24 CRT metadata follow-up is verified on top of I4 (`ca2cd17`): one VFS implementation now serves kernel32
and both-width CRT stat/fstat/access/directory/find/cwd/fullpath/remove/rename families, plus implemented registry
value deletion. Final gates: doctor, clang + GCC lint (**24 examples**), typecheck and leakcheck pass;
**576 unit tests / 53 files**, **200 browser passes / 51 existing intentional skips**, both backends exercised;
**20 pipeline oracles × 300 frames = 6,000 identical pairs**, null errors, zero lifted interpretation and empty
stub lists. Both-width CRT fixtures add **251 i386 / 330 AMD64 checks**, lifted and interpreted, and complete
**600-frame** identical oracles. These local bounded results supersede no historical native/hardware limits.
Details, review findings, fixes and provenance: [K6d handoff](handoff/K6d.md).

## Delivered implementation

| Area | Merged behavior / evidence | Explicit boundary |
|---|---|---|
| AMD64 execution, Task 1 | Shared decoder/interpreter/lifter, baseline SSE/SSE2, Win64 callbacks, TLS, MinGW C++ SEH/unwind; known-result and zero-interpretation fixtures | Not arbitrary Win64, MSVC personalities or AVX; bounded x87 model below |
| CRT + memory, Task 2a | Shared 396-name CRT registry, normal -O2 C/STL native-reference fixtures, 600 MiB touched/153600 pages checked in a configured 2048 MiB window | Default 1024 MiB guest window, images 16–64 MiB; locale/files/math/formatting remain bounded |
| S1 + K6a GPU ABI §13/§13.7 | All 30 opcodes 0x40..0x5d, C/TS layouts/encoders, 2D/3D/array storage, extra formats, LOD samplers, readback/mip generation, resource/pass/budget validation | Frozen old IO/commands and 80-byte limits retained; no cube/layered/depth-volume storage |
| WG WebGPU | All §13 commands; native WGSL plus kit GLSL330/ES300→WGSL frontend; formats, MRT, depth/stencil, indexed/base-vertex/instances, recovery and ordered 2D/GPU screen/readback | Practical frontend, not unrestricted GLSL; explicit errors for unsupported syntax; language mask 7 |
| W2 WebGL 2 | All §13 commands; GLSL330/ES300 execution, portable IDs/strides, MRT/depth/stencil/mips, interleaving/readback and actual context-loss restoration | WGSL is **WebGPU-only**; mask 6; CAP_GPU requires extensions and portable limits |
| GL OpenGL profile + K6a/K6b | WGL/GL 3.3→§13/§13.7; 360 names, 192 implemented / 168 explicit unsupported; textures/FBOs, preprocessing, active-uniform/block/attribute reflection, uniform arrays/structs; `x64-gl`, `x64-gl-fbo` and `x64-glsl` real-backend pixels | Bounded GL subset, not full GL 3.3; cube maps rejected; recording semantic oracle is separate from raster evidence |
| E COM/audio/input + K8c | Class registry/identity/refcounts/task memory, WASAPI shared stereo float32/int16 + virtual clock, process-local endpoint notification ownership, Raw Input, separate four-slot gamepads, XInput and best-effort rumble | No general COM marshaling, capture/exclusive audio, WinMM/DirectSound expansion, full HID or physical rumble verification |
| C threads | Deterministic cooperative i386/AMD64 workers, waits/events/mutexes/semaphores/CS/SRW/CV/address waits, TLS/FLS/TEBs/last error and instruction quantum | Bounded single process; native callback continuations are LIFO, not general native fibers |
| F codegen | Register-local AMD64 integer/common SSE emission, conservative flag liveness, guarded flat-memory spans, cold semantic/quantum boundaries | Correctness gates green; literal x64-crt performance acceptance remains **unmet** |
| G reviewer bridge | Workspace-only extension, persistent loopback queues/status/waits/live and no-tools fork questions, independent-clone launcher | Same-user coordination, not authentication/isolation; settled does not mean tests passed |
| Existing UI/files/slices | Phase 0 UI/font fixes, streamed read-only Win32 files, coverage-guided strict code/data slices and explicit outside-slice stops | Not minimum loader images, lazy wasm chunks or complete Win32 APIs |
| K1 system DLLs | Nine DLL namespaces; 43 exercised exports, offline Winsock ownership/errors, DirectInput snapshots, Web Crypto entropy and bounded AVRT scheduler weights | No network/DNS transport, compositor, IME, adapters or fabricated unavailable hardware; [K1](handoff/K1.md) |
| K2 existing DLLs / census | Width-aware complete ordered registry census with failure-only annotations; page protections, FILE/descriptors, mutable VFS enumeration, icons, clipboard and pointer tracking | 33 of 131 requested unique contracts are tested failure-only; process-local writes, bounded UI/memory/CRT; [contracts](../platforms/win32/CONTRACTS.md) |
| K6d CRT filesystem / registry | Shared kernel/CRT metadata, stat/find layouts, nested directory/cwd/path/rename/remove operations, timestamps/errno and RegDeleteValueA/W tombstones; [handoff](handoff/K6d.md) | No i386 FILE layer, persistent writable kernel files, Unicode/extra drives/short names/chmod/utime, or RegDeleteKey; native error mappings remain INFERRED |
| K3 x87 / analysis / metadata | Shared software ext80 basic arithmetic/control/state; retained-function census, conservative AMD64 NULL pruning and bounded unwind-table continuation | Binary64-accuracy transcendentals; explicit unmasked-exception faults, not general Windows FP SEH; [precision model](../platforms/x86/X87.md) |
| LBR harness | Process-owned exits, queued isolated lanes, bounded session-fork retries, machine-wide heavy gate, verified cleanup; CI reviewer requests default 45 min | Same-user coordination, not authentication; nested seatbelt and Linux lockf availability not certified; [handoff](handoff/harness-hardening.md) |
| LSC scale / loading | Bounded function-preserving chunks, content caches/writer leases, hash-verified streaming wasm loads; 1,609,529-insn fixture with native checksum + 300-frame oracle | Not a 7.1M game build, lazy modules, mobile performance or a full-workspace disk bound; [measurements/caveats](handoff/scale.md) |

Details: [GPU ABI](../bgt/abi/ABI.md#13-v03-gpu-layer-additive-interface),
[WebGPU backend](../bgt/renderers/webgpu/README.md), [WebGL 2 backend](../bgt/renderers/webgl2/README.md),
[threads](../platforms/win32/THREADS.md), [pipeline](pipeline.md), [trials/bridge](trials.md).

## Integration decisions (not lane replacement)

1. Keep all E COM/audio/input, GL and kernel/USER/GDI import tables and every profile DLL. Give thread-aware
   duplicate APIs priority; preserve C's scheduler, per-thread errors, deferred-result traces and continuation tables.
   Compile audio/COM/input/GL/thread/scheduler sources for both guest widths.
2. Replace E's temporary main-thread event adapter with scheduler-owned events. Native audio signaling validates the
   shared event namespace and wakes waiters without changing guest arguments/last error. COM apartment mode/nesting
   is per guest thread. I2's audio client is created/rendered/released entirely on a guest audio thread while the
   primary joins it; nested worker wakeups still check isolated STA/MTA nesting/last error. Exact 48,000 stereo-frame
   sample/amplitude/frequency/duration assertions remain unchanged.
3. Keep F's optimized emitter, not C's older generic emitter. Its cold CALL path returns on a pre-execution quantum
   transfer before invoking the unexecuted target. Existing thread spin/continuation and codegen CPU/RAM regressions pass.
4. Share CAP_GPU/backend negotiation and restoration events. Fail closed on **host logical resources, queued GPU work
   or renderer objects**, including loss before first GPU draw. Resource-free legacy 2D fallback may renegotiate to
   WebGL 2; no live §13 language/resource migration is performed. This resolves WG/W2 policy overlap using the explicit
   safe default after a reviewer timeout; existing fallback and GPU-loss assertions were preserved.
5. K2/K1 core conflict: retain all DLL tables and the union of FindFirstFile/INVALID_SOCKET full-width invalid
   handles. Use the ordered, preprocessed census with K1's compact table declarations as well as K2's width,
   precedence and failure-only behavior. No lane-specific second inventory replaces runtime registrations.
6. PathFileExistsW and GetFileAttributes share K2's shipped/mutable metadata index with enumeration. Queries do
   not consume kernel/CRT/search slots and preserve PathFileExistsW last error. Anonymous tmpfile remains unnamed;
   named writable/temp paths, directories, rename and unlink are visible immediately. K6d additionally implements
   nested cwd, empty process-local directory deletion and closed mutable-file removal through both kernel/CRT
   front ends; shipped assets remain read-only. Persistent kernel writes remain unavailable.
7. Preserve K3's lifter/FPU changes and K2's per-page checks. A monotonic global protection flag disables unchecked
   whole-block span paths before any local mutation once non-default permissions are installed. Checked semantic
   boundaries retain legal read-only reads and precise protected-write faults; restoring RWX does not reset the flag.
   This is conservative, not a new performance claim.
8. Kernel SetThreadPriority drives K1's scheduler hook without replenishing credits; GetThreadPriority retains the
   requested Windows value, separate from AVRT's temporary scheduler weight. CI reviewer requests containing “run CI”
   default to 2700 seconds (ordinary decisions: 900), with explicit timeout overrides and 15–45-minute guidance.

## Remaining limits / deferred acceptance

### F-PERF-CRT remains open

Lane F's saved same-toolchain whole-module benchmark reports CPU-heavy code **4.85× smaller / 3.65× faster**, but
`x64-crt` only **1.55× smaller / 1.10× faster**, below the literal ≥2× size-and-speed requirement. `x64-cpp` and
`win32-hello` did not improve execution time in that sample. These are lane measurements, **not rebenchmarked on the
larger merged profile**. Cache differences prevent claiming compilation speedups; no 7M-instruction feasibility or
universal speedup. See [codegen handoff](handoff/codegen.md) and its committed before/after JSON.

### GPU / GL

WGSL is not translated for WebGL 2. The maintained WG frontend consumes canonical §13 shaders, not unrestricted
preprocessing/extensions or ordinary non-block GL uniforms. K6b's bounded C frontend preprocesses, reflects and
flattens those uniforms, arrays/structs, blocks and constant sampler-array elements before backend compilation;
the WG frontend supports user structs and local out/inout arguments. Both renderers restore uploaded resources
but lose rendered attachments and emit reset/targets-lost events; unrecoverable resources are never silently migrated.

GL names are bounded to 255 per object type, caches to 128 descriptors, one current WGL context and one shader per
stage. The shader frontend uses pooled storage (1 MiB source/expansion, 512 uniforms, 16 KiB ordinary uniform data,
8 samplers/7 user blocks); texture uploads remain bounded by the ABI. K6a adds color texture/FBO readback and
validated pixel-store conversion, nonzero mips, renderbuffers and multiple draw buffers. No cube/1D/rectangle/MSAA,
layered/3D attachment, depth transfer or integer/SNORM/compressed-format support is claimed. Array-shadow/integer
samplers, dynamic sampler indexing/parameters, row-major/block-array/interface-block translation and specified
non-square matrix forms remain unsupported. Mapping/query/sync APIs, conversions outside
float1..4/normalized-u8x4/i32/u32 attributes, divisors other than 0/1, scissored/masked clears, reversed depth ranges
and constant-alpha combinations are unsupported or visibly rejected. Legal border wrap and LOD bias parameters
remain queryable counted approximations. See [K6a](handoff/K6a.md), [K6b](handoff/K6b.md) and the superseding
[I5 integration](handoff/integration-i5.md) limits. I2 compiles/rasterizes `x64-gl` on both actual
backends, with per-tile goldens, side-effecting UV evaluation, colored ordered readback and cross-image comparisons.
One `gpu-scenes` fixture supplies common GLSL/ES scenes to both backends; native WGSL/lifetime extras remain selectable
within that fixture, not a duplicate executable. [Tolerance and launch details](../examples/gpu-scenes/README.md).
`x64-smoke` normally links GL 3.3 + worker/file + ten-second WASAPI thread + XInput; 600 GL frames/6,000 draws, exact
worker checksum/joins and matching per-frame API hashes/pixels across backends. These are synthetic integration
fixtures, not an engine/game compatibility or performance claim.

### Threads / COM / audio / input

64 lifetime thread slots (including primary), 1023 non-reused synchronization handles, 512 live lock addresses;
retained stacks/TEBs, unnamed single-process objects. Kernel -2..2 priorities now drive weights 1..5; -15/+15
map to bounded endpoint weights, not host realtime. Repeated changes cannot replenish credits or starve runnable
peers. No APC delivery, asynchronous thread termination, fibers or general cyclic parked-native continuation switching. CPU rotation is deferred inside native callbacks;
frame yields still occur. InitOnceExecuteOnce and broader CRT per-thread locale/errno remain bounded; K3's x87
state is part of the whole saved CPU context.
COM apartment initialization is thread-local; this is not general apartment marshaling. Audio has a guest-heap-owned
source ring sized from the requested duration and deterministic non-bandlimited resampling; locked/full browser queues
may drop samples. K8c adds process-local endpoint notification registration/guest reference ownership (fixed topology, no
unsolicited changes); endpoint collection enumeration remains unsupported. No capture, exclusive mode, unsupported EXTENSIBLE layouts,
BSTR/variant arrays, raw wheel/full HID enumeration or low-bit async key latches. No physical actuator/listening or
mobile fidelity claim.

### Existing general / packaging / hardware boundaries

C/ASCII locale, UTC localtime, empty environment and bounded CRT formatting/math. Shipped read-only files plus
process-local writable/temp CRT files, not persistent general filesystem writes. Unsupported instructions/APIs fail
explicitly. Substitute fonts/icons are not Windows-pixel parity; arbitrary fonts/non-ASCII and broad GDI algebra
remain limited. DOS/consoles have no systematic profile. Minimum loader-image data, instruction-level coverage,
lazy wasm code, automatic multi-reload coverage union and long representative real-game stability remain future work.
FIX3 records the existing green Ubuntu CI evidence; I3's gates are local sandbox runs, not new remote CI.
Physical iPhone/Safari/Firefox and nested sandbox validation are not certified. No new game
input, dependencies, system installs or engine-specific runtime path; no test weakening or push.
