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

## v0.3 development: scale and x64 metadata (not execution)

`npm run analyze -- FILE --metadata` is a bounded-read PE32/PE32+ metadata path (full-width image base, import DLLs,
RUNTIME_FUNCTION records and UNWIND_INFO headers/codes). It does **not** decode instructions or implement unwinding.
Normal `analyze`/`build:port` reject Win64 explicitly. x64 conversion is still a kit gap; do not substitute an engine
runtime or truncate 64-bit pointers. Fixtures can use `pipeline.fixture.target: "x86_64-windows-gnu"` for static tests.

Pipeline compilation is parallel and incremental per translation unit (including lifted modules), with a content
cache under `node_modules/.cache/bgt/objects`. `BGT_BUILD_JOBS` defaults to 2, capped at 8. Sources, headers, compiler
version/flags and paths invalidate the cache. Linking/asyncify still run each build. Conservative flag-liveness is
experimental opt-in: `pipeline.flagLiveness: true`; calls/branches/unknown instructions are barriers. No register-local
or flat-memory optimization is claimed yet. `node tools/bench/lift-scale.mjs 1024` writes `reports/scale.json` from an
original generated CC0 fixture. See [v03-status.md](v03-status.md) for measured sizes (including the flag-liveness
regression) and outstanding x64/GL/threading work.

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

## Known execution limits (kit gaps, not port work)
- **x86:** 32-bit flat mode only. No x87/SSE (FPU instructions fault). No self-modifying code (the decoder caches).
- **Profiles:** Win32 only; DOS/consoles need new profiles.
- **GDI:** pixel reads come from CPU replay (exact for every recorded op; a surface drawn before replay was enabled,
  e.g. when `GetPixel` is only found through `GetProcAddress` late, is unknown until overdrawn). Window DC visible
  regions subtract visible children for WS_CLIPCHILDREN and higher siblings for WS_CLIPSIBLINGS (disjoint rectangles,
  up to 1024); explicit GDI region objects remain rect-only.
  Bitwise raster ops beyond the mapped set are approximated (counted). No copying within one surface. Drawing into a
  DIB section does not update its guest bits. `GetDIBits` writes 24/32-bpp `BI_RGB` only.
- **Win32:** no threads, no file writes, no COM, MENUEX templates unsupported.
