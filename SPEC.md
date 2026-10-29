# Game Cask Kit — Implementation Specification (v0.1)

> **Instructions for Claude Code:** Build the complete starter kit described below, then spawn a separate porting subagent to exercise it against one game supplied by the user in `original/`. This document is the implementation brief, not a claim that the kit already exists. Do not stop after scaffolding: build, run, test, and report verified results. Do not claim a game was ported if it was not playable and tested.

## 0. Objective

Create an agent-first, reproducible starter kit for restoring legally obtained legacy games as playable browser experiences. Users place their original files in `original/`, open Claude Code, and request **"Port this game."** Claude Code uses reverse-engineering tooling (REA when available), selectively reconstructs or replaces original subsystems, targets a stable Game Cask Browser Target (BGT) API, and iteratively validates the result in a browser. A **separate subagent** must then act as the first user of the starter kit against an actual game provided in `original/`.

**Principle:** Preserve the *observable game experience*, not the original instruction stream. Preserve gameplay-significant behavior; allow reimplementation of rendering, resource loading, input, audio, storage, and OS glue. Record all deviations and unknowns. Do not silently claim exact fidelity.

**Primary device:** iPhone Safari (hardware verification required for claims of device support). **Additional targets:** desktop Safari, Chromium, Firefox. **Graphics:** WebGPU first; WebGL 2 fallback. **Logic:** C/C++ → WebAssembly as default; isolate any small TypeScript browser glue in the runtime, not in individual ports.

## 1. Scope and non-goals

### Must ship in v0.1

- Runnable, self-contained *example* 2D game (original sample code/assets included) compiled from C to Wasm and rendered through BGT. No private game files required to verify the kit.
- A versioned, C-compatible BGT ABI for game lifecycle, input, time, 2D graphics, audio, and virtual file reads; browser runtime handles GPU, browser event loop, persistence and asset requests.
- WebGPU renderer with a working WebGL 2 fallback, both exercised by automated tests. Permit a modest subset of 2D operations in v0.1.
- An explicit command-list/data-oriented rendering interface to reduce high-frequency Wasm↔JS crossings. Batch recording; measure against a direct-call reference rather than assuming batching is always faster.
- A normal dev/build/test flow (`npm run dev`, `build`, `test`, `test:e2e`, `inspect`, `report`).
- Browser debug/test interface for deterministic stepping, scripted input, screenshots, errors, and runtime metadata.
- `CLAUDE.md` and focused Claude Code skills/subagents for discovery, binary analysis, assets, implementation, and independent validation.
- A sandboxed, read-only `original/`, private by default and excluded from Git. Reports must redact original binaries and sensitive paths.
- One real-game trial from the user's legally supplied files, conducted by a *separate spawned subagent* using only the published starter-kit instructions and tools. Capture honest pass/fail evidence.

### Explicit non-goals in v0.1

- Arbitrary Windows/Linux/macOS/console binary execution, kernel/OS emulation, universal binary lifting, or general 3D compatibility.
- Reproducing proprietary DRM, bypassing online activation, anti-cheat, or security protections.
- A hosted uploading service, multiplayer, cloud saves, commercial game redistribution, or fully automatic success on any input.
- A custom universal shader compiler, Vulkan/DirectX compatibility layer, or exhaustive asset-format support.

## 2. Deliverables and repository layout

Use this organization (adjust names only with a documented reason):

```text
game-cask/
  README.md
  SPEC.md                     # this specification, copied verbatim
  CLAUDE.md                   # concise operating rules and first command
  LICENSE
  .gitignore
  .claude/
    skills/
      inspect-game/SKILL.md
      use-rea/SKILL.md
      recover-assets/SKILL.md
      implement-port/SKILL.md
      browser-validation/SKILL.md
    agents/
      game-analyst.md
      game-porter.md
      independent-validator.md
  original/.gitkeep           # ONLY locally supplied user files go here
  examples/sample2d/         # tiny permissively licensed source + assets
  port/                      # generated game code (initially sample or stub)
  bgt/
    include/bgt.h
    abi/ABI.md
    runtime/                 # TypeScript browser integration
    renderers/webgpu/
    renderers/webgl2/
    audio/
    input/
    storage/
  tools/
    inspect/                 # file/format detection; deterministic tooling
    build/                   # WASI/wasm32 or freestanding clang adapter
    assets/                  # extracted asset transforms and manifests
    report/                  # report synthesis and redaction
  tests/
    unit/
    e2e/
    fixtures/
  web/
    index.html
    src/
  reports/.gitkeep
  package.json
  tsconfig.json
  vite.config.ts
  playwright.config.ts
  .github/workflows/ci.yml
```

Avoid committing `original/**`, proprietary assets, decrypted game content, reference captures that contain copyrighted material, generated binary blobs from private games, keys, credentials, or environment secrets. Include explicit negative checks in CI for accidental private-file commits.

## 3. Game Cask Browser Target (BGT) ABI v0.1

Document a stable binary ABI in `bgt/abi/ABI.md` and provide a C header. Use fixed-width types, defined struct packing/alignment, little-endian values, explicit string lengths, integer resource handles, explicit error codes, and a single linear Wasm memory in v0.1. Avoid per-frame allocation and object marshaling across the boundary.

### Game exports (illustrative; choose names/signatures and freeze them)

```c
int32_t bgt_init(uint32_t config_ptr);
void    bgt_update(uint32_t dt_microseconds);
void    bgt_render(void);
void    bgt_shutdown(void);
```

### Runtime imports (illustrative)

```c
uint32_t bgt_asset_open(uint32_t path_ptr, uint32_t path_len);
int32_t  bgt_asset_read(uint32_t handle, uint32_t dst_ptr, uint32_t size);
void     bgt_submit_commands(uint32_t ptr, uint32_t byte_len);
void     bgt_log(uint32_t level, uint32_t ptr, uint32_t byte_len);
```

Specify full lifecycle and synchronous/asynchronous asset policy carefully: preferably preload assets asynchronously before `bgt_init`, then present synchronous reads from an in-memory VFS for simplicity. Provide explicit input snapshots, audio sample submission, capability queries, sizing rules, resource lifetime and device-loss behavior. Never expose raw JS/WebGPU objects through the game ABI.

### v0.1 graphics subset

- Clear, viewport, textured rectangle/sprite draw, transform, scissor, alpha blend, nearest/linear sampling, primitive triangle draw where needed.
- Texture create/update/delete with integer handles, and resource validation.
- Binary command stream: opcode, payload length, version, alignment, bounds checks, total byte limit, and deterministic decoding.
- One canonical set of operations and visual conformance tests shared across WebGPU and WebGL 2.
- Batch by pass/command list; avoid one import per sprite. Do not require expensive arbitrary reordering that alters draw order or blending.
- Treat unsupported features as explicit capability errors, not silent no-ops.

### Security

Validate every Wasm memory range and command payload before use. Limit resource counts, upload sizes, command lengths, render target sizes and CPU work per frame. Handle malformed/untrusted modules without escaping the browser sandbox.

## 4. Browser runtime and mobile support

- Use Vite + TypeScript for browser shell/build tooling; native game simulation stays in Wasm.
- Choose WebGPU when device/context initialization succeeds; otherwise initialize WebGL 2. Handle loss of WebGPU device and WebGL context.
- Prefer a canvas layout that respects DPR, CSS resizing, orientation, touch/pointer events, gamepad and keyboard input.
- Include mobile touch control overlay in the sample, with configurable mapping. Do not claim actual iPhone Safari support from desktop emulation alone.
- User-triggered audio unlock; Web Audio AudioWorklet optional, basic audio viable without it. No autoplay assumptions.
- Asset loading should be chunked/manifest-driven; show progress and errors. Use content hashes for cache keys.
- Keep runtime observability first-class: GPU backend, resource sizes, frame times, Wasm memory size, logs, and errors.
- Maintain accessible fallback/error UI when hardware requirements aren't satisfied.

## 5. Deterministic browser E2E contract

Implement debug-only `window.__BGT_TEST__` with typed methods:

```ts
interface BGTTestAPI {
  ready(): boolean;
  pause(): void;
  step(frames: number): Promise<void>;
  input(events: BGTTestInputEvent[]): void;
  screenshot(): Promise<Blob>;
  diagnostics(): BGTDiagnostics;
  stateHash(): string | null;
  backend(): 'webgpu' | 'webgl2' | 'unavailable';
}
```

`step(frames)` must advance a fixed simulation timestep and await render completion sufficiently for screenshot capture; document where GPU results are nondeterministic. `stateHash()` may return null unless the game explicitly exports stable deterministic state. Require tests for boot, input-induced motion, visual checkpoints, malformed commands, resize, and intentional WebGL fallback. Use screenshot tolerances for cross-GPU differences, not bitwise pixel equality everywhere.

Playwright is the primary harness. Prefer software rendering only for functional tests; keep hardware-backed GPU and real iOS Safari smoke tests as separately reported gates. Browser tests must collect JS exceptions, Wasm traps, GPU validation failures, unexpected missing assets, and console errors.

## 6. Claude Code operating model

`CLAUDE.md` must instruct the agent to:

1. Read `SPEC.md` and `bgt/abi/ABI.md` before changing code.
2. Start with `npm test && npm run test:e2e` on the clean sample to establish a known-good baseline.
3. Inspect `original/` and identify candidate executable(s), assets, likely format, import tables, dependencies, and confidence in platform/engine assumptions.
4. Use REA via configured MCP/tools **only when available**. Never pretend an unavailable tool ran. If REA is absent, document installation/connection steps and continue with available read-only deterministic analysis tools.
5. Choose preservation boundaries by subsystem: `preserve`, `reconstruct`, `replace`, or `selective-emulate`. Prioritize original gameplay, recognizable visuals, audio and meaningful user interaction.
6. Produce a short written plan and machine-readable `reports/subsystems.json` with evidence and unknowns.
7. Implement into `port/` using the published BGT ABI; avoid patching the platform runtime for game-specific behavior unless a general capability is genuinely missing.
8. Build, open in browser, exercise the actual game (not only sample), capture evidence, diagnose failures, iterate, and record results.
9. Never invent missing original logic without labeling it as inferred, and never misstate observed verification.
10. Deliver a report with exactly which gameplay features were observed and tested, user interaction needed, errors, limitations, performance, and next steps.

### Agent/subagent separation

- **Builder agent:** implements starter kit + tests, independent of user game specifics.
- **Porting subagent:** spawned *after* sample/CI pass. Receives `CLAUDE.md`, game directory, approved tools, and a task to port the game through the public kit only. Must not rewrite the kit's shared ABI to obtain a pass.
- **Validation subagent:** independent from the porting subagent; confirms claims from browser logs, screenshots, test traces, and optional native reference captures. The validator may reject unsupported claims and must distinguish “booted,” “interactive,” and “playable.”

If the Claude Code execution environment cannot spawn subagents, report that honestly and provide a reproducible standalone command/instruction for a fresh independent agent run. Do not claim an independent validation occurred otherwise.

## 7. Porting workflow and reporting

Each attempt must keep resumable, structured state:

```text
reports/
  inventory.json
  analysis.md
  subsystem-map.json
  progress.json
  errors.json
  e2e-results.json
  validation.md
  final-report.md
```

Require fields for `source_evidence`, `confidence`, `implementation_strategy`, `status` (`unknown|in_progress|implemented|tested|verified`), and `known_deviations`. Treat any generated “looks correct” assertion as unverified until supported by reproducible tests or comparison captures.

The porting process is:

1. Inventory and classify binary/assets.
2. Recover game loop, asset semantics, control rules and observable scenarios.
3. Implement smallest interactive vertical slice with original assets when permitted.
4. Test browser boot, input, rendering, and one meaningful gameplay loop.
5. Broaden functionality; preserve or document rule differences.
6. Run browser E2E on WebGPU and WebGL 2; run physical iPhone checks when a device is available.
7. Produce an honest report; never silently lower success criteria.

Original files remain user-provided and local. If no valid game is present, run the sample and mark the separate real-game trial **blocked: no user game provided**. Never fetch or invent commercial game binaries.

## 8. First-game acceptance and success levels

Define clear levels:

- **L0 — inspected:** original binary/files identified; no game execution claim.
- **L1 — boots:** generated game initializes to title/menu or an authentic initial screen.
- **L2 — interactive:** input changes visible game state reliably.
- **L3 — playable slice:** one representative authentic gameplay loop can be completed.
- **L4 — substantial port:** multiple scenarios, assets, audio and saves verified.
- **L5 — preservation-quality candidate:** broad scenario coverage, comparison evidence, documented differences and platform tests.

For v0.1, the sample must reach **L3** with automated tests and actual WebGPU/WebGL2 fallback coverage. The separate owned-game trial should *attempt* L3; record actual achieved level, including L0 or blocked. Do not make success on an unknown commercial binary a prerequisite for completing the starter kit itself.

## 9. Build and CI requirements

- Pin runtime versions and lockfiles; add deterministic setup instructions for Node, LLVM/Clang/Emscripten (choose one well-supported toolchain), and Playwright browsers.
- Avoid depending on unavailable external binaries for the sample test.
- `npm run inspect` must be read-only and tolerate empty `original/`.
- CI runs typecheck, unit tests, Wasm sample build, WebGL2 fallback E2E, lint, and private-asset leak checks. WebGPU hardware validation may be a separate opt-in job.
- Provide useful failure messages for missing compilers/browsers or unsupported GPU environments.
- Add benchmark mode measuring command submission, Wasm frame logic, JS bridge, browser GPU submission and actual frame time where measurable. Do not conflate those metrics.

## 10. Ownership and security

- Users must provide only games they are authorized to process. Possession of a copy alone may not authorize redistribution or bypassing protections in all jurisdictions.
- Never include original proprietary code/assets in repository, CI artifacts or reports without explicit rights and permission.
- Do not attempt DRM bypass, license circumvention, anti-cheat bypass or unauthorized access. Identify and report blocked dependencies.
- Reverse-engineering inputs and decompressed archives are untrusted; isolate execution and tool processes from credentials, personal directories and unrestricted network access. Prefer disposable VM/container testing for original executables.
- Keep generated game ports private by default unless user chooses to publish and has appropriate rights.

## 11. Acceptance checklist for starter-kit builder

- [ ] Fresh clone installs dependencies and runs the sample without any user game files.
- [ ] Sample C/Wasm game runs with keyboard/touch input.
- [ ] WebGPU and WebGL2 backends render the same defined 2D feature set.
- [ ] E2E tests verify actual state change and capture screenshots.
- [ ] Debug stepping is deterministic at the simulation layer.
- [ ] `CLAUDE.md`, skills and subagent definitions are actionable and noncontradictory.
- [ ] REA integration documented, with feature detection and honest no-REA fallback.
- [ ] `original/` protected from commits and accidental uploads.
- [ ] Separate porting subagent attempts a user-provided game (or reports blocked if absent).
- [ ] Independent validator reports verified evidence, not narrative confidence.
- [ ] `README.md` tells user: copy game to `original/` → run `claude` → say “Port this game”.

## 12. Execution instruction for Claude Code

**Build this repository now.** Plan briefly, implement the smallest complete vertical slice, install dependencies, compile the sample, run browser E2E, fix issues, and document results. Then **spawn the separate porting subagent** to use the *published kit* on the game already present in `original/`; ask for files only if none exist, without manufacturing a game or claiming the real-game trial passed. Have the independent validator inspect the resulting test artifacts. Commit only starter-kit source, examples and safe reports. End with a concise, evidence-linked status showing which checklist items passed, which were blocked, and the exact command to launch the sample and any verified port.
