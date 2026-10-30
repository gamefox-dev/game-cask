# The conversion pipeline (kit v0.2)

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
  - `interp_code_entries`: entries into non-lifted guest code (the interpreter ran at least one instruction)
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
feature dispatch. RDTSC is a deterministic instruction clock, not wall time. Legacy x87 arithmetic is not implemented;
the CRT's FNINIT/FNCLEX paths initialize the modeled state.

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
slots are eight bytes, ordinal bits are decoded at bit 63. The current checked flat window reserves **128 MiB**, with
image slots 16–64 MiB, heap 64–112 MiB and low stack/TEB/PEB/thunk regions. An access above the mapped window is an
explicit fault, never silent pointer truncation. Mapping is flat guest-offset + host arena base; the existing i386
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

Real-world limits beyond this finish line: AVX and newer extensions, x87 arithmetic, multi-threading, wider flat-memory
configuration, dynamic function table registration, MSVC C++ personality formats, arbitrary collided/foreign exception
cases, all CRT/Win32 APIs, and precise MXCSR FP traps/FTZ/DAZ or nondefault arithmetic rounding. Integer conversions honor
MXCSR rounding. Unknown instructions/APIs fault explicitly; do not work around them with game-specific overrides.

## v0.3 development: build scale

Pipeline compilation is parallel and incremental per translation unit (including lifted modules), with a content
cache under `node_modules/.cache/bgt/objects`. `BGT_BUILD_JOBS` defaults to 2, capped at 8. Sources, headers, compiler
version/flags and paths invalidate the cache. Linking still runs each build; Asyncify output is now content-cached by linked wasm/tool/feature/pass identity, with
atomic cache publication. `asyncify_cached` records a hit. This avoids spending the test timeout rebuilding an identical
postprocessed module; no existing test timeouts or assertions were relaxed. Conservative flag-liveness is
experimental opt-in: `pipeline.flagLiveness: true`; calls/branches/unknown instructions are barriers. No register-local
or flat-memory optimization is claimed yet. `node tools/bench/lift-scale.mjs 1024` writes `reports/scale.json` from an
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
CRT FILE APIs are still a gap. Threads/audio/COM/expanded input/GL are **not implemented by this change**.

## Recording and packaging a vertical slice (v0.3 subset)

During a probe, `reports/probe/coverage.json` records executed lifted/interpreted entries, module hashes/bases and file
chunks read. Browser tests using the shared fixture save `reports/coverage/<project>/*.json`; each also attaches the
snapshot. The read-only test API has `coverage()`. A snapshot is specific to exact binaries AND load bases; mismatches
fail the build. Preserve a successful launcher's entire L3 loop, not just a boot screenshot.

- Coverage-guided lifting without packaging: `pipeline.coverage: ["../reports/probe/coverage.json"]` selects recorded
  entries plus their static call closure; unselected code remains interpreted and recorded for the next build.
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
Code remains a single wasm module, no lazy code chunks. GL/threads remain gaps; AMD64 correctness does not establish
multi-million-instruction scale. Coverage is function entries,
not a guarantee against jumping into an unrecorded basic block within a covered function.

## Known execution limits (kit gaps, not port work)
- **x86:** i386 and baseline AMD64 modes; SSE/SSE2 semantics are currently enabled for AMD64 profile builds. No general
  x87 arithmetic, AVX or self-modifying code. Flat AMD64 memory currently 128 MiB, images 16–64 MiB.
- **Profiles:** Win32 only; DOS/consoles need new profiles.
- **GDI:** pixel reads come from CPU replay (exact for every recorded op; a surface drawn before replay was enabled,
  e.g. when `GetPixel` is only found through `GetProcAddress` late, is unknown until overdrawn). Window DC visible
  regions subtract visible children for WS_CLIPCHILDREN and higher siblings for WS_CLIPSIBLINGS (disjoint rectangles,
  up to 1024); explicit GDI region objects remain rect-only.
  Bitwise raster ops beyond the mapped set are approximated (counted). No copying within one surface. Drawing into a
  DIB section does not update its guest bits. `GetDIBits` writes 24/32-bpp `BI_RGB` only.
- **Win32:** no threads, no file writes, no COM, MENUEX templates unsupported.
