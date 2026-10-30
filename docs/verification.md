# Verification record — Game Cask

## Kit v0.3 changes (in progress)

The implementation/limitations ledger is [v03-status.md](v03-status.md). This is not a claim that the entire v0.3
brief is complete. Stage 1 fixture evidence covers the UI, timing and tooling fixes listed there, on WebGL 2 and
WebGPU. No private game was available or used. No dependencies were added; no existing assertions were weakened.

Metric change: `gdi_ops` now excludes profile-drawn chrome; new `chrome_ops` counts that drawing separately and may
vary with extra renders. Compare guest traces and `gdi_ops`, not `chrome_ops`, for deterministic runs.

Stage 1 gate run: doctor ready, lint/typecheck clean, unit 63/63, e2e 59 passed/4 pre-existing skips,
oracle identical/no errors (600 frames), leakcheck 158 files. A subsequent unit regression explicitly renders three
extra frames and asserts gdi_ops/trace unchanged and chrome_ops increases. Fresh counts appear in the final record.

Visual review of fixture screenshots: `phase0-controls.png` shows round selected radio, tick, stripped/escaped
prefix labels, literal SS_NOPREFIX label; `caption-style.png` shows close/help caption buttons and legible descenders;
`phase0-icon.png` shows the warning glyph and marked No default. All are substitute profile artwork, not Windows
pixel-parity claims. Large/non-ASCII fonts, supplied About HICON and main-window caption/frame fidelity remain limits.

---

# Historical v0.1 verification

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

## Real-game trial: DOS Defender (`original/DOSDEF.COM`, Unlicense, binary-only)

| item | result |
|---|---|
| test input | `DOSDEF.COM` 1.1.0 release binary (10 448 B, sha256 `f57bb629…a9d`). Upstream source deliberately **excluded** (binary-only policy in `original/PROVENANCE.txt`) |
| porting agent | separate spawned subagent, given only `CLAUDE.md`, `.claude/agents/game-porter.md`, skills and repo tools. Kit files unmodified (`git diff` empty) |
| REA | not available in this environment, and **not claimed**. Disassembly used capstone in a scratch venv |
| strategy | `selective-emulate`: a small real-mode x86 interpreter in C runs the original code image. BGT-backed shims for DOS/BIOS, VGA mode 13h + palette, 70 Hz vsync, PIT/PC speaker and two virtual joysticks |
| porter's claim | **L3** |
| independent validator | **confirmed L3 on WebGL 2 and WebGPU**. 40 claims checked: 34 confirmed, 3 partially, 1 rejected, 2 unverifiable. `reports/validation.md` (private) |
| key evidence | the original code draws the calibration screen (L1). Stick input changes game variables and pixels (L2). Start → player kills raise the score (score stays 0 without firing; each increment matches 1:1 a player kill) → game over → restart with the best score kept (L3). Reproduced on seeds 1–5 with identical numbers on both backends. `game.wasm` contains none of the game's code windows or strings |
| port tests | `npm run test:port`: 23 passed, 1 skipped (cross-backend test runs only in the WebGPU project) |
| rejected / partial claims | "every test checks errors" (3 tests don't). Game-rules subsystem marked `verified` though power-ups/boss were never exercised. Kill/game-over heuristics not labelled INFERRED |
| deviations | 70 Hz → 60 Hz update fitting (7 frames per 6 updates), square pixels (no 4:3), replacement BIOS text font, chosen joystick range |
| unverifiable | "binary never executed on host" and "binary-only policy obeyed": no contrary evidence found |
| not done | iPhone Safari, power-ups/boss coverage, listening tests for audio (frequencies were checked numerically) |

### Kit changes made after the trial (from its confirmed feedback)

1. `game.json` `"originals"`: the build copies hash-checked files from `original/` into the private build output,
   so ports no longer need ad-hoc copy scripts.
2. `npm run report -- --strict` no longer fails on machine-written Playwright/bench JSON. Those findings are reported as
   informational; `--fix` before sharing them.
3. Port and kit browser runs write separate results (`reports/e2e-port-*` vs `reports/e2e-*`).
4. `input.keys` entries set to `null` unbind default keys.
5. `inspect` marks LLVM/Apple `objdump` as unable to disassemble raw images.
6. Bug found while testing (4): pressing a second key bound to an already-held button produced a spurious
   `buttons_pressed` edge. Presses now latch only on real transitions.

After these changes: `npm test` 37/37, `npm run test:e2e` 65 passed / 2 skipped (kit + port projects),
`npm run test:port` 23 passed / 1 skipped, `npm run report -- --strict` exit 0, `npm run leakcheck` ok.

Deferred (ABI change, v0.2 candidates):
- a pixel-aspect flag for 320×200 DOS games
- per-player gamepad assignment
- running the game in a Worker so runaway loops can be pre-empted

## Kit v0.2 (2026-10-30): systematic pipeline

| item | evidence |
|---|---|
| ABI v0.2: render targets, XOR-like invert, multiply, `bgt_yield`/asyncify, runtime logical size, `bgt_metrics` | conformance probes pass on WebGPU (Metal) and WebGL 2 (SwiftShader): render-target orientation, invert white/black, multiply. Unit test suspends a never-returning loop with stack locals intact |
| x86 decoder, shared semantics, interpreter, lifter (`tools/x86`) | decoder unit test on hand-checked encodings. Lifting is byte-deterministic |
| Win32 profile (`platforms/win32`) on BGT | `examples/win32-hello`, built from our source (CC0), runs **fully lifted**: `interp_insns` 0, 0 stubs, 0 command errors; window, menu, popup, MessageBox, BitBlt, InvertRect, TextOut, timers, registry. Browser e2e passes on both backends |
| differential oracle | 600 frames of scripted input: lifted (0 interpreted insns) and interpreted (211,605 insns) builds give identical API traces (9,228 calls, 11,977 GDI ops) |
| generic extractor | reproduces trial 1's Solitaire payload byte-identically (same SHA-256), with names taken from the payloads' own metadata |
| bug found by CI | unrecoverable WebGPU device loss hung the runtime → mid-game WebGL 2 fallback (CI green) |

Totals: `npm test` 45/45, `npm run test:e2e` 50 passed / 3 skipped (by design).

Not verified: iPhone Safari; DOS/console profiles (not implemented); x87 FPU lifting (not implemented).

## Kit v0.2.1 changes (2026-10-30): from the Solitaire trial 2 findings

Input: trial 2's `reports/errors.json` (E1–E9) and `reports/validation.md` (K1–K3). The trial's port and reports were
not modified or re-run; everything below was developed and verified on kit fixtures built from our own CC0 source.

### Instructions: problems become a work queue, kit gaps become iteration requests
- `CLAUDE.md`, `game-porter`, `implement-port`, `browser-validation`, `independent-validator`: reaching a level is not
  done. Every observed problem goes on `reports/progress.json` → `queue` (`id, symptom, evidence, layer, status, next`),
  localized to `lifter | semantics | platform-profile | renderer | test | game`. Done = every item `fixed` (proof),
  `authentic` (binary evidence) or `iteration-request`. "Unverified" is not a status. Kit changes are never made by
  the porter and never silently skipped: the final reply leads with "Iteration requests" (symptom, evidence, layer,
  the kit change in Win32/API terms, the check after it lands). Resume mode is documented.
- The validator grades the queue (unproven fixed/authentic items, wrong layers, problems missing from the queue) and
  checks that every port test states what it catches and asserts a change.
- `npm run report` validates the queue (`schema.mjs` `validateQueue`) and lists port tests without a `catches` note.
- `docs/trial-brief.md` + `npm run trial:brief` (→ `reports/brief.md`; `--resume` adds the resume section);
  `npm run trial:record` stores the brief, the queue and the iteration requests in `trial.json` (schema `trial/3`).

### Tools for finding problems
- **Resource tour** `tests/support/tour.ts`: every menu item through real input (layout rectangles from the new
  read-only `debugState().ui`), screenshots, errors/aborts/new stubs/new APIs/metric deltas per item, dialogs and
  message boxes dismissed, exit items skipped. Validated on win32-hello, which now has an Options dialog and a
  STRINGTABLE: the tour finds the literal `&` and the check-box-style radio buttons (E6) without being told.
- **Probe** `npm run probe -- --game ID --script F.mjs`: own Vite server on a free port (never :5173), headless
  Chromium, `start/step/click/key/screenshot/crop/pixel/metrics/peek/tour`, artifacts in `reports/probe/`.
- **Visual review checklist** and the **tests-must-fail rule** in `browser-validation`; helpers `catches`,
  `expectChange`, `captureRegion`, `regionDiff`, `peekBytes` (`tests/support/evidence.ts`, re-exported by the fixtures).

### Kit gaps fixed (Win32 semantics)
| item | change | verified by |
|---|---|---|
| E1 | DLL names resolve to a shipped module, then to a profile DLL (`platforms/win32/dlls.json`); otherwise `LoadLibrary*` → NULL + `ERROR_MOD_NOT_FOUND` (126), `GetProcAddress` → NULL + `ERROR_PROC_NOT_FOUND` (127) for unknown names and any ordinal of a profile DLL; no faulting thunks for dynamically loaded DLLs. Static imports of unknown DLLs fail the build (and boot) naming the DLL. Ordinal imports keep their number (`dll!#14`). Paths stripped, `.dll` appended, forwarders followed, `GetModuleHandle` only for loaded modules | `win32-profile.test.ts` (13 loader checks in `examples/win32-conformance`, e.g. `LoadLibraryA("missing.dll") == NULL && GetLastError() == 126`, `GetProcAddress(self, ordinal 1)`, `GetProcAddress(kernel32, ordinal 1) == NULL, 127`), `kit-tools.test.ts` (unknown static import fails the build), `win32-conformance.spec.ts` (both backends) |
| E2 | Pixel reads on GPU surfaces are answered exactly by **CPU replay** of the recorded GDI ops (`platforms/win32/w32_replay.c`), on demand for the queried pixel, with log compaction and a cache; enabled when a module imports `GetPixel`/`GetDIBits` (or gets one via `GetProcAddress`). `GetDIBits` honours 24/32 bpp and top-down/bottom-up. `GetPixel` outside the clip returns `CLR_INVALID` without counting. New metrics `gdi_pixel_reads`, `gdi_cpu_replays`, `gdi_replay_compactions`, `pixel_replay`; `gdi_getpixel_noread` counts only reads without known history | `win32-conformance.spec.ts`: 30 op kinds (fills, all mapped raster ops, blits from CPU-known and GPU-drawn bitmaps, 2x/3:2 stretching, text, pens, XOR pens, pattern brush, StretchDIBits/SetDIBitsToDevice/SetDIBits, mono bitmap, screen→memory→screen) — **51 200 / 51 200 pixels identical to the GPU on WebGL 2 (SwiftShader) and WebGPU (Metal)**, plus GetPixel-on-memory-DC and GetDIBits equal to the GPU. A deliberate 3 % error in the multiply blend makes it fail. `win32-profile.test.ts` checks the same reads headless |
| E3 | The analyzer classifies pointer seeds that are data (data directories, import names, strings, zero bytes, undecodable/unsupported decodes) as `dataSeeds`, re-analyses without them, and never lifts them; counts in the analysis JSON, the lift stats and the pipeline summary | `kit-tools.test.ts` with `tests/fixtures/win32/data_in_text.c` (ASCII + UTF-16 strings, zeros and `in al,0x60` inside `.text`, next to a pointer-only callback that stays a function) |
| E4 | Metric renames (below) | docs, tests, oracle |
| E5 | `__BGT_TEST__.peek(addr, len)` via the optional debug-only export `bgt_debug_peek` (ABI.md §2, §9); read-only, test builds only; `debugState().modules` gives module bases | `win32-profile.test.ts` (copy semantics, unmapped/oversized → null, state hash unchanged), conformance tests read their report with it |
| E7 | `inspect --strings`: UTF-16LE strings and decoded STRINGTABLE / MENU(EX) / DIALOG(EX) text with control classes and styles (stdout only) | `kit-tools.test.ts` on win32-hello's resources |
| E8 | `npm test` / `npm run test:e2e` / `lint` build only `examples/` and never run `port/tests` (port projects need `BGT_PORT_TESTS=1`, set by `test:port`). Result files are `reports/<prefix>-*`: `e2e` (kit), `e2e-port` (port), `e2e-adhoc` for a direct `npx playwright test`. The test server's readiness URL is kit-specific (`/games/index.json`), so an unrelated app on the port is never reused (K3) | baseline and final runs below (no port tests in the kit results) |
| leakcheck | `--against` ignores the kit's own JSON metadata (`"schema": "game-cask/…"`, e.g. `extract.json`) while still blocking payload copies | `kit-tools.test.ts` |

Metric renames (E4), old → new:
| v0.2 | v0.2.1 | counts |
|---|---|---|
| `continues` | `tail_calls_lifted` + `continues_interpreted` | lifted jumps resolved straight to lifted code (not interpretation) / lifted frames that really continued in the interpreter (tail jumps to import thunks count as neither) |
| `interp_entries` | `interp_code_entries` | entries into non-lifted guest code where the interpreter ran ≥ 1 instruction (import-thunk calls no longer count) |
| `exec_one` | `generic_insn_execs` | instructions executed through the shared semantic core inside lifted code |

Left for the porter's next iteration (made findable, not fixed): E9 (drawing artifact during animations), child-window
clipping / status-bar overdraw (K1), dialog control rendering (`&` prefixes, radio buttons, separators) and dialog font
and clipping (E6, K2).

Totals after v0.2.1 (macOS, Apple M4; WebGPU on Metal, WebGL 2 on SwiftShader): `npm run doctor` ready;
`npm run typecheck` 0 errors; `npm run lint` clean (examples compile with `-Werror`); `npm test` **56/56** (9 files);
`npm run test:e2e` **53 passed, 4 skipped** (the 3 by-design cross-backend skips plus the resource tour's WebGPU
duplicate), no port projects; `npm run oracle -- examples/win32-hello` **identical** over 600 frames (lifted
`interp_insns` 0, interpret-only 212 185, 9 231 API calls each), and `examples/win32-conformance` identical over 300;
`npm run leakcheck` ok.
