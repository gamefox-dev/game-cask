# v0.3 merged implementation status

## Integration I8 final three-lane checkpoint — K11 + K10 + K13

Ordered merges remain **`140b96c`** (K11 / `2124b13`), **`aa0f739`** (K10 / `f1fd1d9`), then **`fb1ce3d`**
(K13 / `9f5c191`), with follow-up commits `6f5eeae`, `7e31051`, `0f64339`. K13 adds bounded native scalar SSE,
checked native-step lookup/chaining and exact native suffix interiors; K10 coverage/census and Asyncify semantics are
preserved, with only generated `N_*` steps excluded from Asyncify. K9 GL and K12 heap sources remain preserved.

Three-lane validation evidence: **1,057 unit tests / 81 files**, **232 browser passes / 51 unchanged skips**
(WebGL2 104/24, WebGPU 120/26, auto 8/1), lint's **33/33 example check-builds**, and leakcheck's **619 files**
passed in the logged run. **29 default pipeline oracles ×300 = 8,700 pairs** plus `x64-crt`, `x64-cpp`, and
`x64-scale` in size/fast (**1,800 pairs**) all matched with null errors, zero lifted interpretation and empty stubs;
**10,500 total frame pairs**. Exact final-checkpoint caveat and logs: [I8 handoff](handoff/integration-i8.md).
A provider 429 prevented the requested follow-up review of the corrected suffix-test-only change; no independent PASS
claim is made for that change. No engine speedup, first-draw, title or F-PERF-CRT closure claim.

## Integration I8 — K11 + K10 over K12 (pre-K13 verification)

Reviewer scope extension: K13 (`9f5c191`) is now being integrated after these two lanes. The counts below are
pre-K13 evidence, not a final three-lane acceptance claim.

### K11 + K10 checkpoint

Ordered `--no-ff` merges **`140b96c`** (K11 / `2124b13`) then **`aa0f739`** (K10 / `f1fd1d9`) preserve K12's
segregated heap and K9's GL work. Size remains default; fast is opt-in. K10 coverage/strict checks and census reasons
are exercised in both presets, including affine quantum/guard boundaries and suspending handwritten overrides.
Final merged implementation gates: doctor, ESLint + clang/real-GCC lint (**33 example check-builds**, including scale),
typecheck and leakcheck pass; **1,020 unit tests / 79 files**, **232 browser passes / 51 unchanged intentional skips**,
both required backends. **29 default pipeline oracles × 300 = 8,700 identical pairs**, plus CRT/C++/scale in fast
(**900 more pairs**); the explicit size/fast matrix repeats three size controls (**10,500 total compared pairs**).
All lifted runs have zero interpreted instructions and empty stubs. Fresh independent bounded source follow-up passes;
no engine-speedup, first-draw or F-PERF-CRT closure claim. Details: [I8 handoff](handoff/integration-i8.md).

## K13 — native scalar SSE and flat boundary chaining

K13 adds native scalar SSE conversions/COMI, flat foreign-owner/thunk chaining, checked lookup caching and
bounded SSE/tiny native interior entries. Post-review gates: **840 units /68 files**, **218 browser passes /51
unchanged skips**, **25 ×2 presets ×300 =15,000 identical oracle pairs**. Final size+fast isolated A/B: scalar
~3×, interior ~2.6–3.1×; import/vtable gains are small/noisy (fast import unchanged), not an engine-speedup claim.
Independent **vK13 FAIL then vK13b PASS at 59ddafd** after memory-permission and test-sensitivity fixes.
Committed every sample, scope/tradeoffs: [K13 handoff](handoff/K13.md).

## K11 — opt-in lifted-code speed policies

K11 delivers opt-in AMD64 memory/ALU/attribute/counting policies (`pipeline.liftPreset: "fast"`, size-oriented defaults retained); **807 units / 66 files**, **218 browser passes / 51 unchanged skips**, **25 default pipeline oracles ×300** plus **6 ×2 policy oracles ×300** pass. Full measurements, bounded independent validation and explicit no-engine-speedup boundary: [K11 handoff](handoff/K11.md).
## K14b — Q41/Q42/Q43 completion

Commit `55e11c1` completes sparse fragment-output masks, linked std140 uniform-block ranges with the approved counted desktop zero-tail policy for undersized bound ranges, bounded GPU continuation and ordered `BUFFER_COPY` / `glCopyBufferSubData` on both WebGL 2 and WebGPU. Original CC0 fixtures cover exact sparse MRT pixels, 80/176/192-byte block reflection and relinking, short-range diagnostics/recovery, 289 native byte-copy comparisons per backend, and 3,000 ordered feedback draws. Final gates: **996 unit tests / 75 files**, **241 browser passes / 51 existing intentional skips / 0 failures**, doctor, ESLint + Clang/real-GCC lint (**33 example check-builds**), typecheck and leakcheck; **30 pipeline oracles × 300 frames = 9,000 identical pairs**. The ranges browser fixture records **121 guest checks per backend**, peak **9,008 lists / 39,008 commands**, with exact cross-backend finish results. No target title/playability or unrestricted GL 3.3 claim; see [K14b handoff](handoff/K14b.md).
## K14a checkpoint — Q40 opaque sampler helper parameters

Commit `8e6f602` adds bounded GLSL 3.30 / ES 3.00 opaque sampler-parameter specialization to the GL profile and
both native translators, with CC0 forwarding, overload, shadow/integer, array-identity, invalid-use and fallthrough
regressions. Final full unit evidence is **1,039/1,039 tests across 73 files**; doctor, lint (32 example checks),
leakcheck and typecheck passed. The native scratch audit found **104 unique captured stages plus the rejected
fragment; 105/105 compiled on each backend**, but it predates the last reviewer-fix amendment and is explicitly
pending rerun on the exact final tree. Full browser/oracle evidence likewise needs the checkpoint rerun; see
[K14a handoff](handoff/K14a.md). Q41–Q43 remain separate K14b requests. No title-screen or game-playability claim.

## K12 — deterministic guest heap and CRT allocation

K12 adds a bounded-work segregated guest heap for both Win32 widths, real logical `HeapCreate` ownership and
quotas, boundary-tag coalescing/in-place realloc, truthful failure/exception behavior, and the shared CRT
malloc/aligned/recalloc family. Original CC0 x64/i386 fixtures cover contracts and 300-frame differential
oracles; native invariants exercise 150,000 randomized operations per width. The same-machine CC0 benchmark
holds at 12.606–17.497 ns/operation from 4,005 to 40,005 live allocations versus 3,620–149,858 ns for the
old first-fit implementation. Final K12 gates: **979 unit tests / 72 files**, **232 browser passes / 51 existing
intentional skips**, doctor, clang+GCC lint (**32 example check-builds**), typecheck, leakcheck, and **29 pipeline oracles × 300 = 8,700
identical pairs**. Nested SEH/native-callback OOM is an explicit x86-runtime boundary with a precise diagnostic;
ordinary exhausted-backing AMD64 OOM dispatch is covered. Details: [K12 handoff](handoff/K12.md).

## Integration I7 — K9a + K9b

Integration commit **`2638514`** merges K9a with lane K9b/K9c using `--no-ff`, preserving K9a's GLSL integer,
aggregate-equality, lazy-expression and copy-in/copy-out lowering through K9b's WebGPU transform-feedback
vertex-to-compute path, plus K9b's Q34 transform feedback and Q35 blits. The conflict resolution exports the shared
identifier mangler while retaining K9a's complete reserved-word mapping. An original CC0 regression combines hex
literals, vector/struct equality and an inout helper in a captured vertex shader; exact interleaved/separate bytes
pass in GLSL330 and ES300 on both backends. Final gates: **965 unit tests / 71 files**, **228 browser passes / 51
unchanged intentional skips**, doctor, Clang + real GCC lint (**30 example checks**), typecheck and leakcheck pass;
**27 pipeline oracles × 300 frames = 8,100 identical pairs**, with zero lifted interpretation and empty stubs.
Details: [I7 handoff](handoff/integration-i7.md).

## K9a GLSL translation contracts

K9a adds full 32-bit integer literal/constant handling, scalar aggregate equality, lazy conditional/short-circuit
expression lowering and `out`/`inout` copy-in/copy-out with mutable caller storage, plus original CC0 cross-backend
numerical regressions. Scratch-only audit: **135 captured submissions / 61 unique sources**, all translate and compile
on both actual native compilers (stage compilation, not captured pipeline/render certification). WebGL 2 explicitly
rejects the native boundary `put(v.wy[dynamicIndex])` for out/inout parameters before native compilation; later unrelated
shader compilation/rendering is tested. Direct swizzles, array elements, members and aliases remain supported.
Final gates on `3dbd9e0`: doctor, clang + GCC lint (28 example checks), typecheck and leakcheck pass;
**939 units / 68 files**, **218 browser passes / 51 intentional skips**, **25 pipeline oracles × 300 frames = 7,500
identical pairs**. Original numeric corpus: **350 rendered results** (348 common + 2 WebGPU native-boundary controls),
plus two explicit WebGL rejections and subsequent successful renders. Fresh independent bounded review passes.
No wire ABI changes or target first-draw/title/playability claim. Details: [K9a handoff](handoff/K9a.md).

## K9b / K9c Q34 and Q35

Lane K9c (`3fea2b8`, `a256b2a`) implements ordered transform feedback (§13.11 / opcodes 0x61..0x63) on both backends: native WebGL2 capture and separate WebGPU vertex→compute lowering, pending/linked interfaces, original builtin capture, interleaved/separate buffers, ordering/discard/queries/errors and exact native readback. The original CC0 `x64-gl-feedback` fixture has **100 guest checks per backend**, exact captured bytes and cross-backend finish pixels; native edge regressions cover unaligned fetches, failed-link/setup cleanup, fail-closed generated-buffer recovery and 4.2M expanded strip outputs. Fresh independent source review at `a256b2a`: **PASS within bounded read-only scope**, no Tier1 attribution. Lane K9b's single-sample blits (§13.10 / 0x60, `3776c8e`) remain covered. Final Tier 1: **813 units / 69 files**, **226 browser passes / 51 existing skips**, **27 × 300 = 8,100 identical pipeline oracle pairs**, doctor, ESLint + clang/real-GCC lint (30 check-builds), typecheck and leakcheck green. Generated-buffer recovery fails closed rather than restoring stale bytes; array/matrix varyings and native-WGSL capture remain explicit errors. No target first-draw/title or unrestricted GL33 claim. See [K9b/K9c handoff](handoff/K9b.md).

## K10 — execution profiling and coverage

K10 execution profiling/coverage lane is delivered on its branch: sampled timing/resettable census windows,
no-`-g` named profiling, wasm-local coverage buffering and exact native Asyncify exclusions. Final implementation
`d9b0603` is locally Tier1 green: doctor, clang/GCC lint (29 builds), typecheck, **803 units/73 files**, **218 browser
passes/51 intentional skips**, leakcheck and **25×300=7500 identical oracle pairs**. This is lane evidence, not a new
merged-tree/game acceptance claim. F-PERF-CRT remains open (final0.97× reference); the138MiB named game rebuild
remains porter verification. See [K10 handoff](handoff/K10.md) and [benchmarks](../tools/bench/README-execution.md).

## K8a Q21 final completion

Lane K8a continuation 3 completes the bounded Q21 GL contracts on top of `39c42d5`. The final implementation commits
are `c231e5e`, `732a19f`, `e0d268f`, `579bebd`, `0b1e751`, `c8792f7`, `872b112` and the final documentation commit.
Depth uploads/readback, all 18 integer texture formats and typed samplers/render targets, indexed typed clears, current
attributes, swizzles, lazy depth mip growth and configurable budgeting are covered by actual WebGL2/WebGPU fixtures.
WebGPU `DEPTH24_STENCIL8` stencil readback remains truthful `E_UNSUPPORTED`; integer out-of-range fragment output into
narrower targets remains an explicit native boundary and is excluded from portable cross-backend equality.

Final local tier-1 evidence: doctor ready; lint (ESLint, clang and real GCC) pass; typecheck pass; **790 unit tests / 66
files pass**; **218 browser tests pass / 51 intentional skips / 0 failures**; leakcheck pass; **25 pipeline examples ×
300 frames = 7,500 identical oracle pairs**, null errors, zero lifted interpretation and empty stub lists. The fresh
independent review passed within bounded source-review scope and did not claim tier-1 attribution. No original game
files were copied or run, and no first-draw/title/playability claim is made. See `docs/handoff/K8a.md` for fixture,
coverage and limitation detail.

Integration I6a on `integration/p1` merges **K8b** after K7i, then **K8c**, each with `--no-ff`. K8b adds typed
GLSL boolean-selector `mix` lowering and translation regressions for WebGPU/WebGL 2; K8c adds process-local WASAPI
endpoint-notification ownership and shared DOS `\\?\`/`\\.\` path normalization. K7i's separate compilation,
lazy declared test builds, shared CAS and sandbox-safe portable heavy gate remain intact; the earlier I5 GPU, CRT,
VFS, x87, bridge and scale work remains in place.
This is still **0.3.0-dev.1**, a bounded kit-development delivery, not unrestricted Windows/OpenGL compatibility,
a release certification, or a new game-playability claim. This merged ledger supersedes the old per-stage missing
lists. Historical measurements remain in [verification.md](verification.md); lane details are in [handoff/](handoff/).

## I6a merged verification

Doctor, ESLint + clang + real GCC lint (**27 example check-builds**), typecheck and leakcheck pass. The full sandbox
unit suite is **765 passed / 63 files / 0 failed**, including `tests/unit/pi-harness.test.ts`; K8b's new GLSL unit
file declares `x64-glsl`, so K7i lazy selection builds every declared fixture. Full required-WebGPU browser suite is
**210 passed / 51 existing intentional skips / 0 failed / 0 flaky** (WebGL 2 **95/24**, WebGPU **107/26**, auto
**8/1**). All **23 pipeline examples × 300 frames = 6,900 identical pairs**, null errors, zero lifted interpretation
and empty lifted stub lists. Details and command evidence: [I6a handoff](handoff/integration-i6a.md).

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
samplers, dynamic sampler indexing/parameters, row-major/block-array/interface-block translation remain unsupported. K9a adds all 2..4-column/row matrix forms to the WG frontend, including padded std140 two-row matrices;
the separate GL profile's existing non-square limitations are unchanged. Mapping/query/sync APIs, conversions outside
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
