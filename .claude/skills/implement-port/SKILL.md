---
name: implement-port
description: Configure and run the kit's systematic conversion pipeline for a game in port/ (game.json "pipeline": extract → analyze → lift → platform profile → wasm), read its metrics, work the queue of observed problems, add minimal, justified per-function exceptions only where the lifted code provably cannot cope, and file iteration requests for kit gaps.
---

# Implement the port (pipeline first)

A port is mostly configuration. The kit converts the original binary reproducibly. Your job:
1. Point the pipeline at the right files.
2. Read its metrics.
3. Put every problem you observe on the work queue and localize it to a layer.
4. Fix what is port-side; add the smallest possible exceptions where the lifted code is provably the problem.
5. Turn kit gaps into iteration requests.

## 1. Configure
`port/game.json`:
```json
{
  "id": "<id>", "name": "...", "private": true,
  "pipeline": {
    "platform": "win32",
    "modules": [ { "from": "<file in original/ or installer.exe#INNER.EXE>", "main": true },
                 { "from": "installer.exe#LIB.DLL", "name": "lib.dll" } ],
    "width": 640, "height": 480
  },
  "touch": { "dpad": false, "buttons": [] }
}
```
- List every module the program loads that ships with the game (DLLs it imports by name or loads with
  `LoadLibrary`). System DLLs are the platform profile's job (`platforms/win32/dlls.json` lists them).
- A static import of a DLL that is neither a listed module nor implemented by the profile **fails the build** with
  the DLL's name. If the game ships it, add it as a module; if it is a system DLL the profile lacks, that is an
  iteration request.
- Module `name` must match the import name (case-insensitive).
- See `docs/pipeline.md` for all options.

## 2. Build and read the summary
`npm run build:port` prints, per module:
- functions and **data seeds** (pointer seeds the analyzer classified as data and did not lift)
- specialized/generic instructions
- jump tables resolved
- **unresolved indirect jumps**
- generated vs hand-written LOC
- overrides

Also read the analysis JSON in `node_modules/.cache/bgt/pipeline/<id>/analysis_*.json`: imports, census, `fpu`,
`unsupported`, `undecodable`, `dataSeeds` (address, seed kind, reason). Record them in `reports/analysis.md`.
`npm run inspect -- --strings FILE` also prints UTF-16 strings and the decoded STRINGTABLE/MENU/DIALOG text.

## 3. Run, observe, queue, localize
- `npm run oracle -- port`: lifted and interpreted builds must agree frame by frame. A divergence is a lifter bug.
- Browser tests and exploration: see the `browser-validation` skill (tests, resource tour, probe, visual checklist).
- `diagnostics().metrics` shows:
  - `interp_insns` / `interp_code_entries` / `continues_interpreted`: code that was not lifted
  - `stubs` and fault messages naming unimplemented APIs (ordinals keep their number: `dll!#14`)
  - `gdi_approx_rop` / `gdi_unsupported`: drawing the profile could only approximate
  - `gdi_cpu_replays` / `gdi_getpixel_noread`: pixel reads answered by CPU replay / impossible reads
- Read guest state in tests with `__BGT_TEST__.peek(addr, len)` (read-only, test builds only); find the addresses
  with `npm run analyze -- FILE --disasm`. Never write guest memory.

Put **every** observed problem on the queue in `reports/progress.json` at once, then localize it:

| layer | how you prove it |
|---|---|
| `lifter` | the oracle diverges (first divergent frame and APIs), or interpret-only build behaves differently |
| `semantics` | an instruction's result is wrong in both builds (disassembly + `peek` of the values) |
| `platform-profile` | an API stub/fault, a profile counter, profile-drawn chrome (menus, dialogs, message boxes), a Win32 contract the profile breaks (cite the API and what Windows does) |
| `renderer` | the same GDI ops give different pixels on WebGPU and WebGL 2, or differ from the CPU replay |
| `test` | the test passes with the feature broken, or checks less than its name says |
| `game` | the original program does this itself: cite the code address, resource or data (status `authentic`) |

Status values: `open` (with the next experiment in `next`), `fixed` (with proof), `authentic` (with binary evidence),
`iteration-request`. There is no "unverified".

## 4. Exceptions (only with evidence)
When a specific lifted function cannot work through the pipeline, override that one function:
```c
/* port/overrides/0040123a.c */
#include "x86_lift.h"
/* why: <evidence: analysis/oracle/fault output>. INFERRED parts: <...> */
X86_OVERRIDE(0040123a) { ... X.eip = x86_pop(); }
```
Examples: x87 FPU code (not lifted in v0.2), self-modifying code, timing loops that spin on hardware.
- Keep each override small, with a reason and its evidence.
- **Never** override to rewrite game rules from genre knowledge.
- **Never** add a per-game emulator or interpreter.
- **Never** override to work around missing or wrong platform behaviour (an unimplemented API, a GDI feature, a
  USER32 contract). That is an iteration request.

## 5. Iteration requests (kit changes)
When the fix belongs in `bgt/`, `platforms/`, `tools/` or `tests/`:
1. Set the queue item to `iteration-request` and add an `errors.json` entry with `"kind": "kit-gap"`.
2. Write the needed change in Win32/API or ABI terms: what the real API does (from its contract), what the profile
   does instead, the evidence (fault text, metric, screenshot, address), and the check you will run once it lands.
   Example: "LoadLibraryA of a DLL that is neither shipped nor implemented must return NULL with
   GetLastError() == ERROR_MOD_NOT_FOUND (126); the profile returns a pseudo handle whose thunks abort."
3. Continue with every other item. Do not stop at the first gap and do not change the kit yourself.
4. Your final reply leads with the iteration requests (see `game-porter`).

## 6. Status and evidence
`reports/subsystem-map.json` describes **pipeline coverage**. Per subsystem (game logic, rendering, input,
timing, audio, storage, UI/dialogs) record:
- `implementation_strategy`: `lifted` (pipeline), `profile` (platform layer), `override` (exception)
  or `unsupported` (kit gap)
- `source_evidence`, `known_deviations` (INFERRED ones included), `status`, `verification_evidence`

Then run `npm run trial:record -- port <slug>`. It writes `reports/trial.json` (including the trial brief and the
queue) and `reports/NOTES.md` (fill in the port note).
