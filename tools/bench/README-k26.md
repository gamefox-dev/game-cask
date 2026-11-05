# K26 timing and postprocess attribution (original CC0)

No game inputs, network or dependency installs. Run serially with the installed kit tools;
set BGT_TRIAL_SCRATCH to a private writable scratch directory outside the clone.

- `BGT_BUILD_JOBS=2 npm test -- --config tools/bench/attribution.config.ts`
  archives local dev14 4bcc068 and dev15 3cbcb25, symlinks installed packages except their
  writable .cache, generates one 2048-owner x64-scale PE, and captures linked wasm before
  postprocess. All subsequent source/profile variants use that exact PE. Each raw module
  is transformed with whole O2, whole fixed local passes, and forced 8MiB partitions.
  A third source configuration disables C profiling but retains default coverage.
  Nine variants, one discarded warmup plus five fresh GameHosts,300 updates/instance,
  every per-update hash equal, interp0/stubs[], original checksum output required.
  Report: $BGT_TRIAL_SCRATCH/attribution-b.json. Temporary archives/wasm are removed
  after success. Do not reuse a failed scratch directory without inspecting/cleaning
  only that owned directory. Full function/body lengths are retained in the report.
- `npm test -- --config tools/bench/interpreter-clock.config.ts` measures one million
  imported monotonic/constant clock calls, arithmetic baseline and one million actual
  enter/exit span pairs; nine raw samples and exact import-call assertions per row.
  Report: $BGT_TRIAL_SCRATCH/continue/clock.json (create continue/ first).
- `BGT_TEST_JSPI=1 npm test -- --maxWorkers=1 tests/unit/interpreter-spans.test.ts tests/unit/interpreter-dispatch-spans.test.ts tests/unit/execution-metrics.test.ts`
  covers hand-clock timing, real decoding/semantics/dispatcher/native/thunk/callback,
  host update wall budgets, actual yield/unwind/rewind, scheduler transfer, REP and
  long consecutive interpretation. Both widths, profiling0/1, Asyncify and real JSPI
  (Node must expose the experimental API; normal full browser gates also cover JSPI).

Committed compact size results: docs/handoff/K26-size-evidence.json; policy/follow-up:
docs/handoff/K26.md. Shared-machine update samples include first-update startup and
lack interleaved controls; they are measurements, not causal speed ratios or game
performance. Identical generated body **sizes** are not claimed as per-body byte hashes.
Default threshold remains32MiB code/8MiB partitions; the small matrix forces the latter.
The fixed-local whole control separates loss of interprocedural optimization from
conservative placeholder-induced suspension; published bodies never contain placeholders.
