# K32 checkpoint — WIP, NOT accepted

Branch lane/K32, base dev.18 211daca. Reviewer directed checkpoint/stop near150k. No compaction/push/game input/web/install. Fresh session continues. Scratch: /Users/dev/projects/pi-work/scratch-K32/work. All owned jobs drained; benchmark outputs cleaned in finally; about13GiB free. No Tier1/independent-review/CI claim.

## Decisions and implementation

Reviewer #266 approved bounded non-suspending direct N calls (cap32), guarded fallback, stack/return/pending/outer-stop checks, same-owner region loops and exact-PC indirect caches. Imports/scheduler/quantum/generic/SEH unwind fast frames first. BGT ABI and registry rows unchanged. #268 approved weak cross-chunk symbols with nonnull AND current-registry pointer equality; requires absent-selection/override/cross-chunk/both-mode/cache-freshness regressions before acceptance. Internal benchmark-only stats approved. Coordinator will arrange external review when ready.

Generated calls publish written GPRs, flags, clock/budget and reload used/written GPRs. Unused callee writes remain in X. Imports retain all16 handling; no cached guest pointers. Self-recursion stays flat after regression; mutual recursion remains bounded. Native region loops now recognize branch labels from other regions. Four-target indirect caches recheck NX/strict/force-interpreter and invalidate on registry changes. Conservative AMD64 qword-table discovery handles constant same-block LEA/MOV bases, refuses clobbers/segments/addr32, never folds live memory operands. No claim about game507sites.

## Measurements

K32-measurements.json retains every timing sample, oracle hashes/resources/counters; raw reports/logs/failures stay in scratch. ns/guest call, region ns/iteration; median5 fresh instances after1warmup,5000 iterations. Shared machine, not quiet-machine/game/isolated-wasm latency. Markers delimit assembly loops only.

| Pattern | Asyncify before | Asyncify current | Actual JSPI current (no baseline) |
|---|---:|---:|---:|
| direct | 33.559 | 24.568 | 27.848 |
| deep | 34.293 | 33.473 | 34.217 |
| indirect | 46.267 | 40.233 | 41.642 |
| tail | 64.617 | 48.075 | 130.150 |
| regions | 6034.250 | 76.733 | 75.000 |


No matched JSPI baseline exists: never derive JSPI speedup from Asyncify before. All five before/after300-update state and semantic hashes agree; lifted interp0/stubs0/census drops0. Final Asyncify precedes only conservative analyzer guards/table-label edits, which do not affect these fixture paths; actual JSPI is current source.

Baseline has no new nativeStats: null, not zero. Baseline lifted-entry proxies direct/deep/indirect/tail/regions are160006/960006/10006/15006/585004; never relabel as measured driver exits. Current driver steps4/955005/4/4/6; fast calls80001/5001/5001/10001/1; local resumes80001/0/5001/5001/0; region chains14998. Indirect hits4996/misses4 each table pattern. Reason5/6 census separately retained: original CALL/RET boundaries do not produce census exits.

Initial direct-only Asyncify29.701ns shallow,38.482ns deep (regressed vs34.293). First combined28.735/42.976/44.733/51.925/6106.908. Final removes unnecessary all16 spills, gates self recursion, adds cross-region native branch entries. Region baseline is6034.250 NOT60.34ns; reviewer initially read it as27% regression, corrected in live response. Huge region gain includes removing~575k generic/interior resumptions, NOT isolated region-loop savings. Remaining generic226region/3deep are cold quantum work. Spill cost not independently isolated.

Caught reporting bug: BGT_ORACLE_SUSPENSION routed oracle mode but not timing loadHeadless. final-jspi.json has real JSPI oracle but Asyncify timings. Now benchmark explicitly requests suspension; actual-jspi.json is real JSPI timing. Retain old evidence with this correction.

## Tests actually run

Doctor ready before changes. Old focused codegen+dispatch177/177pass,474s, while source evolved: not final-tree certificate. Latest production-runtime tests15/15pass,33.96s, both presets: full CPU/RAM, mutual recursion cap32/quantum, indirect generic fallback, RET imm, missing weak selection links/interpreter fallback, high pointer fault, region chain, registry replacement and warm NX. Types2/ESLint/leak exit0 before last small analyzer/test/routing edits. Initial new tests failed PE-base wiring then macro include order; fixed wiring. A new deep test incorrectly required>50 local resumes despite cap unwinding: replaced that new perf assumption with proof of flat-driver reentry, retaining CPU/RAM/cap/call assertions. Asyncify A/B and actual JSPI run each pass five300-update oracles.

No full lint/GCC/npm test/browser matrix/all-fixture oracles/mutation/final leakcheck/external review yet. An accidental initial overlap between focused and new diagnostic roots occurred; later runs serial. All owned roots now absent. Last timing root29747 finished exit0.

## Fresh-session remaining work

1. Read original brief operating docs/handoffs; inspect delta and evidence. No skipped acceptance assertion may be weakened.
2. Finish #268: cross-chunk direct execution counts, override exclusion, both real suspension modes, selection/chunk cache freshness regression. Absent weak selection already links/passes.
3. Real generated fast-frame import/suspension/callback/nonlocal tests; strict warm fast-site guards and sensitive negative controls; coverage convergence evidence.
4. Matched baseline JSPI A/B; isolate direct/cache/region-loop/block-entry pieces. Quantify remaining synchronization cost. Repeat deep/noisy cases on quieter machine; do not claim no-regression from one close median. Mutation proof and exact cross-mode traces.
5. Serial BACKGROUND suites, unchanged gate, BGT_E2E_PORT5277: doctor, lint clang+realGCC and explicit scale if omitted, types, full npm test, both renderer backends in Asyncify+JSPI, leakcheck, EVERY current pipeline oracle300 in both modes. Preserve failures/skips. Do not repeat old results as current-source green.
6. Request coordinator fresh external review when implementation ready; never claim in-lane author work independent. Resolve findings sensitively.
7. Finish docs/handoff/K32.md plus pipeline/status only with actual acceptance evidence. Commit, never push.
