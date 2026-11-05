# Integration I15 — K31 exact accounting over K32

**Complete.** Branch `integration/p1`; no-ff merge **0edf02c** has parents **958d5f0**
(dev.19 / K32) and **288f7f2** (K31, reviewed implementation **99329ac**).
The pre-existing in-progress merge was continued, not restarted. The only textual conflict,
`docs/v03-status.md`, retains both lane records. No ABI, scheduling, native-call/cache policy,
guest TSC or default-option changes. Accounting remains **OFF** unless **BGT_CPU_ACCOUNTING=1**;
OFF metrics are unavailable/null, not measured zero. X86_NATIVE_STATS remains separately opt-in.

[Structured evidence](integration-i15-evidence.json) records source identity, raw log/report hashes,
all136 oracle reports, exact browser inventories, full paired samples and bounded independent review.
Raw evidence/scripts: **/Users/dev/projects/pi-work/scratch-I15/i15/**.

## Integration defect and regression

K31's old flat CALL boundary excluded invalid full-width targets from retirement. K32 can spill
before validating a fast CALL target, so the accounting delta was already published when
`x86_address(t)` faulted. The first merged interaction run reproduced **4 assertion failures /
26 passing controls**: high CALL target prefixes retired one extra instruction in both presets.

**tools/x86/lift64.h** now excludes the invalid CALL after the successful return-address store,
but **before any early publication**, including the import-hint path. The common boundary excludes
only high RET/JMP targets, so CALL cannot be excluded twice. `XR_ADD` erases this adjustment when
accounting is disabled. Stack/operand faults retain their existing memory-fault path and exact
partial architectural state. No K32 guard or fast path was disabled.

Regressions in **tests/unit/native-calls.test.ts**, **native-seh.test.ts**, and their fixture harness:
- Compare process/thread retirement alongside complete CPU/RAM snapshots against interpretation.
- Known answers: generic-call7, cross-object direct5, warm indirect CALL23/tail27 (3 hits/1 miss),
  chained regions1809 and self recursion25; zero storage with accounting OFF while K32 still executes.
- Preserve weak missing-selection fallback, override exclusion, budget/deep-recursion gates,
  table patch/high-target guards, and both size/fast presets.
- Actual Asyncify/JSPI callbacks, park/rewind and nonlocal transfers retain totals12/8 and exactly
  one service execution. The existing K31 retirement fixtures additionally retain mixed18, REP,
  quantum, reset/context and fault-prefix known answers.
- Real successful AMD64 SEH through a directly called guest callee retains positive and equal
  process/thread retirement across both engines/modes, all300 state hashes and complete CPU/log
  equality, actual Sleep parking, and the exact bridge-to-raising direct-entry marker delta.
  i386 RaiseException still explicitly fails closed; successful i386 SEH is not claimed.

Corrected focused **36/36 tests /3 files PASS**, actual Asyncify and JSPI. Both later full unit
runs include these tests unchanged. Only extra integration cleanup is removing a pre-existing
new-file trailing blank line for diff-check hygiene; no assertion/deadline/skip weakening.

## Fresh merged-source finish-line gates

All suites ran **serially in the background** on merge0edf02c; implementation stayed clean.
BGT_BUILD_JOBS=2, unit maxWorkers=1, BGT_TEST_JSPI=1, BGT_JSPI=1, dual artifacts,
BGT_REQUIRE_WEBGPU=1, own port5285 (never5173), browser traces off; no light mode/exclusions.

| Gate | Accounting OFF | Accounting ON |
| --- | --- | --- |
| Doctor | PASS | not repeated |
| Full lint, CC=clang | PASS,38 example checks including scale | not required |
| Full lint, CC=real GCC14 | PASS,38 example checks including scale | not required |
| Explicit Clang host checks / typecheck | PASS / PASS | not required |
| Full npm test | **2364 tests /138 files /0 skips**,4299.47s | **2364/138/0**,6287.83s |
| Full Asyncify browser | **300 passed /51 inherited skips /0 failures /0 flaky** | WebGPU **157/26/0/0** |
| Full JSPI browser | **300/51/0/0** | WebGPU **157/26/0/0** |
| Every pipeline oracle,300 frames | **34 fixtures ×2 modes =68 PASS** | **68 PASS** |
| Leakcheck | PASS | final documentation closeout separately below |

OFF per mode: WebGL2 **135pass/24skip**, native WebGPU **157/26**, auto **8/1**. ON exactly the
WebGPU subset. Exact skip identities/project counts equal I14, no backend-unavailable substitute.

**Final audit PASS:136 reports, zero failures.** Each oracle requests/compares300, has null errors,
stage/divergence, lifted interpretation0/stubs[], and identical state/semantic hashes within each
engine pair, across actual modes, and ON versus OFF. This is40800 compared frame pairs. The existing
x64-smoke20-update deterministic startup pre-roll is additional, not counted as300 comparisons.
OFF availability/string contracts, ON exact decimal u64 fields, process/owner sums,64-snapshot bounded
rings/drop counters and frame summaries are checked. All68 ON final process/thread totals match
interpretation; all**1886 retained native-present snapshots per engine** also match exact process/
thread totals at the same presents. Workloads without guest presents retain unavailable frame rates.
Scheduler host-wall buckets are not hardware CPU time; cpu_time_us remains null.

The existing strict **x64-gl-scale-only** expected-error contract is unchanged and enforced by
production oracle helpers: one BUFFER_CREATE E_LIMIT, one buffer OOM/recovery and ten named
recording-only GPU pixel failures; other command errors zero. No raster evidence is inferred.

## Paired OFF benchmark versus dev.19

K32's unchanged five workloads,100000 iterations, stats/accounting OFF. Serial preparation builds
have identical300-update oracle hashes; five alternating fresh-instance A/B pairs plus warmup in
**both actual modes**, baseline958d5f0 versus merged0edf02c. Full signed samples/load observations
are retained in the structured evidence. Units are **ns per workload call/iteration**, not isolated
wasm-call latency. Shared-machine noisy spread; **no speedup or universal zero-overhead claim**.

| Mode | Workload | Before median | After median | Paired delta median | Paired delta min..max |
| --- | --- | ---: | ---: | ---: | ---: |
| Asyncify | direct |33.666|32.948|-0.116|-6.543..+5.567|
| Asyncify | deep |47.448|46.830|+0.153|-4.871..+3.409|
| Asyncify | indirect |40.203|50.098|+5.065|-57.681..+21.378|
| Asyncify | tail |62.742|59.785|+3.384|-17.468..+29.515|
| Asyncify | regions |119.281|66.419|-59.904|-70.595..+120.603|
| JSPI | direct |33.660|33.711|+0.076|-3.768..+4.241|
| JSPI | deep |39.847|41.917|+0.859|-0.070..+7.515|
| JSPI | indirect |29.777|29.718|+0.569|-0.730..+28.338|
| JSPI | tail |38.992|38.362|-0.885|-41.891..+0.700|
| JSPI | regions |39.339|43.004|+1.417|-53.157..+26.369|

Every paired range includes zero; no supported regression beyond paired spread. This is the merged
OFF acceptance comparison, not K31's ON overhead measurement (+19.1354% on its separate full-owner
workload). Compiled-out source was independently inspected, but no bitwise hot-body equality claim:
benchmark artifacts have stripped function names, so an attempted name-based diagnostic found no
functions and was discarded, not presented as proof of zero-cost code identity.

## Independent scope and cleanup

A **fresh independent pi session** reviewed merge0edf02c, lane/base deltas, native guards, retirement
publication, scheduler ownership and the new tests. **PASS within bounded source-review scope**,
no blocking defect. Report: scratch **independent-review.md**, hashed in structured evidence.
It ran **no tests/builds/gates/benchmarks**: this is not an independent full-Tier1 or CI certificate.
Its limitations (OFF compiled-body proof, no hand-counted entire SEH program) are explicit; known-count
small controls and fresh author gates are separate evidence. No game/device/60fps certification.

Both owned runner roots exited; none remains queued. Prepared benchmark wasm copies and temporary
fixture outputs were removed by finally blocks. Per-mode browser JSON was saved before removing
owned disposable HTML/artifacts. Removed the temporary dev.19 worktree and **I15-owned Zig cache**
after every suite finished; about**9.1GiB free** afterward. Shared caches/locks/tickets and foreign
reports were untouched; raw logs/reports remain outside Git. Final documentation **leakcheck PASS
(893 committable files)** and **diff-check PASS** are recorded separately in scratch
**closeout-*.{log,exit}**.
