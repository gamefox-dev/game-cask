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
Images keep their preferred base address unless two overlap; then the later one is relocated (it needs a
`.reloc` section). Lifting and loading use the same base.

## Stages and what they guarantee
| stage | tool | output | guarantees |
|---|---|---|---|
| extract | `tools/extract/extract.py` | files + `extract.json` (chain, sha256) | static only; installer SHA-1s verified; encrypted installers refused |
| analyze | `tools/x86/x86tool analyze` | JSON: imports + call sites, functions (seeded by entry, exports, relocated and immediate code pointers), call graph, jump tables, census | deterministic |
| lift | `tools/x86/x86tool lift` | C: `F_<addr>()` per function, a label per instruction, explicit control flow, jump tables as `switch` | same semantics as the interpreter (`platforms/x86/x86_sem.h`) |
| profile | `platforms/win32` | Win32 API on BGT: USER (windows, messages, menus, dialogs), GDI on render targets, KERNEL/CRT, registry on storage | unknown imports fault by name |
| oracle | `npm run oracle -- <game>` | lifted vs interpret-only build, same scripted input; per-frame API-trace hash | first divergent frame localises a bug |

## Metrics (what to report)
- **Pipeline summary** (printed by the build, stored in `manifest.json` → `pipeline`):
  - generated vs hand-written LOC
  - functions; specialized vs generic instructions (generic = executed through the shared semantic core)
  - jump tables; unresolved indirect jumps; overrides
- **Runtime** (`diagnostics().metrics`, from the game's `bgt_metrics` export):
  - `interp_insns`: guest instructions that ran in the interpreter (0 = fully lifted)
  - `continues`: lifted frames that had to continue in the interpreter (unresolved jumps, code beyond known functions)
  - `exec_one`: generic instruction executions
  - `api_calls`, `apis_hit`, `stubs` (declared no-ops that were called)
  - `gdi_ops`, `gdi_approx_rop` (raster ops approximated on the GPU)
  - `gdi_unsupported`, `gdi_getpixel_noread` (GPU surfaces are not read back)
  - `mono_color_blits`, `peek_yields`, `targets_lost`, `trace_hash`
- **Exceptions**: every override with a reason; every kit gap in `reports/errors.json`.

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

## Known v0.2 limits (kit gaps, not port work)
- **x86:** 32-bit flat mode only. No x87/SSE (FPU instructions fault). No self-modifying code (the decoder caches).
- **Profiles:** Win32 only; DOS/consoles need new profiles.
- **GDI:** no GPU readback (`GetPixel`/`GetDIBits` only on CPU-known bitmaps). Rect-only clipping.
  Bitwise raster ops beyond the mapped set are approximated (counted). No copying within one surface.
- **Win32:** no threads, no file writes, no COM, MENUEX templates unsupported.
