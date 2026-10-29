---
name: implement-port
description: Plan and implement a game port in port/ against the frozen BGT ABI — choose preserve/reconstruct/replace/selective-emulate per subsystem, write subsystem-map.json, build the smallest interactive vertical slice, then broaden.
---

# Implement the port

## 1. Plan (write before coding)
`reports/subsystem-map.json`:
```json
{ "game": "<name>", "subsystems": [
  { "name": "game loop & timing", "implementation_strategy": "replace", "status": "in_progress",
    "confidence": "medium", "source_evidence": ["0x01a3: PIT reprogrammed to divisor 0x2e9c (~100 Hz)"],
    "known_deviations": ["runs at BGT fixed 60 Hz; original tick 100 Hz resampled"], "verification_evidence": [] } ] }
```
Principle: **keep the original experience, swap out the minimum.** The original code and data stay; only the
platform layer underneath them is replaced. Decide this only **after** analysis has mapped:
- the import table (per DLL/function, with call-site counts) or the interrupt/port usage
- the call graph from the entry point through the main loop / message handlers
- which platform calls the boot → play → end paths actually reach

Strategies, in order of preference:
1. **preserve**: original data used as-is (graphics, levels, palettes, fonts, sounds).
2. **selective-emulate**: run the original code image under a CPU interpreter (real-mode or 32-bit flat), with
   shims that implement only the platform calls this binary actually uses, on top of BGT:
   - DOS/BIOS/VGA/PIT for DOS programs
   - the imported Win32/GDI/USER/KERNEL functions for Windows programs. Statically linked frameworks such as
     Delphi VCL or MFC-static are just more original code and run as-is.

   This is the default for game logic. The spec's non-goal is *arbitrary* binary execution; a shim scoped to one
   binary's measured import set is in scope. Track shim coverage: implemented, stubbed, and stubs hit at runtime.
3. **replace**: new code for the platform glue itself (rendering, input, audio, storage, timing), mapped onto BGT.
   This is what the shims are made of.
4. **reconstruct**: re-implement original logic in C. Use it only for a subsystem where the analysis shows emulation is
   infeasible, e.g. an unshimmable dependency or a surface far too large for the slice, and record the numbers
   behind that decision. Every reconstructed rule cites code evidence (addresses); general genre knowledge is
   `INFERRED`.

`status`: `unknown → in_progress → implemented → tested → verified`. `verified` requires
`verification_evidence` (a test name, screenshot or trace) from a run you actually did.

## 2. Skeleton
Copy the shape of `examples/sample2d`:
```
port/game.json      { "id": "<id>", "name": "...", "private": true, "sources": ["src/main.c"], "assets": "assets",
                      "originals": [{"from": "GAME.EXE", "to": "game.exe", "sha256": "..."}],   (optional)
                      "touch": {...}, "input": {"keys": {"KeyW": null, "KeyI": "UP"}} }      (null unbinds a default)
port/src/main.c     BGT_DEFINE_IO(io); bgt_init / bgt_update / bgt_render / bgt_shutdown
                    + bgt_state_hash and bgt_debug_state (strongly recommended: they make tests possible)
```
`npm run build:port` compiles with `zig cc --target=wasm32-freestanding -Wall -Wextra -Werror`.
No libc: use `bgt/sdk/bgt_libc.c` (memset/memcpy/memmove/memcmp/strlen) and `__builtin_*`.
Add more `.c` files to `sources` as needed.

## 3. Rules
- Only `bgt.h`/`bgt_cmd.h`/`bgt_image.h` APIs. **Do not edit `bgt/`.** A missing general capability becomes a
  `kit-gap` entry in `reports/errors.json`, and you work around it in `port/`.
- Simulation advances only in `bgt_update` (fixed 60 Hz, `io.frame`). `bgt_render` must be side-effect-free.
- Map original input to virtual buttons and keys (`io.buttons`, `bgt_key_down`). Set `touch` in `game.json` so the
  game is playable on a phone.
- Original timing (PIT/vsync rates) → convert to update counts. Document resampling.
- Mark every piece of logic not evidenced by the binary with `/* INFERRED: why */`.
- Honour any POLICY from `original/` (e.g. binary-only).

## 4. Vertical slice first
Aim for: boots to an authentic first screen (L1) → input visibly changes state (L2) → one authentic gameplay
loop (L3). Get each level verified in the browser before broadening.

## 5. Tests for the port
Port-specific tests are private, like the rest of `port/`. Put Playwright specs in `port/tests/*.spec.ts`
and run them with `npm run test:port` (projects `port-webgl2` and `port-webgpu`). Import the shared
fixtures with `import { test, expect, openGame, step, input, debugState, readPixels, attachScreenshot } from '../../tests/e2e/fixtures';`
and load the game with `openGame(page, backendParam, { game: '<id>' })`.
Minimum set: boot (authentic first screen), input changes state, and one complete gameplay loop.
Every test should end with the error checks (diagnostics `errors`, `commandErrors`, game-specific fault flags), and the
L3 test should tie progress to the player's own actions (not idle/AI-driven changes).
Port results go to `reports/e2e-port-results.json` and `reports/e2e-port-artifacts/` (kit runs use `reports/e2e-*`),
so the two never overwrite each other.
