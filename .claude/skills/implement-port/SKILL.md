---
name: implement-port
description: Plan and implement a game port in port/ against the frozen BGT ABI — choose preserve/reconstruct/replace/selective-emulate per subsystem, write subsystem-map.json, build the smallest interactive vertical slice, then broaden.
---

# Implement the port

## 1. Plan (write before coding)
`reports/subsystem-map.json`:
```json
{ "game": "<name>", "subsystems": [
  { "name": "game loop & timing", "implementation_strategy": "reconstruct", "status": "in_progress",
    "confidence": "medium", "source_evidence": ["0x01a3: PIT reprogrammed to divisor 0x2e9c (~100 Hz)"],
    "known_deviations": ["runs at BGT fixed 60 Hz; original tick 100 Hz resampled"], "verification_evidence": [] } ] }
```
Strategies:
- **preserve**: keep original data as-is (level tables, palettes, fonts)
- **reconstruct**: re-implement recovered logic in C (game rules, AI, physics), citing evidence
- **replace**: new code for platform glue (video/audio/input/files/OS calls) mapped onto BGT
- **selective-emulate**: interpret a small original code image (e.g. a CPU-core interpreter for a tiny
  real-mode program) with BGT-backed device shims. Use it when the logic is too entangled to reconstruct
  faithfully and the code is small. Document emulator coverage and gaps.

`status`: `unknown → in_progress → implemented → tested → verified`. `verified` requires
`verification_evidence` (a test name, screenshot or trace) from a run you actually did.

## 2. Skeleton
Copy the shape of `examples/sample2d`:
```
port/game.json      { "id": "<id>", "name": "...", "private": true, "sources": ["src/main.c"], "assets": "assets",
                      "touch": {...}, "input": {"keys": {...}} }
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
