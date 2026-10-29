---
name: implement-port
description: Configure and run the kit's systematic conversion pipeline for a game in port/ (game.json "pipeline": extract → analyze → lift → platform profile → wasm), read its metrics, and add minimal, justified per-function exceptions only where the pipeline provably cannot cope.
---

# Implement the port (pipeline first)

A port is mostly configuration. The kit converts the original binary reproducibly. Your job:
1. Point the pipeline at the right files.
2. Read its metrics.
3. Prove where it falls short.
4. Add the smallest possible exceptions.
5. Report kit gaps.

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
- List every module the program loads that ships with the game (DLLs it imports by name). System DLLs are the
  platform profile's job.
- Module `name` must match the import name (case-insensitive).
- See `docs/pipeline.md` for all options.

## 2. Build and read the summary
`npm run build:port` prints, per module:
- functions
- specialized/generic instructions
- jump tables resolved
- **unresolved indirect jumps**
- generated vs hand-written LOC
- overrides

Also read the analysis JSON in `node_modules/.cache/bgt/pipeline/<id>/analysis_*.json`: imports, census, `fpu`,
`unsupported`, `undecodable`. Record them in `reports/analysis.md`.

## 3. Run, then prove problems before fixing them
- `npm run oracle -- port`: lifted and interpreted builds must agree frame by frame. A divergence is a lifter bug,
  which is a **kit gap** with its frame and API. A runtime fault names the address or API.
- Browser tests: see the `browser-validation` skill. `diagnostics().metrics` shows:
  - `interp_insns` / `continues`: code that was not lifted
  - `stubs` and fault messages naming unimplemented APIs
  - `gdi_approx_rop` / `gdi_unsupported`: drawing the profile could only approximate

## 4. Exceptions (only with evidence)
When a specific function cannot work through the pipeline, override that one function:
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
- Missing platform behaviour (an unimplemented API, a GDI feature) is a kit gap: record it in
  `reports/errors.json` with `"kind": "kit-gap"`, the API name and the evidence. Work around it with an override
  only if you must to continue, and say so.

## 5. Status and evidence
`reports/subsystem-map.json` now describes **pipeline coverage**. Per subsystem (game logic, rendering, input,
timing, audio, storage, UI/dialogs) record:
- `implementation_strategy`: `lifted` (pipeline), `profile` (platform layer), `override` (exception)
  or `unsupported` (kit gap)
- `source_evidence`, `known_deviations` (INFERRED ones included), `status`, `verification_evidence`

Then run `npm run trial:record -- port <slug>`. It writes `reports/trial.json` and `reports/NOTES.md` (fill in the
port note).
