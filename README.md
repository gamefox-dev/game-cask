# Game Cask

An agent-first starter kit for restoring **legally obtained** legacy games as playable browser
games. You bring the game files; Claude Code analyses them with reverse-engineering tools and
rebuilds the game in C. It runs in the browser through a small, stable ABI called the
**Game Cask Browser Target (BGT)**: WebGPU first, WebGL 2 fallback, phone-friendly input.

## Port a game

```sh
npm ci && npx playwright install chromium   # once (also needs zig, see Setup)
cp -R /path/to/your/game/* original/        # your own legally obtained copy; never committed
claude                                      # open Claude Code in this directory
> Port this game
```

Claude follows [`CLAUDE.md`](CLAUDE.md):
1. Establish a green baseline.
2. Inventory `original/`, then analyse the binary (with REA when available).
3. Choose a strategy per subsystem (preserve / reconstruct / replace / selective-emulate).
4. Build the port in `port/`.
5. Test it in real browsers.
6. Report honestly what level it reached:
   - L1 boots
   - L2 interactive
   - L3 playable

Ports, reports and screenshots stay private and local by default.

## How porting works (kit v0.2)

Ports go through a **systematic, reproducible pipeline** rather than per-game rewrites
([docs/pipeline.md](docs/pipeline.md)):

```
extract installer/archive → analyze x86 (imports, call graph, jump tables) → lift each function to C
→ platform profile maps the OS API onto BGT by meaning (Win32: windows, messages, menus, dialogs,
  GDI on GPU render targets, registry on storage) → wasm → differential oracle + browser tests
```

A port is a `game.json` with a `"pipeline"` section, plus a few hand-written, justified per-function
**exceptions** at most. `examples/win32-hello` is a complete pipeline game built from our own source:
it is lifted with zero hand-written code, and the oracle shows its lifted and interpreted runs agree frame by frame.

## Try the sample (no game files needed)

```sh
npm run dev            # → http://localhost:5173/?game=sample2d
```

*Coin Cave* (`examples/sample2d`) is a small original C game. Collect the coins and avoid the
enemies; arrows/WASD move, Enter/Z start. On a phone it shows touch controls. It exercises the
whole kit: Wasm build, asset VFS, command-buffer rendering, input, audio, storage, determinism
and the test API.

Useful URL flags:
- `?backend=webgl2|webgpu|webgpu-fail|none`
- `?debug=1` (diagnostics overlay)
- `?touch=on`
- `?paused=1`
- `?bench=1&game=bench&arg0=50000&arg1=0|1`

## Setup

| tool | version | install |
|---|---|---|
| Node.js | 24.19.0 (`.nvmrc`, ≥ 20 works) | `nvm install` |
| Zig (C → wasm32 compiler) | 0.13.0 (`.zig-version`) | `brew install zig` or <https://ziglang.org/download/> |
| host C compiler + Python 3 | any (`cc`/clang/gcc; python3 stdlib) | for the x86 tools and the extractor (preinstalled on macOS/Linux) |
| Playwright Chromium | pinned by `package-lock.json` | `npx playwright install chromium` |

`npm run doctor` checks all three and prints fixes.

## Commands

| command | does |
|---|---|
| `npm run dev` | build games, start Vite |
| `npm run build` | build games + production bundle in `dist/` |
| `npm run bundle -- --game <id>` | static bundle with only that game (default page) in `dist-bundle/`, for hosting |
| `npm test` | unit tests (ABI layout vs header, decoder, host safety, sample L3 headless, tools) |
| `npm run test:e2e` | browser tests: WebGL 2, WebGPU (skips without an adapter), fallback, robustness |
| `npm run test:port` | your port's private browser tests (`port/tests/`) |
| `npm run inspect` | read-only inventory of `original/` → `reports/inventory.json` |
| `npm run extract -- IN OUT` / `npm run analyze -- FILE` | static unpacking / x86 analysis + disassembly |
| `npm run oracle -- <gameDir>` | differential oracle: lifted vs interpreted builds |
| `npm run trial:record -- <gameDir> <slug>` | trial record (`trial.json` + port note) for the trials repo |
| `npm run report` | validate + redact `reports/`, write `reports/summary.md` |
| `npm run leakcheck` | fail if private game data/secrets could be committed (also a pre-commit hook); `-- --against DIR` adds extracted payloads as reference |
| `npm run bench` | batched command buffer vs per-sprite import calls → `reports/bench.md` |
| `npm run lint` / `typecheck` | ESLint + C `-Werror` compile check / `tsc` |

## Layout

```
bgt/            ABI (include/bgt.h, abi/ABI.md) + TypeScript runtime, renderers, input, audio, storage
examples/       sample2d (reference game), bench
port/           your port (private, git-ignored)
original/       your game files (private, git-ignored, read-only to tools)
tools/          inspect, build, assets, report, bench
tests/          unit (Vitest), e2e (Playwright)
.claude/        skills + agents used by "Port this game"
reports/        porting state and evidence (private by default)
```

## Status and honesty

See [`docs/verification.md`](docs/verification.md) for what was actually verified in this
release, and on which hardware. In particular, **iPhone Safari has not been verified on a
physical device** by the kit's automated suite. Desktop WebKit/emulation is not a substitute.

## Legal

Only process games you are authorized to use. Owning a copy may not authorize redistribution
or circumventing protections in your jurisdiction. The kit does not bypass DRM, activation or
anti-cheat, and never commits original game files. Kit source is MIT ([LICENSE](LICENSE)).
The sample game's code and assets are CC0-1.0.
