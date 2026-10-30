# Game Cask — operating rules for every agent harness

`AGENTS.md` points here; this is the single source of rules. Role briefs are ordinary files in
`.claude/agents/`. Read skills by path: `.claude/skills/<name>/SKILL.md` (also exposed through
`.agents/skills`). No particular tool name or subagent API is required: use your harness's file, shell and image
viewing tools. Independent validation requires a separate fresh agent/session; if unavailable, report that gate.
These port restrictions apply to **porting**, not an explicitly requested kit-development task.
See `docs/trials.md` for isolated trial setup with Claude Code or pi.

Game Cask restores legally obtained legacy games as browser games. Games run as C compiled to
wasm32 against the **Game Cask Browser Target (BGT) ABI**. The runtime provides WebGPU/WebGL 2,
input, audio, storage and assets.

**Purpose of a port.** Ports are how this kit is tested and improved. A port succeeds when it shows
how far the kit's **systematic pipeline** carries a real game, and exactly where it needed help. Report
kit metrics, exceptions and iteration requests first, and the game level second.

**When the user says "Port this game"**, follow the workflow below from step 1. If a trial brief exists
(`reports/brief.md`, made by `npm run trial:brief`), it adds the trial's rules; obey it. A launcher-selected
slice is the L3 definition and packaging scope; never silently lower it.

## Read first
1. `SPEC.md`: the brief and its success levels (L0–L5, §8).
2. `bgt/abi/ABI.md`: the ABI (v0.3 additive implemented subset; see §12 and docs/v03-status.md). Port against it; do not change it.
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
  (`overrides/`), each justified and counted. Example: a function the lifter provably cannot handle.
- Never rewrite game logic from genre knowledge. Never replace the pipeline with a hand-written emulator or
  interpreter for one game. If the pipeline or a profile lacks something general, that is a **kit gap**: it becomes
  an **iteration request** (below), never a workaround.

## Done means: every observed problem is resolved (the work queue)
Reaching a level is **not** the end of a port. Every problem you observe (a fault, a wrong pixel, a clipped label, a
stub, a metric that looks wrong, a test that is weaker than its name) goes on the **work queue** in
`reports/progress.json`:

```json
"queue": [{ "id": "Q1", "symptom": "...", "evidence": ["test/screenshot/metric/address"],
            "layer": "lifter|semantics|platform-profile|renderer|test|game",
            "status": "open|fixed|authentic|iteration-request", "next": "..." }]
```

- **Localize before reporting.** No item stays "unverified". Trace each one to its layer with the oracle (lifter),
  the metrics and fault messages (profile), the probe (`npm run probe`), the resource tour, `peek` and the
  disassembly. `game` means the original program does exactly this (authentic), proven from the binary.
- The port is done only when every item is one of:
  - `fixed`: with proof (a test that fails without the fix, or before/after evidence);
  - `authentic`: proven to match the original's behaviour from binary evidence (code address, resource, data);
  - `iteration-request`: the fix needs a kit change (below).
- **Iteration requests.** A fix in `bgt/`, `platforms/`, `tools/` or `tests/` is a kit change. Do not make it and
  do not stop silently: record the item as `iteration-request` (and in `reports/errors.json`, `"kind": "kit-gap"`)
  and keep working on everything else. Your final reply **leads** with "Iteration requests": per item the symptom,
  the evidence, the layer, the concrete kit change needed (in Win32/API or ABI terms, not game terms) and what you
  will verify once it lands. The kit developer makes the change, then you are resumed.
- **Resume mode.** When you continue an existing `port/` + `reports/` (e.g. after a kit iteration): read
  `reports/progress.json` first, then `npm run build:port`, `npm run oracle -- port`, `npm run test:port`, and
  re-check **every** queue item against the new kit before new work. Update each item's status with fresh evidence.

## Baseline (always, before a port)
```sh
npm run doctor && npm test && npm run test:e2e
```
Never start on a red baseline. (Kit suites never build or run `port/`.)

## Workflow ("Port this game")
The skill column names paths under `.claude/skills/`: read `<skill>/SKILL.md` before that step.

| step | do | skill |
|---|---|---|
| 1 | `npm run inspect`: inventory, formats, platform, tools | `inspect-game` |
| 2 | Unpack installers/archives: `npm run extract -- original/X out/` (static, never executes) | `inspect-game` |
| 3 | `npm run analyze -- FILE`: imports, functions, call graph, jump tables, data seeds, unsupported/FPU instructions. Use REA only if actually callable | `use-rea` |
| 4 | Write `port/game.json` with a `"pipeline"` section (platform, modules) | `implement-port` |
| 5 | `npm run build:port` → lift + compile; read the pipeline summary (generated vs hand-written LOC, generic insns, unresolved jumps, data seeds) | `implement-port` |
| 6 | `npm run oracle -- port`: lifted vs interpreted builds must produce identical API traces | `browser-validation` |
| 7 | Browser tests in `port/tests/` → `npm run test:port` on WebGPU and WebGL 2: boot, interaction, one complete loop. Run the **resource tour** and review screenshots with the **visual checklist** | `browser-validation` |
| 8 | Work the queue: localize each item, fix what is port-side (tests, configuration, overrides with evidence), file iteration requests for kit gaps. Repeat 5–8 until every item is resolved | `implement-port` |
| 9 | `npm run trial:record -- port <slug>` writes `trial.json` + a `NOTES.md` port note; `npm run report` | |
| 10 | Independent validation by a **separate** agent that did not write the port | `independent-validator` agent |

Non-x86 / non-Win32 games (DOS real mode, consoles) have no profile yet. **Win64 execution and OpenGL are also
still gaps on this partial v0.3 branch**: metadata inspection is not execution support. Consult docs/v03-status.md. That is an iteration request,
together with what such a profile would need. Do not substitute a one-off emulator.

## Hard rules
- `original/` is read-only, private and never committed. `npm run leakcheck` must pass.
- Never execute original binaries on the host. Static analysis plus the kit's own builds in the browser only.
- No DRM/copy-protection/activation bypass. Stop and report it as blocked.
- Do not modify `bgt/`, `platforms/`, `tools/`, `tests/` or `examples/` (the kit) during a port. Needed kit changes are
  iteration requests (see above), not workarounds and not overrides.
- Ports are private by default (`port/game.json` `"private": true`).
- Label inference: anything not evidenced by the binary is `INFERRED`.
- Never claim a tool ran, a test passed or a level was reached when it did not. Strict levels:
  **booted (L1)** authentic first screen · **interactive (L2)** input changes visible state reproducibly ·
  **playable (L3)** one complete representative loop in the browser.
- Every port test states the breakage it would catch and asserts a change (see `browser-validation`).
- Leave the developer's dev server (`:5173`) alone. Tests and probes start their own.
- Report hardware gates separately. Desktop emulation is not iPhone verification.

## Commands
| command | purpose |
|---|---|
| `npm run inspect` | read-only inventory of `original/`; `-- --strings FILE` (ASCII + UTF-16, PE resource text; stdout only) |
| `npm run extract -- IN OUTDIR` | static unpacking (zip, RCDATA-embedded PEs, Inno Setup 5.x) |
| `npm run analyze -- FILE [--disasm] [--func HEX]` | x86 PE analysis JSON / listing |
| `npm run build:port` | pipeline build of `port/` (prints conversion/scale metrics) |
| `npm run build:port -- --slice COVERAGE.json` | strict code/data slice from a recorded loop; CLI paths from repo root, config paths from port/ |
| `npm run oracle -- port [frames]` | differential oracle: lifted vs interpreted |
| `npm run test:port` | the port's browser tests → `reports/e2e-port-*` |
| `npm run probe -- --game ID --script FILE.mjs` | scripted exploration in headless Chromium (no spec) → `reports/probe/` |
| `npm test` / `npm run test:e2e` | kit suites (never touch `port/`) |
| `npm run trial:setup -- --kit COMMIT --game FILE --dir NEW_PATH [--slice TEXT]` | operator: isolated clone, npm ci, copy input, write brief |
| `npm run trial:brief -- --game FILE --slug SLUG [--slice TEXT]` | write the trial brief → `reports/brief.md` |
| `npm run trial:record -- port SLUG` | trial record for the trials repo |
| `npm run report` / `npm run leakcheck` | validate + redact reports / block private data |
| `npm run dev` | `http://localhost:5173/?game=<id>&debug=1` |

## Layout
- `bgt/`: ABI + browser runtime.
- `platforms/x86`: decoder, semantics, interpreter, lifted-code runtime.
- `platforms/win32`: Win32 profile.
- `tools/`: inspect, extract, x86 analyze/lift, build pipeline, probe, report.
- `tests/support/`: helpers for port tests (`tour.ts` resource tour, `evidence.ts` change assertions).
- `examples/`:
  - `sample2d`: native BGT game
  - `win32-hello`: pipeline example built from source (menu, dialog, message box)
  - `win32-conformance`: Win32 profile conformance fixture (loader, GDI pixel reads)
- `port/`: your port (private).
- `reports/`: porting state (private).
