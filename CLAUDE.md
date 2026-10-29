# Game Cask — operating rules for Claude Code

Game Cask restores legally obtained legacy games as browser games. A port is C compiled
to wasm32 that talks only to the **Game Cask Browser Target (BGT) ABI**. The runtime handles
WebGPU/WebGL 2, input, audio, storage and assets.

**When the user says "Port this game"**, follow the workflow below from step 1.

## Read first
1. `SPEC.md`: the brief and its success levels (L0–L5, §8).
2. `bgt/abi/ABI.md`: the frozen ABI. Port against it; do not change it.
3. `original/PROVENANCE.txt` or other user notes in `original/`, if present. **Obey any POLICY stated there**
   (e.g. "binary-only: do not fetch or use upstream source").

## Baseline (always, before touching a port)
```sh
npm run doctor          # toolchain: node, zig (C->wasm), playwright browsers
npm test                # unit tests (builds examples)
npm run test:e2e        # browser tests: WebGL 2 + WebGPU (if available) + fallback
```
If the baseline fails, fix or report that first. Never start a port on a red baseline.

## Workflow ("Port this game")
| step | do | skill / agent |
|---|---|---|
| 1 | `npm run inspect` → `reports/inventory.json`: candidates, formats, platform hints, tool availability | `inspect-game` |
| 2 | Detect REA. Use it **only if actually callable**; otherwise say so and use the deterministic tools | `use-rea` |
| 3 | Analyse the executable(s) and assets: entry, game loop, rendering, input, timing, sound, files, with evidence and confidence | `game-analyst` agent, `recover-assets` |
| 4 | Choose a strategy per subsystem: `preserve` / `reconstruct` / `replace` / `selective-emulate`. Write `reports/analysis.md` and `reports/subsystem-map.json` | `implement-port` |
| 5 | Implement the **smallest interactive vertical slice** in `port/` (C + `game.json`) | `game-porter` agent, `implement-port` |
| 6 | `npm run build:port`, then open `/?game=<id>`. Exercise the **actual game** in the browser, capture evidence, iterate | `browser-validation` |
| 7 | Broaden; keep `reports/progress.json` and `reports/errors.json` current (resumable) | |
| 8 | Run the port's e2e checks on WebGPU and WebGL 2. Physical iPhone checks only if a device is available | `browser-validation` |
| 9 | Independent validation by a **separate** agent that did not write the port | `independent-validator` agent |
| 10 | `npm run report`, then write `reports/final-report.md` | |

## Hard rules
- `original/` is **read-only, private, never committed**. Do not copy its bytes into the repo, reports,
  CI artifacts or prompts beyond what analysis needs. `npm run leakcheck` must pass.
- **Never execute original binaries on the host.** Static analysis only, unless the user provides a disposable
  VM/container. Treat archives and decompressed data as untrusted: extract into a new directory outside
  the repo and pass paths as arguments (Python: `python3 -I`).
- No DRM/copy-protection/activation bypass. If the game needs one, stop and report it as blocked.
- Do not modify `bgt/` (shared ABI/runtime) to make a port pass. If a general capability is genuinely
  missing, record it in `reports/errors.json` as `kit-gap` with justification, and work around it in `port/`.
- Ports are private by default: `port/game.json` has `"private": true`. Only the user may change that.
- **Label inference.** Any logic not directly evidenced by the binary is marked `INFERRED` in code comments
  and in `known_deviations`. Never present guesses as recovered behaviour.
- **Never claim a tool ran when it did not, a test passed when it did not, or a level that was not
  observed.** Use these definitions:
  - **booted (L1)**: the port initializes and shows an authentic initial screen
  - **interactive (L2)**: input changes visible state, reproducibly
  - **playable (L3)**: one representative authentic gameplay loop completed, in the browser
- "Looks correct" is unverified until backed by a reproducible test, screenshot comparison or trace.
- Report hardware gates separately. Desktop emulation is not iPhone Safari verification.

## Commands
| command | purpose |
|---|---|
| `npm run dev` | build games + Vite dev server (`/?game=<id>&debug=1`) |
| `npm run build:port` / `build:sample` | compile `port/` or the sample to `web/public/games/<id>/` |
| `npm test` / `npm run test:e2e` | unit / browser suites (`test:e2e:webgl2`, `test:e2e:webgpu`) |
| `npm run inspect` | read-only inventory of `original/` (`-- --strings <file>` prints strings to stdout only) |
| `npm run report` | validate + redact `reports/`, write `reports/summary.md` |
| `npm run leakcheck` | block private files/secrets from commits (also a pre-commit hook) |
| `npm run bench` | batched vs direct-call rendering benchmark → `reports/bench.md` |

URL flags: `game, backend=auto|webgpu|webgl2|webgpu-fail|none, paused=1, seed, arg0, arg1, touch=on, debug=1, ephemeral=1`.

## Layout
`bgt/` ABI + runtime (shared, frozen) · `examples/sample2d` reference game (read it before writing a port) ·
`port/` your port · `tools/` inspect/build/assets/report · `tests/` unit + e2e · `reports/` porting state (private).
