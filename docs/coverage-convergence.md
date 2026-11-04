# Coverage convergence and guest presentations (K21)

## Record → rebuild → rerun

The default `pipeline.selection: "coverage"` unions configured `pipeline.coverage` recordings with
`reports/coverage-inbox/<game-id>/*.json` and matching-game `reports/probe/coverage.json`. Successful probes
(including custom --out paths) and passing port browser tests publish content-addressed snapshots to this
private inbox. Port-test publication is performed by the configured Playwright final-outcome reporter,
after every fixture teardown (including browser error collection) has passed; expected-failure tests are not
evidence. Custom Playwright configs must include `tests/e2e/coverage-evidence-reporter.ts` to publish.
No address list or configuration edit is needed to lift a late interpreter owner. With no
recordings, retain full analyzed lifting, not an empty startup selection. The reviewer chose this default
rather than imposing all-analysis build/wasm costs on large games.

Every nonslice input must name the exact game ID; each individual input (not just their union) must match
all module names, hashes and load bases. Strict supplied recordings may keep the original recording's game ID
when packaging under a new ID, but must match the same complete modules. Stale evidence fails: archive/remove
stale inbox/latest files when deliberately replacing binaries; never change hashes, bases or addresses to fit.

For an old recording missing a game ID, or an intentional game-ID rename of the **same binaries**, explicitly
adopt its identity against an existing build manifest (paths are from the current directory):

```sh
node tools/build/coverage-adopt.mjs --input port/coverage/legacy.json --manifest web/public/games/GAME-ID/manifest.json --out port/coverage/adopted.json
```

Then replace the configured path with `coverage/adopted.json`. Pipeline preparation validates evidence in a
private temporary output before replacing the last build, so a rejected recording leaves the manifest needed
by this command intact. The command never overwrites, changes module
identity, edits executed entries/ranges/counters, or filters evidence. It requires exact per-input module equality
and writes deterministic adoption provenance (source game/path/SHA-256, target manifest path/SHA-256 and previous
adoption if any). A stale manifest cannot authorize changed modules at the next build: current module validation
still runs. If no manifest exists, a separate explicit `--selection all` build can create one; it may be expensive.
A changed binary/base or incomplete module set requires a new recording, not adoption. Failed,
outside-slice and overflowed runs remain diagnostic artifacts but are not automatically published.
A manually supplied overflowed or errored recording fails the build. Explicit recording lists still work.

Normal coverage JSON adds `interpreter: {capacity,dropped,entries}`. Every entry retains its actual address,
analyzed owner address (null if unowned), dynamic entry count and instruction count. This persistent recorder
is independent of the top-32 sampled CPU census and survives `profileReset()`. It also works with
`BGT_CPU_PROFILE=0`. The wasm-local table is bounded at 1,048,576 distinct entries with 16-probe hashing;
collisions/capacity/OOM drops are explicit, never evicted evidence. A 4 MiB index is allocated lazily, rows
grow geometrically to at most 24 MiB (growth temporarily needs old and new allocations). Standard diagnostics scan rows in place and retain only
owner aggregates, avoiding a full address-list copy/sort on each metrics read. Explicit coverage snapshots still
copy/sort all recorded entries. Any drop rejects
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
statically analyzed function, regardless of configured coverage. Configured and automatic recordings are ignored, including stale evidence; no coverage provenance is claimed in this mode. This
does not prove analysis complete and can substantially increase compile/postprocess time and wasm size.

**Strict slices:** `--slice` / `slice.coverage` consume **only the supplied recordings**. Automatic evidence
cannot expand code or file-range packaging. `selection: "all"` with a slice is rejected, not silently widened.
Recorded interiors and selected owner ranges remain function-range granular, not instruction-level sandboxing.

## Updates are not frames

A BGT update is a cooperative scheduling boundary, **not a guest display/simulation frame**. Hundreds of
updates can contain only a handful of SwapBuffers calls. A 16 ms update does not establish 60 guest FPS.

Standard `diagnostics().metrics.execution_summary`, probe.json and probe console summaries report:

- `suspension`: the active `asyncify` or `jspi` artifact, not merely the requested/preferred package variant.
- `updates`, `elapsed_ms`, `updates_per_second`: host wall time since the first update began.
- `interpreter.instructions_per_update`, `estimated_ms_per_update`, `estimated_share` (fraction of cumulative
  host update wall time), `samples`, `coverage_dropped`, `analyzed_code_interpreted`, and `top_owners`
  (owner address and exact entry/instruction counts, ranked by instructions). Owner=null stays unowned.
  Missing observation exports yield null owner rankings/classification; an empty strict recorder with nonzero
  interpretation is unknown, not proof that no analyzed code was interpreted.
- Interpreter timing measures **disjoint exclusive fallback spans**, including decode/entry work and
  instrumentation inside those spans. Clocks are read only at interpreter/native/thunk/scheduler transitions
  (not each instruction); nested interpretation counts once. Yield closes before unwind/parking and reopens
  after resume; return/transfer closes the span. `interpreter_exclusive_us` is cumulative, non-extrapolated
  monotonic host wall time, in the same clock domain as `host_profile.updateMs`, not CPU hardware time.
  Pipeline guest execution starts inside update, never init/render. Census reset does not reset timing.
  `measured_ms`/`measured_ms_per_update` and compatibility `estimated_*` keys use only these spans;
  `timing` is `measured-exclusive-spans`. An available share is necessarily in [0,1]. Disabled/legacy
  observation is null (`timing_status: disabled/unavailable`); nonfinite/negative time is unavailable, and
  a measurement beyond the cumulative update budget is null with `invalid-update-budget`, not clamped.
  This detects an out-of-domain invocation or broken accounting rather than hiding it. Fully lifted
  execution with enabled timing reports measured zero. Raw `interpreter_samples`,
  `interpreter_exclusive_sample_us` and `interpreter_exclusive_estimated_us` remain **sample diagnostics only**:
  extrapolating timer overhead from tiny sampled dispatches caused Q73 (>100%); a large sample count
  does not remove this systematic bias. Do not use their extrapolation as a physical share.
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
The integration matrix repeats the loop under default/partitioned Asyncify, JSPI-preferred and JSPI-only.
Run `BGT_TEST_JSPI=1 npx vitest run tests/unit/coverage.test.ts --maxWorkers=1 --testTimeout=600000`
for real Node JSPI; ordinary Node additionally checks unsupported-JSPI rejection/fallback.
`execution-metrics.test.ts` checks exact persistent counts with profiling off/on, reset independence,
visible overflow, nested timing exclusion, 19 presentations independent of 600 updates, and ring wrap.

Reproduce scale selection costs: `npm exec -- vitest run --config tools/bench/selection.config.ts`.
`BGT_SELECTION_COUNTS=256,12000` is the default. Same generated PE per early-coverage/all pair; 300 per-update
trace hashes must match. Reports include resources, cache states, selected/analyzed function counts, wasm
bytes and build/runtime times. These are shared-machine CC0 costs, not game-speed or cold/idle claims.
See [K21 handoff](handoff/K21.md) for measured results and gates.
