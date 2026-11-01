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

## v0.3 development: build scale

Pipeline compilation is parallel and incremental per translation unit (including lifted modules), with a content
cache under `node_modules/.cache/bgt/objects`. `BGT_BUILD_JOBS` defaults to 2, capped at 8. Sources, headers, compiler
version/flags and paths invalidate the cache. Linking still runs each build; Asyncify output is now content-cached by linked wasm/tool/feature/pass identity, with
atomic cache publication. `asyncify_cached` records a hit. This avoids spending the test timeout rebuilding an identical
postprocessed module; no existing test timeouts or assertions were relaxed. Conservative flag-liveness is
available through `pipeline.flagLiveness: true`; calls/branches/unknown instructions are barriers. Lane F adds
register-local AMD64 emission and guarded spans; non-default protection disables unchecked block spans before
local mutation. LSC adds bounded chunk/cache/writer lifetimes and verified streaming loads; measured 1.6M synthetic
instruction results and 7.1M extrapolation caveats are in [the scale handoff](handoff/scale.md), not a real-game claim.
`node tools/bench/lift-scale.mjs 1024` writes `reports/scale.json` from an
original generated CC0 fixture. See [v03-status.md](v03-status.md) for measured sizes (including the flag-liveness
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
- Incremental discovery: record a workload, build with that recording, reload/run the same workload (and extend it),
  save the new recording to a **different file**, then build with **all prior and new files** in `pipeline.coverage`.
  Addresses and ranges are unioned only when module names/hashes/bases agree. Each reload starts a bounded fresh
  recording; there is no hidden cross-module or cross-reload union. Overflowed evidence is rejected even if other
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

The table currently has **396 function names** (aliases counted), plus ten startup data names: stdio **56**, stdlib
**53**, string/wide/memory **45**, double/float math **113**, time **25**, locale/ctype/conversion **67**, startup
**37**. `npm run analyze -- FILE --imports-coverage` emits each full DLL!name with implemented/stub/unknown and group,
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
  "memory": { "guestWindowMiB": 2048 },
  "modules": [{ "from": "./program.exe", "main": true }]
}
```

The integer range is 128..2048, default 1024; the manifest repeats `memory.guestWindowMiB`, `growth:"on-demand"` and
`hostArenaMiB:64`. Guest malloc/heap is 16-byte aligned and returns NULL on exhaustion/overflow. Mapping grows wasm
memory only on demand, not by allocating/zeroing the full window. Gaps are inaccessible even below the high-water mark.
`heap_bytes` is the guest heap high-water extent; `guest_committed_bytes` is the highest mapped guest end (not resident
RSS). `x64-memory` writes **all 629145600 bytes**, verifies **153600 pages** and patterns, then maps/writes/reads the
2 GiB window's upper edge. Host wasm memory can consequently exceed 2 GiB; mobile physical memory limits still apply.

AMD64 execution now cooperatively yields after a deterministic two-million-instruction quantum instead of aborting
CPU-heavy legitimate programs. Both oracle modes use the same quantum and virtual clock; this is not multithreading.
Leaf tail-call helpers and callbacks referenced from leaf functions are also discovered without requiring .pdata.
