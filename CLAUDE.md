# Game Cask — operating rules for Claude Code

Game Cask restores legally obtained legacy games as browser games. Games run as C compiled to
wasm32 against the **Game Cask Browser Target (BGT) ABI**. The runtime provides WebGPU/WebGL 2,
input, audio, storage and assets.

**Purpose of a port.** Ports are how this kit is tested and improved. A port succeeds when it shows
how far the kit's **systematic pipeline** carries a real game, and exactly where it needed help. Report
kit metrics, exceptions and friction first, and the game level second.

**When the user says "Port this game"**, follow the workflow below from step 1.

## Read first
1. `SPEC.md`: the brief and its success levels (L0–L5, §8).
2. `bgt/abi/ABI.md`: the ABI (v0.2). Port against it; do not change it.
3. `docs/pipeline.md`: how the conversion pipeline works and how to read its metrics.
4. `original/PROVENANCE.txt` or other user notes, if present. **Obey any POLICY there**
   (e.g. binary-only: never fetch or use upstream source or third-party descriptions of the game's internals).

## Principle: systematic conversion, minimal exceptions
Keep the original experience. Get there with a **uniform, reproducible conversion** rather than a per-game rewrite:

```
extract (installer/archive)  ->  analyze (imports, call graph)  ->  lift machine code to C
->  platform profile maps the OS/hardware API onto BGT by meaning  ->  oracle + browser tests
```

- The pipeline is the default for everything.
- **Exceptions** are the "minimal" part. They're hand-written C overrides of individual lifted functions
  (`overrides/`), each justified and counted. Examples: a function the lifter cannot handle, or an API the
  platform profile cannot express.
- Never rewrite game logic from genre knowledge. Never replace the pipeline with a hand-written emulator or
  interpreter for one game. If the pipeline or a profile lacks something general, that is a **kit gap**:
  record it (step 8) instead of working around the kit.

## Baseline (always, before a port)
```sh
npm run doctor && npm test && npm run test:e2e
```
Never start on a red baseline.

## Workflow ("Port this game")
| step | do | skill |
|---|---|---|
| 1 | `npm run inspect`: inventory, formats, platform, tools | `inspect-game` |
| 2 | Unpack installers/archives: `npm run extract -- original/X out/` (static, never executes) | `inspect-game` |
| 3 | `npm run analyze -- FILE`: imports, functions, call graph, jump tables, unsupported/FPU instructions. Use REA only if actually callable | `use-rea` |
| 4 | Write `port/game.json` with a `"pipeline"` section (platform, modules) | `implement-port` |
| 5 | `npm run build:port` → lift + compile; read the pipeline summary (generated vs hand-written LOC, generic insns, unresolved jumps) | `implement-port` |
| 6 | `npm run oracle -- port`: lifted vs interpreted builds must produce identical API traces | `browser-validation` |
| 7 | Browser tests in `port/tests/` → `npm run test:port` on WebGPU and WebGL 2: boot, interaction, one complete loop | `browser-validation` |
| 8 | Exceptions only where steps 5–7 prove them necessary: `port/overrides/*.c` (`X86_OVERRIDE(01002345)`), each listed with its reason. Kit gaps go in `reports/errors.json` (`"kind": "kit-gap"`) | `implement-port` |
| 9 | `npm run trial:record -- port <slug>` writes `trial.json` + a `NOTES.md` port note; `npm run report` | |
| 10 | Independent validation by a **separate** agent that did not write the port | `independent-validator` agent |

Non-x86 / non-Win32 games (DOS real mode, consoles) have no profile yet in v0.2. That is a kit gap to report,
together with what such a profile would need. Do not substitute a one-off emulator.

## Hard rules
- `original/` is read-only, private and never committed. `npm run leakcheck` must pass.
- Never execute original binaries on the host. Static analysis plus the kit's own builds in the browser only.
- No DRM/copy-protection/activation bypass. Stop and report it as blocked.
- Do not modify `bgt/`, `platforms/`, `tools/` or `tests/` (the kit) during a port. Kit gaps are findings.
- Ports are private by default (`port/game.json` `"private": true`).
- Label inference: anything not evidenced by the binary is `INFERRED`.
- Never claim a tool ran, a test passed or a level was reached when it did not. Strict levels:
  **booted (L1)** authentic first screen · **interactive (L2)** input changes visible state reproducibly ·
  **playable (L3)** one complete representative loop in the browser.
- Report hardware gates separately. Desktop emulation is not iPhone verification.

## Commands
| command | purpose |
|---|---|
| `npm run inspect` | read-only inventory of `original/` |
| `npm run extract -- IN OUTDIR` | static unpacking (zip, RCDATA-embedded PEs, Inno Setup 5.x) |
| `npm run analyze -- FILE [--disasm] [--func HEX]` | x86 PE analysis JSON / listing |
| `npm run build:port` | pipeline build of `port/` (prints conversion metrics) |
| `npm run oracle -- port [frames]` | differential oracle: lifted vs interpreted |
| `npm run test:port` | the port's browser tests → `reports/e2e-port-*` |
| `npm test` / `npm run test:e2e` | kit suites |
| `npm run trial:record -- port SLUG` | trial record for the trials repo |
| `npm run report` / `npm run leakcheck` | validate + redact reports / block private data |
| `npm run dev` | `http://localhost:5173/?game=<id>&debug=1` |

## Layout
- `bgt/`: ABI + browser runtime.
- `platforms/x86`: decoder, semantics, interpreter, lifted-code runtime.
- `platforms/win32`: Win32 profile.
- `tools/`: inspect, extract, x86 analyze/lift, build pipeline, report.
- `examples/`:
  - `sample2d`: native BGT game
  - `win32-hello`: pipeline example built from source
- `port/`: your port (private).
- `reports/`: porting state (private).
