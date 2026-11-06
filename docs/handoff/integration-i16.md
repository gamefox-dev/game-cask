# Integration I16 — K33 over dev.21 (complete)

Branch **integration/p1**, original no-ff merge **5cc812c** = **fab7257** (dev.21/K31/K34) +
**a11349c** (K33). Final tested source **030ccb6**, following integration repairs **3541c17** and
**0727828**. Documentation may advance HEAD. Accounting remains **default OFF**. No runtime,
compiler, emitter, ABI, scheduling or K34 helper change was needed.

[Structured evidence](integration-i16-evidence.json). Raw logs, reports, exit markers and scripts:
**/Users/dev/projects/pi-work/scratch-I16/i16/**. Final **audit.exit0**, **136 reports / zero failures**.

## Integration repairs and semantic retention

- **3541c17** consumes every configured Vitest JSON file, not a directory/extension-filtered subset.
  Otherwise the same newly configured file could disappear from both full/light lists and falsely
  pass the union check. Regression **3 PASS/1 FAIL before**, **4/4 PASS after**. Final configured
  inventory **141 files**, including all K31/K34 units. Coordinator clarified that
  **tools/bench/accounting.test.ts is intentionally opt-in**, outside default vitest.config.ts;
  this integration does not enroll it or weaken the default inventory check.
- **0727828**, coordinator #345: three required CI unit shards, strict UNIT3 aggregate, refreshed
  maximum Linux test and unique cold-example setup costs. Exact union **51+46+43+scale1=141**,
  no overlap. Predicted41.11min each was a planning estimate; actual CI times are below.
- Both accounting-startup and guest-accounting use **tests/support/suspension-modes.ts**:
  Asyncify always, JSPI when available, fail closed if BGT_TEST_JSPI=1 requires missing JSPI.
  Four branch regressions; no semantic assertion, deadline or skip weakened.
- **030ccb6** repairs the new aggregate test's extraction: the old search matched the earlier
  workflow_dispatch.inputs.webgpu key, yielding an empty slice. Newline-anchor gate, find the
  following webgpu job and assert bounds. The actual gate shell still runs against success,
  failure, cancelled and skipped UNIT3 results. This is test-only; coordinator delta-review PASS.
- Auto-merged **tools/build/pipeline.mjs** retains K33 skip-file transport plus K31 accounting
  defines. **tools/x86/x86tool.c** retains K33 skip-file parsing and K31 retirement publication.
  K34 inline ALU/pointer/shift headers and I15 high-CALL accounting adjustment remain unchanged.
  K33's **every kit example option inventory +4096-object compiler-plan allowlist** test passes;
  no fail-closed compiler transport path or allowlist relaxation was needed.

## Final CI — coordinator returned

**ci/i16d**, source **030ccb6**, run **42155051200**: **every required job PASS; aggregate gate PASS**
(coordinator bridge #349). Reported job minutes: unit_1 **38**, unit_2 **37**, unit_3 **45**,
e2e **53**, lint_examples **44**, scale **17**; lint_js and lint_native also PASS.
Maximum unit45min satisfies <=51min of60, leaving **15min /25% headroom**. These are reported
whole-minute durations, not raw runner timestamps. **CI Node lacks JSPI: its accounting tests
cover Asyncify only; local required-JSPI tier1 covers both actual modes.**

Historical outcomes are not relabelled: ci/i16/5cc812c/run42141326145 FAIL (two unavailable-JSPI
failures and second shard60min cancellation); ci/i16b/3541c17/run42143062584 is not acceptance
evidence; ci/i16c/0727828/run42150746419 was cancelled by the coordinator as superseded.
No gh access or lane push from this sandbox; CI was coordinator-owned.

## Completed local finish-line gates

Suites ran **serially in the background**, build jobs2, unit maxWorkers1, full default inventory,
no CI_LIGHT/exclusions, dual artifacts, actual Node JSPI flag with BGT_TEST_JSPI=1,
BGT_REQUIRE_WEBGPU=1, own port5286 (never5173), browser traces off.

| Gate | Result |
| --- | --- |
| doctor | PASS |
| full CC=clang lint | PASS,38 example checks |
| full real Homebrew GCC14 lint | PASS,38 example checks |
| explicit Clang host checks / typecheck | PASS / PASS |
| compiler transport + initial inventory regressions | 19/19 PASS |
| clean-default full npm test | **2400 tests /141 files /0 skips**,4381.45s,exit0 |
| full Asyncify browser | **300 pass /51 inherited skips /0 failures /0 flaky**,exit0 |
| full JSPI browser | **300/51/0/0**,exit0 |
| every pipeline oracle,accounting OFF | **34 fixtures ×2 modes ×300 =68 reports PASS** |
| every pipeline oracle,accounting ON | **68 reports PASS**,same traces as OFF |
| sustained dev.21 pairing | PASS,no regression beyond paired spread |
| leakcheck / final types / focused ESLint / diff-check | all PASS |
| final optional-Node / required-JSPI focused runs | **16/16 each PASS** |

Both browser modes: native WebGL2 **135pass/24skip**, WebGPU **157/26**, auto **8/1**.
Exact normalized skip inventory matches I14; no backend-unavailable substitution.

All136 oracles request/compare exactly300 frames, with null errors/stage/divergence, lifted
interp0/stubs[], and identical state/semantic traces within engines, across actual modes and
ON versus OFF (**40800 frame pairs**). The x64-smoke deterministic20-update pre-roll is additional,
not counted as300 comparisons. OFF accounting is unavailable/null; ON decimal u64 fields,
owner/process sums, bounded64 rings/drop counters and summary contracts are checked. All68 ON
final process/thread totals and **1886 retained present snapshots per engine** agree exactly with
interpretation. The unchanged strict **x64-gl-scale-only** expected-error contract is enforced:
one BUFFER_CREATE E_LIMIT, one buffer OOM/recovery and ten recording-only pixel failures; no
other command errors. No raster or hardware CPU-time claim is inferred.

### Retained failed runs and clean recovery

The original full-unit harness explicitly exported BGT_CPU_ACCOUNTING=0, conflicting under
-Werror with fixtures deliberately compiling ON. It finished **2389 PASS/11 FAIL,141files**,exit1:
ten fixture compile failures plus the new aggregate-extraction regression. Two intermediate
focused commands each **15 PASS/1 FAIL**, solely extraction. These original markers remain1.

The complete clean-default rerun **unsets BGT_CPU_ACCOUNTING** (product default OFF; fixtures may
explicitly opt ON).030ccb6 landed during its global prebuild, before unit files loaded; the
aggregate test and every other file passed in this uninterrupted full run. After all remaining
gates, both original focused commands reran on final source, **16/16 each**, then types/ESLint/
leak/diff passed. No compiler warning, assertion, deadline or fixture ON coverage was weakened.

## K34 sustained OFF comparison versus dev.21

Baseline **fab7257**, candidate **030ccb6**. One discarded pair then **nine alternating AB/BA pairs**
per actual mode; fresh instances,30untimed warmup updates then300timed updates with real VM work
on every Sleep. Compile/instantiate/init excluded. Host milliseconds per300updates, **not game
frames or isolated CPU cycles**. Shared host; no speedup or universal performance claim.

| Mode | Baseline median | Merged median | Paired delta median | Paired min..max |
| --- | ---: | ---: | ---: | ---: |
| Asyncify |18.40950|18.40638|−0.01650|−0.14279..+0.16354|
| JSPI |16.59708|16.58542|−0.00946|−0.49946..+0.21879|

AB subset medians before→after (paired delta): Asyncify18.38775→18.38971(−0.07717),
JSPI16.52062→16.52129(−0.00946). BA: Asyncify18.41619→18.46371(+0.04752),
JSPI16.61565→16.64894(+0.03171). Both complete paired ranges include zero: **no regression beyond
paired spread**. All raw samples/order/load/free-memory observations are retained. Both versions'
preparation300-update oracles agree in both modes; linked Asyncify and JSPI hashes are also
identical across versions (not merely equal benchmark checksums). Accounting is OFF in both.

## Independent scope and cleanup

Fresh independent pi review at3541c17: **PASS bounded source/discovery scope**, including both
auto-merges, unchanged K34/I15 helpers, compiler allowlist compatibility and exact141-file union.
It ran no tests/builds/gates/benchmarks/CI. The attempted repair-delta agent failed before starting
with missing-auth error (exit1 retained, not PASS). Coordinator reviewed **3541c17..0727828 PASS**
(#347) and **030ccb6 PASS**; no further independent agent launched. This is not an independent
full-Tier1 certificate. K34's inherited partial-cross-page qword-store and oversized narrow-SAR
architectural follow-ups remain documented in K34.md, not silently changed by integration.

All three owned queue roots exited, no paused runner remains. Removed owned benchmark wasm copies,
temporary dev.21 worktree (unlinked shared node_modules symlink first), and **I16-owned2.3GiB Zig
cache** only after every suite finished. ~10GiB free. Shared caches/locks and foreign outputs
untouched. Raw scripts/logs/reports retained externally; structured evidence includes hashes,
full oracle rows, exact inventory, CI boundary and complete paired samples. Final documentation
**leakcheck PASS (918 committable files)** and **diff-check PASS** are recorded separately as
closeout markers. No game, physical-device,60fps,
universal GCC or exact architectural-x86 certification.
