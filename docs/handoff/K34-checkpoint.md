# K34 checkpoint — reviewer #321

## State

Checkpoint requested at context threshold. Branch is lane/K34. K31/I15 was merged by commit 9f157b1
(Merge branch integration/p1), over dev.19/K32 at 958d5f0; the K31 source handoff was read from lane-K31.
No game files, ABI changes, retirement-accounting changes, or web/install input were made. K31 accounting
remains default-off. This is a WIP checkpoint, not a Tier 1 claim.

## Measurements and implementation

The original startup-inclusive CC0 workload (81 functions, 1,845 specialized/12 generic) measured
xl_alu_full at 1,673/7,608 V8 samples (22.0%), xl_pointer_checked 640 (8.4%), and x64_shift 606 (8.0%).
At least 889/942 host allocation/map samples were startup-owned (GDI/boot/decode/cache setup); the 483
scheduler samples came from w32_update/w32_thread_schedule around Sleep-driven updates, so neither row
proved a sustained VM bottleneck.

The first ALU A/B was JSPI baseline 10.866 versus inline 7.933 ms per 300 updates, paired median -3.063
ms (range -3.242..-2.952, about 28%). Asyncify was strongly first/second-order contaminated and was not
claimed. The sustained fixture now does 30 untimed warmup updates, then 300 timed updates with dispatch
work on every Sleep. Nine alternating same-process fresh-instance pairs follow one discarded pair, in both
modes:

| change | mode | baseline | candidate | paired delta/range |
|---|---:|---:|---:|---:|
| always-inline full-flag ALU wrapper | Asyncify | 36.55 | 24.58 | -12.49 (-30.18..-10.41) |
| same | JSPI | 34.37 | 22.80 | -11.57 (-11.79..-11.41) |
| default checked-pointer same-page fast path | Asyncify | 24.66 | 22.39 | -2.63 (-2.81..-1.40) |
| same | JSPI | 22.80 | 19.93 | -2.88 (-3.15..-2.66) |
| always-inline SHL/SAL/SHR/SAR | Asyncify | 24.66 | 21.20 | -3.45 (-4.34..-2.82) |
| same | JSPI | 22.80 | 19.37 | -3.43 (-3.69..-3.26) |

Sustained lifted/interpreted hashes and traces were identical in both modes for every candidate; zero
interpreted instructions and no stubs were observed. The source changes are in platforms/x86/x86_lift64.h,
tools/x86/lift64.h, and the CC0 benchmark harness. Existing header dependency fingerprints invalidate
objects and linked/Asyncify artifacts; no cache schema or ABI change was needed.

## Correctness status

The prior codegen matrix passed 172 tests. A new exhaustive xl_shift/reference-flag test and a mid-region
shift-plus-memory-fault precise CPU/PC/clock snapshot were added. A rerun including those tests was still
running at checkpoint; do not call it green until its exit marker is inspected. Existing tests cover holes,
permissions, cross-page partial stores, high-width addresses, promoted registers, dead/live flags and both
suspension modes.

## Exact next steps

1. Inspect the running final-focused exit marker/log; repair any real shift/fault failure without weakening assertions.
2. Run the remaining focused/type/lint gates serially, then full doctor, npm test, both-backend/both-mode e2e,
   all pipeline 300-frame oracles, leakcheck, and required port gates with BGT_E2E_PORT; do not claim any unrun gate.
3. Rebuild one clean fixture with the final source and verify the lift/cache invalidation report and both
   suspension artifacts. Remove owned temporary k34 outputs and scratch artifacts only after recording evidence.
4. Commit the implementation, tests, benchmark fixture/harness, docs/pipeline update and this checkpoint;
   then write the final docs/handoff/K34.md conclusion with exact gate results. Never push.
