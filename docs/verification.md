# Verification record — Game Cask v0.1

This file is the evidence record for what has been **observed**. Anything not listed here is
unverified.

## Environment (builder run, 2026-10-29)

| item | value |
|---|---|
| host | macOS 26.6.2, Apple M4 |
| Node | 24.19.0 |
| Zig (C → wasm32) | 0.13.0 |
| Playwright | 1.64.1. Chromium 156.0.8078.4 (`chromium` channel + headless shell) |
| WebGPU adapter | Apple / metal-3, hardware. Needs `--enable-unsafe-webgpu` in headless Chromium |
| WebGL 2 | `chromium-webgl2` project: SwiftShader (software). WebGPU project: ANGLE Metal (hardware) |

## Commands and results

| command | result |
|---|---|
| `npm run doctor` | ready |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 ESLint errors (41 files). C sample + bench compile with `-Wall -Wextra -Werror` |
| `npm test` | **36/36 passed** (5 files) |
| `npm run test:e2e` | **42 passed, 1 skipped** (skip = the cross-backend comparison, which runs only in the WebGPU project). Three consecutive full runs green |
| `npm run build` | production bundle without `__BGT_TEST__`; a `VITE_BGT_TEST=1` build contains it |
| `npm run leakcheck` | ok (89 committable files) |
| `npm run bench` | see below |

### What the automated suites demonstrate

- **ABI:** `bgt_io_t` offsets/sizes, opcodes, error codes and limits in the C header match `abi.ts`.
  This is checked by compiling a C probe. The C command encoder output is byte-identical to the TS encoder.
- **Decoder safety:**
  - framing errors reject atomically
  - semantic errors skip only the bad command
  - limits are enforced
  - unsupported capabilities return `BGT_E_UNSUPPORTED`
  - 2000-case random fuzz never throws
  - hostile pointers/keys/paths from wasm get error codes
  - traps and aborts are surfaced
- **Sample L3 (headless and browser):** start → collect all 5 coins → win → title. The loop is driven by a
  path-planning bot through the public input path, on WebGL 2 **and** WebGPU. The lose loop is
  covered too (3 hits → game over → restart). Best score persists through `bgt_storage_*`.
- **Determinism:** the browser state-hash sequence equals itself across reloads **and** equals the Node headless host.
  Same-backend title frames are pixel-identical across reloads.
- **Rendering conformance:** 25 pixel probes over clear, viewport, scissor, transform, the 4 blend modes,
  nearest/linear sampling, triangles, and texture create/partial update/delete ordering. They pass on both backends.
  WebGPU vs WebGL 2 (ANGLE Metal) diff fraction: **0.0** for the conformance scene and **0.0** for the sample title.
- **Input:** scripted buttons, real keyboard events, a canvas tap (pointer) and touch-overlay buttons all move/start the game.
- **Audio:** locked until a gesture (no autoplay), then the coin SFX pushes samples.
- **Robustness:** 12 malformed command streams are rejected with the expected codes and the game keeps
  rendering. Resize/orientation (4 viewports) and DPR 3 keep the letterbox correct.
  Simulated WebGL context loss and WebGPU device loss both recover, with textures restored from shadow copies.
- **Fallback:** `?backend=webgpu-fail` → WebGL 2. `auto` picks WebGPU when an adapter exists. `?backend=none` and a
  missing game each show an accessible `role="alert"` panel.

### Benchmark (`reports/bench.md`, medians of 120 stepped frames, cross-origin isolated timers)

| sprites | batched render total (ms) | direct-call render total (ms) |
|---:|---:|---:|
| 1 000 | ~0.03–0.06 | ~0.045 |
| 10 000 | ~0.28 | ~0.43–0.45 |
| 50 000 | ~1.40 | ~2.21–2.24 |

Batching wins from about 10k sprites up (≈1.6× at 50k). At 1k sprites the direct path was equal or
slightly faster, so batching is **not** assumed to always be faster. GPU submit time is reported separately
(≤ 0.5 ms). Frame interval is vsync-bound (≈16.7 ms) in all cases except direct@50k on SwiftShader (≈20 ms).

## Gates NOT verified by this run

| gate | status |
|---|---|
| iPhone Safari (physical device) | **not performed**: no device attached to this session |
| Desktop Safari / WebKit, Firefox | not run (opt-in projects `BGT_ALL_BROWSERS=1`) |
| WebGPU on CI (Linux) | not run. The CI WebGPU job is opt-in on a self-hosted GPU runner |
| GitHub Actions run | workflow written, not executed (no remote) |

## Real-game trial

See the section appended after the porting subagent and independent validator have run.
