# Q85/Q74 exact dispatch benchmark (CC0)

No PE is executed on the host. One heavy suite at a time; background all commands,
set BGT_E2E_PORT, retain the scratch root, delete owned outputs between suites.

Preparation (dense native calls, four-target indirect calls, owner regions, mixed
leaf/nonleaf Win32 imports + generic CPUID):

~~~sh
BGT_JSPI=1 BGT_BUILD_JOBS=2 BGT_CPU_PROFILE=0 BGT_CPU_ACCOUNTING=1 \
 BGT_PROFILE_NAMES=1 BGT_K49_OUT="$BGT_TRIAL_SCRATCH/before" \
 npm exec -- vitest run --config tools/bench/k49.config.ts
# Repeat at candidate source with OUT=after. Preparation checks 300-update
# lifted/interpreted oracles in actual JSPI and Asyncify, both counter modes.
BGT_K49_PAIR="$BGT_TRIAL_SCRATCH/before,$BGT_TRIAL_SCRATCH/after" \
 BGT_K49_OUT="$BGT_TRIAL_SCRATCH/pair" \
 npm exec -- vitest run --config tools/bench/k49.config.ts
node tools/bench/k49-report.mjs "$BGT_TRIAL_SCRATCH/pair"
~~~

Nine alternating-order fresh-instance pairs after a discarded warmup. Marker-delimited
loop wall time excludes setup; ns/retired uses **whole 300-update wall / whole retirement**
(including startup and host update overhead) to avoid mismatched denominators. This is
not isolated CPU cycles or a rendered-frame claim. Exact retirement is enabled uniformly
for these diagnostics, so timings are explicitly accounting-enabled, not production-OFF.
Raw reports retain both marker time and whole-update time, load averages, metrics, every
oracle and artifact. No timing threshold assertion or removed slow sample.

Instrumentation overhead is a **separate comparison**: set K49_OVERHEAD=1, NO_PROFILE=1,
PAIR=before,before (or after,after), OUT=overhead. It compares counters OFF/ON within one
revision, not a speedup row. K49_ENABLED=1 selects counted artifacts for diagnostic A/B;
never relabel those as counter-OFF timings. Default patterns/direct loop count are fixed
at direct,indirect,regions,mixed / 100000; selectors are diagnostic tools only.

Separate V8 inspector CDP CPU-profile captures use twelve fresh instances after code
warmup, start after instantiation, stop after 300 updates, requested interval100us.
Profile aggregation selects samples inside the same guest marker window via monotonic
CDP timestamps and hrtime; profiler protocol/setup/idle samples stay in raw captures
but are not charged to the guest loop. Window endpoints have timer/sample granularity.
The r24b location categories are generated lifted N/R/F, runtime x86/x64/xl/xs/xa/w32/w64,
GL/JS boundary, named suspension bridge, other JS/host and unknown wasm/native.
Self-sampled wall locations are **not** a calibrated additive CPU-cycle partition.
Profiles are not used as timing samples. Native helper names may be compiler-inlined
into lifted owners; neither samples nor wasm locals measure physical register spills.

Safety fixtures are tests/unit/native-calls.test.ts (quantum, full-width registers/
returns, checked faults, imports/callback nesting and real suspension), native-seh.test.ts
(real SEH/unwind), and lift-dispatch.test.ts (generation/override/NX/strict/force/stop/depth).
Q85 known-count tests fail on altered increments; warm cache tests require exact lookup
reduction, not just a matching answer. Architectural CPU/RAM and interpreter traces
remain independent controls. No game-specific path or relaxed-codegen mode is used.
