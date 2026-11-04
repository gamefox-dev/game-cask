# The conversion pipeline

Current merged v0.3 scope and verification: [v03-status.md](v03-status.md). Historical Task 1 measurements below
remain bounded fixture evidence; K1/K2/K3 and scale/harness additions do not imply unrestricted game compatibility.

A port is a `game.json` that tells the pipeline which original files to convert, plus at most a few
hand-written exceptions. Everything else is generated reproducibly from the original binary.

```
original/GAME.EXE ──extract──► modules ──analyze──► functions / imports / jump tables
        │                                   │
        │                                   └──lift──► C (one function per original function, named F_<address>)
        │                                                     │
        └──────────── original images as private assets ──────┤
                                                              ▼
                 generated driver + lifted C + platform profile + overrides ──zig cc──► wasm ──asyncify──► game.wasm
```

## game.json
```json
{
  "id": "mygame", "name": "My Game", "private": true,
  "pipeline": {
    "platform": "win32",
    "modules": [
      { "from": "setup.exe#GAME.EXE", "main": true },
      { "from": "setup.exe#GAMELIB.DLL", "name": "gamelib.dll" }
    ],
    "width": 640, "height": 480
  },
  "touch": { "dpad": false, "buttons": [] }
}
```

`from` names a file in `original/`; `outer#inner` names a file inside an installer/archive (see
`npm run extract`). Module names must match how other modules import them (case-insensitive).

**Module resolution (Win32 semantics).** A DLL name resolves to a shipped module from `pipeline.modules` first, then
to a system DLL the profile implements (`platforms/win32/dlls.json`). A *static* import of anything else fails the
build with the importing module and DLL named. At run time `LoadLibrary*` of anything else returns NULL with
`GetLastError() == ERROR_MOD_NOT_FOUND` (126) and `GetProcAddress` returns NULL with `ERROR_PROC_NOT_FOUND` (127) for
names/ordinals that do not exist (the profile implements names, not ordinals), so programs take their own error path.
`LoadLibrary` strips a path and appends `.dll` to names without an extension; export forwarders are followed.
Imports by ordinal keep their number in fault and stub names (`comctl32.dll!#17`).
Images keep their preferred base address unless two overlap; then the later one is relocated (it needs a
`.reloc` section). Lifting and loading use the same base.

## Stages and what they guarantee
| stage | tool | output | guarantees |
|---|---|---|---|
| extract | `tools/extract/extract.py` | files + `extract.json` (chain, sha256) | static only; installer SHA-1s verified; encrypted installers refused |
| analyze | `tools/x86/x86tool analyze` | JSON: imports + call sites, functions (seeded by entry, exports, call targets, relocated and immediate code pointers), call graph, jump tables, census, `dataSeeds` | deterministic; pointer seeds that are data are not functions (below) |
| lift | `tools/x86/x86tool lift` | C: `F_<addr>()` per function, a label per instruction, explicit control flow, jump tables as `switch` | same semantics as the interpreter (`platforms/x86/x86_sem.h`) |
| profile | `platforms/win32` | Win32 API on BGT: USER (windows, messages, menus, dialogs), GDI on render targets (+ CPU replay for pixel reads), KERNEL/CRT, registry on storage | unknown APIs of known DLLs fault by name; unknown DLLs fail the build (static) or return NULL (dynamic) |
| oracle | `npm run oracle -- <game>` | lifted vs interpret-only build, same scripted input; per-frame API-trace hash | first divergent frame localises a bug |

### Data seeds
Code sections can hold data (merged `.text`: IAT, strings, GUIDs, tables). A *pointer* seed (relocated or immediate
code pointer; never an entry point, export or direct call target) is classified as data and not lifted when it lies
in a PE data directory or an import name, its bytes are a NUL-terminated string (ASCII ≥ 8 printable chars, or UTF-16
≥ 5), it starts with zero bytes, or it decodes into undecodable/unsupported instructions. The analysis is then re-run
without those seeds, so functions "called" from data disappear too. `dataSeeds` in the analysis JSON lists address,
seed kind and reason; `totals.dataSeeds` and the pipeline summary count them. A real function misclassified this way
still runs (interpreted, visible as `interp_insns`).

## Metrics (what to report)
- **Pipeline summary** (printed by the build, stored in `manifest.json` → `pipeline`):
  - generated vs hand-written LOC
  - functions and data seeds rejected; specialized vs generic instructions (generic = executed through the shared
    semantic core)
  - jump tables; unresolved indirect jumps; overrides; the DLLs each module imports
- **Runtime** (`diagnostics().metrics`, from the game's `bgt_metrics` export; names changed in v0.2.1, see
  `docs/verification.md`):
  - `interp_insns`: guest instructions that ran in the interpreter (0 = fully lifted)
  - `interp_code_entries`: dynamic interpreter block/continuation entries that executed at least one instruction
    (initial entry, control-flow successor, return from lifted/API code, or entry into a different analyzed owner;
    repeated loop entries count again). A pre-execution quantum transfer does not count.
  - `interp_functions`: distinct analyzed owning functions that executed at least one interpreted instruction,
    including functions entered at an interior address, not a count of instruction addresses or call events.
  - `interp_unowned_entries`: interpreter entry events outside analyzed ranges; these cannot be honestly labeled
    functions. Nonzero values identify analysis/discovery gaps rather than silently claiming a complete function census.
  - `tail_calls_lifted`: lifted jumps out of a function resolved straight to a lifted function (tail calls; not
    interpretation)
  - `continues_interpreted`: lifted frames that had to continue in the interpreter (unresolved jumps, code beyond
    known functions)
  - `generic_insn_execs`: instruction executions through the shared semantic core inside lifted code
  - `lifted_calls`, `api_calls`, `apis_hit`, `stubs` (declared no-ops that were called)
  - `gdi_ops` (program drawing only), `chrome_ops` (profile UI, including extra presentations), `gdi_approx_rop` (raster ops approximated on the GPU), `gdi_unsupported`
  - `gdi_pixel_reads` (GetPixel/GetDIBits calls), `gdi_cpu_replays` (answered by CPU replay), `gdi_replay_compactions`,
    `gdi_getpixel_noread` (impossible reads: the surface's history is unknown), `pixel_replay` (1 = enabled)
  - `mono_color_blits`, `peek_yields`, `targets_lost`, `trace_hash`
- **Exceptions**: every override with a reason; every kit gap in `reports/errors.json` and as an iteration request in
  the work queue (`CLAUDE.md`).

## Coverage convergence and guest-frame metrics (K21)

The default now automatically merges successful probe/port-test coverage into owner/interior selection.
`pipeline.selection: "all"` / `--selection all` is explicit; strict slices remain supplied-evidence-only.
Standard metrics and probe summaries distinguish **updates/s from guest presents/s**, report guest interval
avg/p95, and expose exclusive sampled interpreter ms/share, instructions/update and top owners.
**Updates are not guest frames.** Contracts, limits and reproduction: [coverage convergence](coverage-convergence.md).

## Execution profiling (K10)

Profiling is engine-independent, additive metrics JSON, not a new import/command ABI. Both browser backends
and the headless/port-test hosts expose it. Build and probe normally; a port test reads
`(await diagnostics(page)).metrics`. Coverage snapshots retain `metrics.execution` and runtime I/O/GPU timing.

- `guest_instruction_clock` is the **raw active CPU context's `X.tsc`** (AMD64); it is included in probes and bench
  runtime output. It is not yet a process-total retired-instruction counter: cooperative context restore can
  change it, a pre-execution quantum attempt advances it, and i386 currently leaves it zero. Do not derive exact
  threaded instructions/s from it. Exact process retirement accounting is a separate code-model task.
- `cpu_profile.categories`: lifted-native dispatch, generic/shared semantics, interpreter. Each has `calls`,
  `samples`, `sample_us`, `estimated_us`. Timers sample about 1/1024 calls with jitter to avoid regular-loop aliasing;
  totals extrapolate sample mean × calls. Small sample counts are noisy; these are not CPU hardware counters.
  AMD64 register-local regions/native steps cannot suspend. K13's outer AMD64 native wrapper dispatch,
  like i386 dispatch and generic/interpreter calls, may include API/thunk work and nested guest callbacks;
  frame-wait idle time is subtracted. These are **inclusive attribution**, not mutually exclusive partitions. Decode/dispatch overhead
  outside timed calls remains in `host_profile.updateMs`, not silently assigned to native code.
- `cpu_profile.apis`: every hit import slot's DLL/name, exact count, sampled microseconds and extrapolated total.
  The metrics JSON observation ceiling is 8 MiB (debug JSON adds 64 KiB for views), tested with all 4096 maximum-length
  printable import names. Names are escaped. Pathological control-byte names exceeding that bound return valid
  `metrics_serialization_overflow:1` JSON, never silently malformed/truncated metrics or invented API totals.
  API time includes nested guest callbacks, excludes time parked across frame yields, and overlaps category totals.
  API sampling is first/every 1024th call; use CDP to check periodic-work bias. `idle_yield_us` is observed wall time
  parked at frame waits (including probe think time), **not** virtual guest Sleep duration or CPU consumption.
- `cpu_profile.exits`: top 32 retained `(address,reason)` pairs by exact exit count, with generic instruction counts.
  Reasons: **1** opcode form; **2** failed whole-block memory guard; **3** quantum crossing; **4** interior landing;
  **5** indirect dispatcher exit; **6** other dispatcher exit. Native calls/returns are not generic exits.
  `interpreter_entries` lists the top 32 entry addresses by interpreted instructions; counts denote attempted block
  entries (an entry interrupted before execution can have zero instructions). The 262,144-slot, 16-probe bounded
  census never evicts; `census_dropped` counts rejected events. Nonzero means the retained top-N is incomplete,
  not a trustworthy global ranking. Existing execution and coverage counters remain independent/exact.
- `host_profile`: cumulative update/render wall ms, awaited range-I/O ms, sampled BGT imports by name (1/1024).
  Hot coverage/time imports are counted but not individually timed. `runtime_profile` adds cumulative backend
  `gpuSubmitMs` (JS encode/submit) and `gpuDrawWallMs` (including requested readback/waits), **not GPU timestamps**.
  Its VFS `readMs` includes awaited fetches; `fetchMs` includes response consumption/integrity. Concurrent totals
  overlap and must not be summed. `decompressMs:null` is deliberate: browser HTTP decompression cannot be timed
  separately from fetch; guest decompression remains in CPU categories/CDP. No guessed zero is reported.

```sh
# Optional named wasm for guest-address mapping in Chromium's CPU profile (larger private output):
BGT_PROFILE_NAMES=1 npm run build:port
npm run probe -- --game mygame --script ./explore.mjs --cpu-profile 1100:1700 --out reports/probe/perf
```

`--cpu-profile START:END` brackets **update frame boundaries**, splitting `p.step`, `p.click` and `p.key` as needed.
It saves DevTools-compatible `cpu.cpuprofile` and `cpu-mapping.json`. Names `F_<guest>` / `N_<guest>` /
`R_<guest>_<region>` map
back to addresses; unnamed wasm nodes explicitly remain unmapped (build with `BGT_PROFILE_NAMES=1`). Use the `p.*`
stepping helpers: direct `p.page.evaluate(step)` and resource-tour internals bypass the range interceptor. Reports
record actual start/end and whether the requested end was reached; failures save partial profiles when possible.
CDP uses a 1ms sampling interval and is opt-in, not part of the always-on timing overhead claim.
At its start frame, the probe snapshots historical census diagnostics then resets the census via the optional
profiling export. Thus a later hot window is not starved by startup addresses. The report records whether reset was
available. For multiple shorter windows in a probe/port test, call `await p.profileWindow()` (returns the completed
window's metrics and resets), or test API `profileReset()`. Save each window separately; do not subtract top-N tables
across generations. Counts inside retained rows are exact; any nonzero per-window drop count still invalidates a
complete-ranking claim. Generation-tagged buckets exclude completions from an older suspended window; core execution
and coverage counters are not reset or artificially incremented.

Named profiling no longer passes **`-g` through Binaryen**. The build captures `--print-function-map` after all
optimization/Asyncify passes, caches the final index/name sidecar with its wasm, then appends only the standard
function-name subsection in a lightweight byte pass. No local-variable/DWARF metadata is emitted by wasm-opt.
`profile-map.json` is also saved next to the wasm; function indices are post-transform, not an incorrect linker-index
mapping. Cache publication, missing-sidecar rebuild, lease accounting and pruning include the sidecar. A 1.6M-insn,
39 MiB named scale build completed with 13,900 final mapped functions and only 186,370 name-section bytes; the named
browser smoke mapped 35 nodes with zero unmapped wasm nodes. This does not claim a successful 138 MiB target build.

Every probe records `resources.start/end`: load averages, CPU model/count, free/total RAM, swap used, heavy-gate
occupied slots/queued tickets and top CPU processes. Unsupported/sandbox-denied observations are `null` with an
error, not fabricated availability. The snapshot reads existing gate locks without changing queue ownership.
Both legacy harness lockf and current kit flock gates are recognized; non-atomic snapshots are advisory.

`BGT_CPU_PROFILE=0` disables C census/timing for A/B measurement, not execution/coverage counters. The committed
[`k10-profile-overhead.json`](../tools/bench/k10-profile-overhead.json) records same-machine/toolchain resources and
samples: 300-update median overhead **8.3% x64-crt / 3.6% x64-cpp** in short startup workloads. JS timing remains on
in both variants; this isolates the C instrumentation, not total instrumentation cost. These millisecond fixtures
are noisy, not a bound for an engine workload. `tools/bench/codegen.test.ts` now records resources alongside runtime
metrics; rebuild before changing variants and do not measure while another task republishes the same fixture.

### Buffered coverage and Asyncify boundaries

Discovery generated hooks now de-duplicate `(address,kind)` in a **wasm-local 65,536-slot direct-mapped cache**,
with a bounded 4096-record queue. Only newly observed kind bits cross into JS at pressure, frame waits, normal update
return, metrics reads and explicit profile faults. Collisions may re-report records but cannot discard evidence.
`coverage_events`, `coverage_cache_hits`, `coverage_crossings` expose the reduction; the host still owns the independent
1,048,576-entry/drop limit. A snapshot flushes **before** copying code and drop counts. Abrupt external wasm traps
can leave an unflushed tail: errored recordings are not packaging evidence. `BGT_COVERAGE_DIRECT=1` restores direct
crossings for A/B tests without changing instruction/API semantics.

Strict builds omit recording/crossings but retain wasm-local membership checks at registry entries and internally
handled dynamic entries (including same-region indirect jumps). This is necessary when a host policy is narrower
than an entire compiled function range; a registry-only check would be insufficient. An optional [strict host-policy export](../bgt/abi/ABI.md#strict-compiled-slice-host-policy-k10-additive-optional-export)
intersects a stricter host allowlist with the compiled policy, including the existing empty-allowlist stop. Neither
strict path imports `coverage_entry` or keeps per-entry successful-path recording. A single actually accepted
startup entry is exposed through the optional first-entry export, preserving bounded startup evidence; outside-slice
failures retain their missing-code address. The existing two-recording discovery → re-lift regression still converges to zero interpreted instructions
and passes the strict package/reference runs; no coverage evidence is filtered or manufactured.

AMD64 generated register-local regions and `N_<addr>` native steps return before generic semantics, quantum
scheduling, API thunks or guest callbacks. K13's `F_<addr>` wrappers drive flat cross-owner chaining and **may
suspend** through imported APIs; they remain instrumented alongside the dispatcher. Build postprocessing excludes
only **exact generated `N_<addr>` step definitions**, intersected with linked names, not wrappers, handwritten symbols
or an unsafe `--asyncify-ignore-indirect`. Region signatures already separate them from suspendable call targets. `BGT_ASYNCIFY_FULL=1` retains conservative
analysis for A/B. i386, dispatcher, shared semantics, scheduler, callbacks and handwritten overrides stay instrumented.
A synthetic normally lifted Win64 override really yields twice; the regression verifies it resumes and returns the
known answer. It also exposed/fixes the pre-existing AMD64 `--skip` duplicate-symbol bug (overrides have an exact-entry
registry record, never a duplicate native body or an invented interior range).

An entirely overridden selection has no native steps and therefore uses an empty exclusion list. An all-inlined
step set may also have no surviving linked names; neither case broadens exclusions to suspending wrappers.
For very large symbol lists, the command-line ceiling is bounded: above 180,000 list bytes the build keeps the
conservative analysis rather than an incomplete exclusion. `manifest.pipeline.metrics` records `asyncify_mode`,
`asyncify_remove_count`, list SHA-256, `pre_asyncify_bytes`, elapsed time and cache state. Named linked wasm is read
without instantiating/compiling it in JS; only standard function-name metadata is parsed. Toolchain libc DWARF is
stripped before postprocessing, retaining names for sound exact selection but not shipping private debug paths.

```sh
npm run bench:execution                  # sequential direct/full, buffered/full, buffered/restricted, interpreter
npm run bench:asyncify -- reports/asyncify.json   # same linked input, uncached postprocess + state-reference audit
```

Both save resource snapshots. `bench:execution` includes CRT, C++, the 1.6M-instruction/chunk scale fixture and an
original CC0 dispatch-heavy workload (4,194,304 indirect calls, independent numeric checksum), 300 updates per run,
five fresh instances plus discarded warmup. Native `bgt.yield` reachability must not be inferred from a function's
name alone: exclusions come from generated definitions, and the exact-list override regression guards this boundary.

## Pixel reads: CPU replay of the recorded GDI ops
GDI draws on GPU render targets and nothing is read back from the GPU. When a module imports a pixel-read API
(`GetPixel`, `GetDIBits`, or obtains one through `GetProcAddress`), the profile also logs every op it records per
texture (fills and sprites with blend mode and tint, uploads, target creation/deletion) on top of a CPU base image.
A read replays, on demand and for the queried pixel only, the ops that cover it, with the renderers' blend arithmetic;
blit sources are resolved at the time of the blit. The log is applied to the base images when it fills (or when a
texture with logged ops is deleted/overwritten) and before large region reads; a small cache serves repeated reads.
`tests/e2e/win32-conformance.spec.ts` checks that the replayed values equal the GPU's pixels for every op kind on
both backends.

## Exceptions (`<game>/overrides/*.c`)
```c
#include "x86_lift.h"
/* why: <the analysis/oracle evidence that the lifted function cannot be used> */
X86_OVERRIDE(0040123a) {
    /* behaviour on the guest state X; must pop the return address into X.eip like `ret` */
    X.r[EAX] = 0;
    X.eip = x86_pop();
}
```
The lifter skips these addresses. The build counts them, along with their lines of code.

## AMD64 execution (Task 1)

PE32+ `x86-64` modules now take the **same systematic pipeline**, selected by PE machine type, never by engine/game.
`npm run analyze -- FILE` decodes AMD64; `--disasm` prints the rebased listing. `--metadata` still prints bounded-read
full-width PE/import/.pdata/.xdata facts without lifting. `pipeline.fixture.target: "x86_64-windows-gnu"` builds fixtures
with installed Zig; `cpp:true,crt:true` links the compiler's MinGW-target C++ runtime and CRT normally. No original
Windows executable is run natively. Fixtures are original CC0 source. `SPEC.md` and the BGT ABI are unchanged by Task 1.

### Decoder, semantics, interpreter and lifter

`x86_decode_mode` shares one encoding decoder with i386: REX/16 GPRs, high-byte versus REX byte registers, operand sizes
1/2/4/8, address sizes 32/64, signed displacement, RIP-relative and GS addressing. `x86_sem64.h`, `x86_exec64.c` and
`x86_simd.c` implement scalar integer/SSE/SSE2 semantics, including arithmetic/comparisons/conversions/logic/shuffles/
unpacks, MOVD/Q/APS/UPS/SS/SD, CMOV/SET, BT/BSF/BSR, sign/zero extension, multiply forms, REX.W strings and single-thread
LOCK operations (including CMPXCHG8B/16B). CPUID advertises implemented baseline paths only: no AVX/XSAVE/AES/BMI/CX16
feature dispatch. RDTSC is a deterministic instruction clock, not wall time. K3 now supplies shared software ext80
basic arithmetic/storage/control and bounded transcendental semantics for both widths. Exact basic arithmetic is
not a claim of exact ext80 transcendentals or general Windows FP SEH: see [X87.md](../platforms/x86/X87.md).

The correctness-first AMD64 lifter emits **predecoded instructions in labelled C basic blocks**, with an entry switch
for each instruction address (including compiler landing pads). It calls the shared semantic core; that increments
`generic_insn_execs`, **not** `interp_insns`. No decoding or guest instruction-fetch loop is embedded in lifted functions.
Calls, returns and indirect edges use the lifted registry; interpretation is separately counted when no lifted entry
exists. `.pdata` supplies function ranges, augmented by entry/exports/direct calls/DIR64 pointers/RIP LEA seeds, so
jump tables and exception landing pads inside each range stay fully lifted. Indirect jump targets not statically
resolved are reported as unresolved; this does not mean interpretation if the target remains in a lifted range.
The four fixtures assert zero interpreted instructions through startup and the 300-frame run.

### Guarded direct imports (K29, final gates blocked)

AMD64 IAT memory calls and tail veneers are read normally; conservative MOV/copy CFG provenance
also identifies registers loaded from IAT slots. This is a hint, never constant folding guest memory.
Every hinted operand is compared at full width with the loader-bound profile thunk target. Patched
slots/changed register values retain ordinary dynamic dispatch; an old loaded register still calls
its old value after a subsequent IAT patch. Guest exports and imported data are not profile leaves.

Only explicitly typed, audited non-suspending CRT/thread bindings execute inside the generated
call site, with all GPRs/flags/clocks spilled and reloaded. The existing checked implementation and
Win64 register/home-space/stack, trace and per-thread LastError contracts are retained. Contexts
with callbacks, pending transfers/waits/yields or deferred results refuse the leaf path without
consuming work. Other bound imports return from the native step before the outer driver invokes
them; callbacks, suspension and explicit SEH/unwind never acquire a native register-local frame.
The leaf allowlist is explicit, not inferred from a function name at the lifter.

`direct_import_calls` counts accepted guarded leaf plus bound outer-driver calls; `leaf_import_calls`
is its call-site subset. `thunk_dispatches` counts dynamic driver/interpreter thunk entries, not
guarded bound calls. API counts/traces remain shared. Zero interpreted instructions alone says
nothing about these boundaries; compare reason-5 exits as well. Memory faults still abort via
`x86_fault`/`bgt_abort`; this change does not add access-violation SEH delivery. The shared length/
comparison CRT primitives now retain full Win64 pointers and bounds until checked reads.
Final gates retain both-backend/both-suspension browser passes and all34×2×300 identical pipeline
oracles, but four unchanged SSE-matrix unit timeouts persist on individual serial reruns; full
Tier1 and independent acceptance remain open. See [K29 handoff](handoff/K29.md) and
[gate evidence](handoff/K29-gates.json) for actual validation status and
[benchmark method](../tools/bench/README-imports.md) for per-import census/timing.

### Loader and shared Win32 profile

AMD64 guest registers/pointers are u64. Images are **relocated below 4 GiB** (first at 0x01000000) using DIR64; import
slots are eight bytes, ordinal bits are decoded at bit 63. The checked flat window defaults to **1024 MiB** and is
configurable through **2048 MiB**, with image slots 16–64 MiB, heap starting at 64 MiB, and low stack/TEB/PEB/thunk
regions. An access above the mapped window is an explicit fault, never silent pointer truncation. Mapping remains
flat guest-offset + host arena base, but wasm memory grows only through requested mapped ranges. The existing i386
paged model is retained unchanged. This bounded window is a configuration limit, not an arbitrary 64-bit VA model.
Mixed i386/AMD64 modules in one process are refused.

Only headers/virtual section bytes enter the eager loader asset. AMD64 defaults to `streamModules:true`, keeping
large raw sections/overlays in the original streamed self-open view. The runtime loader reads header and section ranges,
not a whole source image. Thunks use RCX/RDX/R8/R9, the home area and stack arguments; callbacks obey Win64 alignment,
shadow space and nonvolatile restoration. USER handles occupy low-address numeric slots, stored as pointer-sized values
in Windows structures. WNDCLASS(EX), CREATESTRUCT, MSG, PAINTSTRUCT, window-long-pointer storage, message parameters/
callback returns, varargs homes and registry handle outputs have AMD64 layouts. The shared GDI/USER implementation
serves both architectures; x64-gui checks full-width sentinel userdata/message values plus real pointer/key input.

GS points at the AMD64 TEB; TEB+0x58 contains the static TLS vector, +0x60 the PEB. `.tls` template/zero-fill/index and
process-attach callbacks initialize before entry/CRT startup. Dynamic TLS values retain all 64 bits (single thread).
CRT startup is **compiled guest code**: argument/environment cells, init arrays, allocation and needed system bridges
are profile APIs. The C++ startup constructor is asserted, not skipped. Single-thread locks used by the compiler runtime
are modeled without fabricating additional threads.

### Structured unwinding and nonlocal transfer

`w32_x64.c` implements RtlLookupFunctionEntry and RtlVirtualUnwind against runtime .pdata/.xdata: AMD64 CONTEXT layouts,
nonvolatile pushes/saves, small/large stack allocations, frame-register setup, XMM saves, chained records, prolog offsets
and ordinary epilog recovery. RaiseException walks handlers with EXCEPTION_RECORD/DISPATCHER_CONTEXT; RtlUnwindEx runs
cleanup/target phases and installs the selected landing-pad context. Compiled `__gxx_personality_seh0` and its linked
libunwind/libc++abi code execute unchanged: there is **no profile replacement of throw/catch or destructor logic**.
setjmp/longjmp save/restore the Windows x64 nonvolatile GPR/XMM/stack/IP state and zero→one return rule. A nonlocal
transfer propagates out of lifted C frames to the top guest driver, then resumes at a predecoded landing pad, avoiding
host stack corruption. Synthetic unwind-contract tests complement the differential oracle (shared semantics cannot
validate itself).

### Reproduce Task 1

```sh
npm run build:examples
npm run oracle -- examples/x64-basics 300
npm run oracle -- examples/x64-cpp 300
npm run oracle -- examples/x64-tls 300
npm run oracle -- examples/x64-gui 300
npm test                      # includes those 300-frame oracles + semantic encoding tests
npm run test:e2e              # all four on WebGL 2 and WebGPU
```

Known results: basics integer/vector/varargs/LOCK PASS; cpp caught=38, destructors=3, order=321 (vtables and static
constructor included); tls callbacks=1, jump=23, static/dynamic TLS plus independent unwind records PASS; gui window
PASS, click/key move the green box. `manifest.pipeline` records instructions/functions/build_ms/wasm bytes per insn.
Byte/insn includes the profile and Asyncify: tiny fixtures have high fixed overhead; not a scale improvement claim.

Real-world limits beyond this Task 1 finish line include AVX/newer extensions, unrestricted Windows FP exception
handling, dynamic function table registration, MSVC C++ personality formats, arbitrary collided/foreign exception
cases, all CRT/Win32 APIs, and precise MXCSR FP traps/FTZ/DAZ or nondefault SSE arithmetic rounding.
Later lanes add [bounded cooperative threads](../platforms/win32/THREADS.md), a configurable 1–2 GiB flat window
and [bounded x87](../platforms/x86/X87.md); those are not universal compatibility. Integer conversions honor
MXCSR rounding. Unknown instructions/APIs fault explicitly; do not work around them with game-specific overrides.

## Suspension builds and selection

See [suspension policy](suspension.md) for bounded Asyncify on large linked modules, the Binaryen wasm32
4 GiB IR limit, dual/JSPI-only builds and per-game `"suspension": "jspi-preferred"` opt-in with verified
Asyncify fallback. The global default remains Asyncify; JSPI-only builds do not run wasm-opt.

## v0.3 development: build scale

Pipeline compilation is parallel and incremental per translation unit (including lifted modules), with a content
cache under `node_modules/.cache/bgt/objects`. `BGT_BUILD_JOBS` defaults to 2, capped at 8. Each object uses its
actual compiler-derived transitive dependencies, not every platform header. Source/dependency bytes and compiler
identity/flags invalidate exactly affected objects; clone-relative paths allow opt-in shared payloads through
`BGT_SHARED_CACHE`. See [build-cache.md](build-cache.md) for concurrency, LRU bounds, privacy, focused-test declarations
and the linked-module Asyncify boundary (bounded body partitions for large modules, not relocatable object transforms). Linking still runs each build; Asyncify output is content-cached by linked wasm/tool/wrapper/feature/pass identity, with
atomic cache publication. `asyncify_cached` records a hit. This avoids spending the test timeout rebuilding an identical
postprocessed module; no existing test timeouts or assertions were relaxed. Conservative flag-liveness is
available through `pipeline.flagLiveness: true`; calls/branches/unknown instructions are barriers. Lane K11 adds
four opt-in AMD64 lifted-code policies, all defaulting to the size-oriented behavior: `liftInlineMemory`,
`liftInlineAlu`, `liftAffineCounting`, and `liftOptimizeSmall`. `pipeline.liftPreset: "fast"` enables all four;
`"size"` (the default when omitted) disables them. These are codegen policies, not game-specific behavior, and
are part of the lift cache key. `liftInlineMemory` uses an inline same-page mapped/unprotected check with a cold
full check; `liftInlineAlu` uses specialized live-flag helpers and cold recoverable fault recipes; `liftAffineCounting`
settles the instruction debt at control/observation boundaries; `liftOptimizeSmall` drops `minsize` only for tiny
regions. On one shared macOS arm64 machine, sequential cumulative A/B measurements were:

| Stage (cumulative) | x64-crt wasm B / ms | x64-cpp wasm B / ms | CC0 33k-insn CPU wasm B / ms |
|---|---:|---:|---:|
| Baseline | 1,259,211 / 2.685 | 2,669,278 / 3.384 | 1,378,260 / 5.456 |
| + `liftInlineMemory` | 1,272,469 / 2.664 | 2,896,989 / 3.385 | 1,378,408 / 5.354 |
| + `liftInlineAlu` | 1,320,637 / 2.751 | 3,178,418 / 3.424 | 1,381,127 / 5.290 |
| + `liftOptimizeSmall` | 1,312,317 / 2.760 | 3,179,222 / 4.079 | 1,381,127 / 5.470 |
| + `liftAffineCounting` | 1,330,365 / 2.717 | 3,282,489 / 3.318 | 1,390,993 / 5.383 |

Timings fluctuate under shared-machine load, so no universal speedup is claimed. The 1024-round / 36,709,146-dispatch CPU workload measured
97.997→95.594 ms (baseline→all on); final opt-in policy reruns measured 95.347 ms (`size`) versus 95.659 ms (`fast`).
Full per-stage samples, repeat runs, resource snapshots, hashes and the final policy comparison are committed in
[`handoff/K11-measurements.json`](handoff/K11-measurements.json); compact interpretation is in
[`handoff/K11-benchmarks.json`](handoff/K11-benchmarks.json). These results justify **opt-in**, not faster defaults.
Every option has both-mode snapshot/oracle coverage in the codegen and lift-policy benchmarks. Lane F adds
register-local AMD64 emission and guarded spans; non-default protection disables unchecked block spans before
local mutation. LSC adds bounded chunk/cache/writer lifetimes and verified streaming loads; measured 1.6M synthetic
instruction results and 7.1M extrapolation caveats are in [the scale handoff](handoff/scale.md), not a real-game claim.
`node tools/bench/lift-scale.mjs 1024` writes `reports/scale.json` from an
original generated CC0 fixture. K11's `tools/bench/codegen.test.ts` accepts `BGT_CODEGEN_PRESET=size|fast`,
`BGT_CODEGEN_ROUNDS`, and `BGT_CODEGEN_TRIALS`; its committed reports record resource snapshots, exact oracle
hashes, ALU materialization fractions, and known-count dispatch throughput. The measured fixtures are engineering
A/B evidence only: they do not project the 7.1M-instruction target, whose observed hot phase is dominated by
engine/build-specific lifted-call/API behavior rather than the synthetic per-instruction loop. See [v03-status.md](v03-status.md) for measured sizes (including the flag-liveness
regression) and outstanding scale/GL/threading work.

Build `manifest.pipeline.metrics`: `wasm_bytes_per_insn` = **whole wasm size** / lifted instructions, not marginal
cost; interpret-only = null. For marginal cost subtract an otherwise identical interpreter-only build first.
`build_ms` includes fixture build/lifting/compiler/asyncify/assets; `duration_ms` is compile/link wall time;
`peak_child_rss_bytes` is the largest compiler/linker child (NOT total parallel memory or wasm-opt), plus cache counts
and job count. The current pipeline does not load code chunks lazily.

## v0.3 streaming files (implemented)

`pipeline.streamModules: true` creates compact eager loader images (virtual bytes only) plus a streamed original-file
view for CreateFile(GetModuleFileName()). Shipped data can use `streams:[{from:"./data",path:"data",chunkSize:262144}]`.
Build preparation reads bounded chunks, not entire files. The manifest's `streams` records size/chunk URLs/hashes;
the runtime only fetches requested ranges and keeps a 16 MiB LRU. Large overlays never enter the eager loader VFS.
See ABI.md §12 for asset_size64, asset_range_request and request result lifetimes. Tests/oracle await pending I/O
before advancing virtual time. Win32 support is read-only CreateFile/ReadFile/size/seek/close, including self-open;
Win64 CRT FILE APIs now share the profile's asynchronous range machinery (Task 2a below). Threads/audio/COM/expanded
input/GL remain separate gaps.

## Recording and packaging a vertical slice (v0.3 subset)

During a probe, `reports/probe/coverage.json` records executed lifted/interpreted function, block and continuation
entries, module hashes/bases and file chunks read. It is **not an instruction-address trace**. AMD64 lifted region
resumption records its actual continuation address, not a falsely repeated function start. The host deduplicates
addresses, merging lifted/interpreted kind bits, with a **1,048,576 distinct-address safety limit** per loaded runtime
(16× the former 65,536). `metrics.code_entries_dropped` counts rejected entry events; any nonzero value still rejects
both coverage-guided and strict builds. Never strip it or manufacture a smaller trace. Runtime owner accounting uses
one byte per analyzed function, plus sorted disjoint range metadata; it does not retain an instruction-address set. Browser tests using the shared fixture save `reports/coverage/<project>/*.json`; each also attaches the
snapshot. The read-only test API has `coverage()`. A snapshot is specific to exact binaries AND load bases; mismatches
fail the build. Preserve a successful launcher's entire L3 loop, not just a boot screenshot.

- Coverage-guided lifting without packaging: `pipeline.coverage: ["../reports/probe/coverage.json"]` selects the
  **owning functions** of recorded entries plus their static call closure. Analyzer JSON exposes half-open `addr..end`
  ranges and `unwindRange`; AMD64 `.pdata` ownership takes precedence over speculative interior seeds. Otherwise the
  nearest enclosing analyzed start owns an address; gaps are not attributed to the preceding function. Unselected code
  remains interpreted and recorded for the next build.
- Explicit/archived incremental discovery (the default inbox also accumulates successful probe/port-test runs): record a workload, build with that recording, reload/run the same workload (and extend it),
  save the new recording to a **different file**, then build with **all prior and new files** in `pipeline.coverage`.
  Addresses and ranges are unioned only when module names/hashes/bases agree. Each reload starts a bounded fresh
  recording; cross-reload union comes from explicit recordings and the documented private per-game inbox. Overflowed evidence is rejected even if other
  inputs would cover the same addresses. Use a shorter representative run to bootstrap a minimal selection, not an
  edited/filtered overflowed trace.
- After **each run**, report remaining `interp_insns`, `interp_code_entries`, `interp_functions` and
  `interp_unowned_entries` for the same workload. Probe/browser snapshots retain these in `metrics.execution`;
  builds preserve per-input observations in `manifest.pipeline.discovery.input_recordings` and print the input
  interpreted-instruction counts (unknown for old snapshots), **not a prediction of post-build execution**.
  Repeat recording after building to measure the actual improvement. Synthetic CC0 regression: a 70,000-NOP body
  with indirect function/interior entries converges in two selective builds, with exact counter assertions.
- Strict package: `npm run build:port -- --slice reports/probe/coverage.json` (CLI paths resolve from the repository root), or `game.json` `slice:{coverage:["../reports/...json"]}` (config paths resolve from port/). CLI accepts comma-separated
  or multiple files after --slice (last option). Modules use the compact loader/streamed original view automatically.
  Only covered file chunks are emitted. Uncovered callbacks and data ranges pause visibly, with
  `diagnostics().outsideSlice` / accessible status text and a coverage record. They do not trap, 404 or load full files.
  Reload a broader package; an interrupted guest C stack is not resumable in-place.

Build `packaging`: raw/gzip payload bytes (sum of separately gzipped files, excludes manifest), wasm bytes, emitted
unique chunk bytes. `manifest.slice` also records original/included logical chunk bytes. The runtime coverage snapshot
has `load_to_first_frame_ms`, `frame_ms_avg/p95` (render-completion wall time, at most 10k recent samples),
`frames_measured`, error/outside-slice events. These are NOT GPU timestamp queries or vsync intervals. Tests/probes may
call an extra render; label the workload and backend. Long-run stability is evidence only when a long script ran.
Copy the final snapshot to `reports/slice-runtime.json` before `trial:record`; game/schema identity is checked, and
metrics are copied to trial.json along with manifest packaging/pipeline metrics. Missing evidence is null, not zero.

Current limitation: conservative virtual PE section bytes are retained, not the mathematically minimum loader data.
Code remains a single wasm module, no lazy code chunks (LSC's compile-time translation-unit chunks are not lazy
runtime modules). Bounded GL and cooperative threads are implemented; the 1.6M synthetic scale fixture does not
certify a 7.1M game. Selection/strict code packaging is **function-range granular**: valid interior continuations are
allowed within a selected analyzed owning range. Recording block entries is not instruction-level packaging or a
proof against unrecorded paths within that function. Unknown/unowned code still interprets in a discovery build and
stops outside a strict slice; it may need analyzer improvements before convergence. File-range slice stops remain
unchanged. The finite coverage limit is a safety net, not a guarantee for arbitrary workloads.

## Known execution limits (kit gaps, not port work)
- **x86:** i386 and baseline AMD64 modes; SSE/SSE2 semantics are currently enabled for AMD64 profile builds.
  Shared x87 follows the explicit [precision/exception model](../platforms/x86/X87.md); no AVX or self-modifying code.
  Flat AMD64 memory defaults to 1 GiB, configurable to 2 GiB; images remain 16–64 MiB.
- **Profiles:** Win32 only; DOS/consoles need new profiles.
- **GDI:** pixel reads come from CPU replay (exact for every recorded op; a surface drawn before replay was enabled,
  e.g. when `GetPixel` is only found through `GetProcAddress` late, is unknown until overdrawn). Window DC visible
  regions subtract visible children for WS_CLIPCHILDREN and higher siblings for WS_CLIPSIBLINGS (disjoint rectangles,
  up to 1024); explicit GDI region objects remain rect-only.
  Bitwise raster ops beyond the mapped set are approximated (counted). No copying within one surface. Drawing into a
  DIB section does not update its guest bits. `GetDIBits` writes 24/32-bpp `BI_RGB` only.
- **Win32:** bounded cooperative threads/COM and process-local writable CRT files are implemented; not general
  host threading/COM marshaling or persistent kernel filesystem writes. MENUEX templates remain unsupported.
  Existing-DLL failure-only and unavailable contracts: [CONTRACTS.md](../platforms/win32/CONTRACTS.md).


## Task 2a — shared Win64 CRT and demand-grown memory

`platforms/win32/crt.def` is the common runtime registry for **msvcrt.dll, ucrtbase.dll and every supported
api-ms-win-crt-* API set**. The Win64 dispatcher checks it before legacy profile entries. Aliases select the same
implementation, not a per-DLL workaround. Integer/pointer arguments, XMM arguments/results, 8-byte Windows va_list
slots, LLP64 long, UTF-16 and FILE tokens are adapted explicitly. Guest callback comparators/constructors/exit
handlers execute their lifted guest code. MinGW startup/STL/libc++/exception code is not replaced.

The table currently has **434 function names** (aliases counted), plus ten startup data names: stdio **78**, stdlib
**61**, string/wide/memory **49**, double/float math **113**, time **26**, locale/ctype/conversion **67**, startup
**40**. `npm run analyze -- FILE --imports-coverage` emits each full DLL!name with implemented/stub/unknown and group,
plus totals. Runtime and census use the same CRT table. Other Win32 entries are classified from profile registries;
unknown DLLs/names are not optimistically counted. Availability is not universal behavioral compatibility.

Numeric formatting/parsing, calendar routines and libm are linked from installed **Zig 0.13.0 WASI musl**, not custom
transcendental approximations. There are **no WASI browser imports**: only BGT imports are allowed and asserted by tests.
Host libc allocation stays within the bounded 64 MiB host arena, separate from guest malloc. Build outputs retain
`CRT-NOTICES.txt`; provenance/boundaries are in `platforms/win32/CRT-PROVENANCE.md`.

Math uses IEEE binary32/binary64 with nearest/default rounding; sqrt/elementary operations use the toolchain's normal
implementations. Tests compare raw result bits for 35 double/float operation pairs against the same source built with
host libc, allowing **4 ULP** (not a proof for every input/libm/domain). Group checksums must still match exactly.
Nondefault rounding/FTZ/traps, 80-bit long double, positional formats, unsupported secure printf/scanf families and
MSVC-specific C++ personalities remain gaps. Static unknown imports fault with untruncated DLL!symbol; dynamic unknown
lookup returns NULL.

FILE reads of shipped profile files use deferred range-request/yield machinery with a bounded **16 KiB default
read-ahead buffer** (configurable through Windows setvbuf/setbuf, maximum 64 KiB). A byte read from owned bytes
needs no new request/update. Refills stop at both the current 64 KiB boundary and actual stream chunk boundary,
so speculation cannot pull an adjacent omitted strict-slice chunk. Consumption, including physical CRLF input
bytes but excluding returned pushback bytes, drives `files` coverage; speculative ranges and byte/request counts
are recorded separately in `readAhead` and `crtReadAheadBytes`/`crtReadAheadRequests`. `crtConsumedBytes` counts
actual FILE source bytes delivered/read, not source chunk download bytes. Inspected non-LF bytes after CR are
recorded separately as `crtObservedBytes` and also retained in packaging coverage because translation depends on them. Chunk-level packaging is deliberately
coarser than byte counters. FILE positioning uses logical physical-byte cookies; raw descriptors expose the
underlying read-ahead cursor until fflush/position synchronizes them. Full contracts and bounds:
[CRT FILE contracts](../platforms/win32/CONTRACTS.md#crt-files-formatting-and-locks).
CRT-created writable and temporary files live in process memory only; shipped files remain read-only. Streams support
read/write/seek/position/pushback/EOF/error and formatted scanning; stdout/stderr log complete lines. The deterministic
process environment is empty, locale support is **C/ASCII**, and localtime is **UTC**, derived from the virtual clock.
Other locales fail, not silently select the host locale. These are explicit limits, not Windows locale/file parity.

Normal fixtures use `pipeline.fixture.crt:true`: **-O2**, standard CRT, `main`/`WinMain`, no `-nostdlib` or custom entry;
`cpp:true` selects C++. `fixture-build.json` and the pipeline report record that mode. `x64-crt` exercises over 60
actually imported/called CRT names across all groups (including atexit, qsort/bsearch callbacks and shared DLL aliases).
`x64-cpprt` runs vector/string/sort/map/iostream. Tests compile the **same original CC0 source** natively with cc/c++,
compare every group checksum, and run independent **300-frame lifted/interpreted oracles**. No Windows PE runs on host.

Configure guest memory in game.json:

```json
"pipeline": {
  "platform": "win32",
  "memory": { "guestWindowMiB": 2048, "hostArenaMiB": 64 },
  "modules": [{ "from": "./program.exe", "main": true }]
}
```

The guest-window integer range is 128..2048, default 1024; the manifest repeats `memory.guestWindowMiB`,
`growth:"on-demand"` and the configured `hostArenaMiB`. Guest malloc/heap is 16-byte aligned and returns NULL on
ordinary exhaustion/overflow.

For AMD64, `pipeline.memory.hostArenaMiB` is an integer in **16..512**, default **64 MiB**. It bounds host
allocations before the checked flat guest window, not guest malloc. Reserving address space does not eagerly
commit the whole reservation. Change it at build time; it cannot move underneath a running guest. The 64 MiB
default is retained from measured evidence: the original retained-frontends workload exhausted it at cycle 113;
after lifetime repair a stronger 768-cycle / 96-live-program workload plateaus near 18 MiB. Increase only for
measured legitimate live host demand, not to hide missing releases. This is not a mobile-RSS guarantee.

All host allocations use one address-ordered split/coalescing pool; freed GL source/frontend/buffer spans,
CRT libc allocations and CRT FILE buffers can be reused across consumers. Permanent runtime/index allocations
remain live for the instance (the wasm instance owns teardown). `host_bytes/host_peak/host_reserved/host_limit`
report charged live bytes / live high-water / backing retained for reuse / shared limit. `host_consumers` has
`runtime/gl/crt/file` entries with `used/peak/limit/allocations/frees/oom/backing_requested/shared_limit`. Headers and 16-byte
rounding are charged; these are allocator bytes, not RSS. Per-consumer limits are the **same shared limit**, not
independent quotas or guaranteed headroom; genuinely exhausted live demand can fail any consumer. On paged i386,
host and mapped guest pages share the pre-existing wasm32 address-space bound; the flat reservation option is AMD64-only.
Legacy `gl_frontend_*` metrics retain GL live/peak/count semantics; `gl_frontend_reserved` records cumulative
backing obtained on GL allocation requests (`gl.backing_requested`), not the total shared backing or a private
GL reservation. A consumer can borrow backing obtained by others, so its live peak can exceed its own backing
contribution. The sum of consumer backing contributions equals `host_reserved`. Every allocation failure emits a no-allocation diagnostic naming consumer,
requested size, consumer use, total use, backing and limit. CRT preserves ENOMEM/ferror, and compile/link retains
app-readable logs plus GL_OUT_OF_MEMORY. No wire ABI, renderer opcode or capability changes are involved.
Known GDI CPU/replay lifetime issues are separately handed off in [K16a](handoff/K16a.md); accounting those
legacy permanent allocations as runtime does not claim their missing frees are repaired.

K12 uses deterministic bounded-work segregated free lists, eager boundary-tag coalescing and separate logical
heap ownership/quotas; requested sizes survive size-class rounding. HEAP_GENERATE_EXCEPTIONS failure uses
existing AMD64 SEH or an explicit unavailable-continuation diagnostic. The native performance benchmark is
not a game/browser timing claim. Exact flag, CRT family and reservation/accounting limits:
[guest heap contracts](../platforms/win32/CONTRACTS.md#guest-heaps-and-crt-allocation-k12). Mapping grows wasm
memory only on demand, not by allocating/zeroing the full window. Gaps are inaccessible even below the high-water mark.
`heap_bytes` is the guest heap high-water extent; `guest_committed_bytes` is the highest mapped guest end (not resident
RSS). `x64-memory` writes **all 629145600 bytes**, verifies **153600 pages** and patterns, then maps/writes/reads the
2 GiB window's upper edge. Host wasm memory can consequently exceed 2 GiB; mobile physical memory limits still apply.

AMD64 execution now cooperatively yields after a deterministic two-million-instruction quantum instead of aborting
CPU-heavy legitimate programs. Both oracle modes use the same quantum and virtual clock; this is not multithreading.
Leaf tail-call helpers and callbacks referenced from leaf functions are also discovered without requiring .pdata.
