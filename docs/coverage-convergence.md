# Coverage convergence and guest presentations (K21)

## Record → rebuild → rerun

The default `pipeline.selection: "coverage"` unions configured `pipeline.coverage` recordings with
`reports/coverage-inbox/<game-id>/*.json` and matching-game `reports/probe/coverage.json`. Successful probes
(including custom --out paths) and passing port browser tests publish content-addressed snapshots to this
private inbox. No address list or configuration edit is needed to lift a late interpreter owner. With no
recordings, retain full analyzed lifting, not an empty startup selection. The reviewer chose this default
rather than imposing all-analysis build/wasm costs on large games.

Inputs must match the exact module set, hashes and load bases. Stale evidence fails: archive/remove stale
inbox/latest files when deliberately replacing binaries; never edit evidence to make it fit. Failed,
outside-slice and overflowed runs remain diagnostic artifacts but are not automatically published.
A manually supplied overflowed or errored recording fails the build. Explicit recording lists still work.

Normal coverage JSON adds `interpreter: {capacity,dropped,entries}`. Every entry retains its actual address,
analyzed owner address (null if unowned), dynamic entry count and instruction count. This persistent recorder
is independent of the top-32 sampled CPU census and survives `profileReset()`. It also works with
`BGT_CPU_PROFILE=0`. The wasm-local table is bounded at 1,048,576 distinct entries with 16-probe hashing;
collisions/capacity/OOM drops are explicit, never evicted evidence. A 4 MiB index is allocated lazily, rows
grow geometrically to at most 24 MiB (growth temporarily needs old and new allocations). Any drop rejects
coverage-guided/strict builds; shorten the workload rather than filtering evidence. Strict builds omit this
recording, retain local membership checks and retain their first accepted startup entry.

Build selection uses **interior entries as roots**, maps them back to owners using current exact analysis,
and follows static call closure. Unknown/unowned code still needs analysis improvements. Lifting an owner
does not guarantee all its interiors/opcode forms run natively; rerun and inspect residual interpretation.

Each build records `pipeline.selection`, per-module `selection` (analyzed/selected counts, sorted owners,
recorded owners, interpreter owners and static-closure owners), plus sorted input paths, SHA-256, game
identity and historical counters in `pipeline.discovery.input_recordings`. Deterministic provenance names
the evidence and static closure; input interpretation counts are not predictions of rebuilt performance.

**All-analysis mode:** `pipeline.selection: "all"` or `npm run build:port -- --selection all` lifts every
statically analyzed function, regardless of configured coverage. Automatic recordings are ignored. This
does not prove analysis complete and can substantially increase compile/postprocess time and wasm size.

**Strict slices:** `--slice` / `slice.coverage` consume **only the supplied recordings**. Automatic evidence
cannot expand code or file-range packaging. `selection: "all"` with a slice is rejected, not silently widened.
Recorded interiors and selected owner ranges remain function-range granular, not instruction-level sandboxing.

## Updates are not frames

A BGT update is a cooperative scheduling boundary, **not a guest display/simulation frame**. Hundreds of
updates can contain only a handful of SwapBuffers calls. A 16 ms update does not establish 60 guest FPS.

Standard `diagnostics().metrics.execution_summary`, probe.json and probe console summaries report:

- `updates`, `elapsed_ms`, `updates_per_second`: host wall time since the first update began.
- `interpreter.instructions_per_update`, `estimated_ms_per_update`, `estimated_share` (fraction of cumulative
  host update wall time), `samples`, `coverage_dropped`, `analyzed_code_interpreted`, and `top_owners`
  (owner address and exact entry/instruction counts, ranked by instructions). Owner=null stays unowned.
- Interpreter timing samples the **exclusive fallback dispatch/semantics path**, including decode/entry work,
  excluding nested native/callback/scheduler work and parked-yield time. This is a sampled estimate, not CDP
  self-time or hardware counters. Sparse/biased samples can still extrapolate above wall time; the fraction
  is not clamped or advertised as a disjoint exact budget. Disabled timing or no samples with nonzero
  interpretation is null, not guessed zero. Fully lifted execution with enabled timing reports zero.
- `guest_frames.count`, `swaps`, `gdi_presents`, `per_second`, `frame_ms_avg/p95`, `intervals_measured`.
  Successful GL SwapBuffers calls count as swaps. GDI flushes containing new **guest screen** drawing count
  as GDI presentations; offscreen-only work, chrome and repeated host redraws do not. These are presentation
  events, not proof of independently simulated frames or physical display scanout.
- Guest intervals use actual wall timestamps, include waits/probe pauses, and retain the last 10,000 presents
  (9,999 intervals). Fewer than two presents gives null avg/p95; no-present rate is zero over a nonempty
  observation. `timestamps_ms` supports explicit shorter-window analysis. Native BGT games/older artifacts
  without the optional export report guest_frames=null, not fictitious frames.

Probe output puts updates/s **next to guest presents/s**, guest interval avg/p95 and interpreter
ms/instructions per update, retaining the same structured summary. Rates include script think time; label
paused/stepped workloads. Legacy coverage `frame_ms_avg/p95` remain render-completion timings, **not guest
frame intervals**. CPU census category timers remain inclusive historical diagnostics; never derive the
new share by summing/subtracting those overlapping categories.

## Original CC0 regression and costs

`tests/fixtures/coverage/discovery.S` delays an indirect 70,000-NOP body until after the initial recording,
then enters its interior continuation. `tests/unit/coverage.test.ts` verifies the first selective build
interprets 70,003 instructions, normal recorded evidence → rebuild lifts it with zero interpretation,
each update trace matches, and the strict supplied-evidence package matches the interpreter reference.
`execution-metrics.test.ts` checks exact persistent counts with profiling off/on, reset independence,
visible overflow, nested timing exclusion, 19 presentations independent of 600 updates, and ring wrap.

Reproduce scale selection costs: `npm exec -- vitest run --config tools/bench/selection.config.ts`.
`BGT_SELECTION_COUNTS=256,12000` is the default. Same generated PE per early-coverage/all pair; 300 per-update
trace hashes must match. Reports include resources, cache states, selected/analyzed function counts, wasm
bytes and build/runtime times. These are shared-machine CC0 costs, not game-speed or cold/idle claims.
See [K21 handoff](handoff/K21.md) for measured results and gates.
