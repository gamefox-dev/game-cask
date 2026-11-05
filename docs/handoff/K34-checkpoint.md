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
| always-inline SHL/SAL/SHR/SAR | Asyncify | 22.27 | 18.85 | -3.45 (-4.34..-2.82) |
| same | JSPI | 20.10 | 16.63 | -3.43 (-3.69..-3.26) |

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
4. Implementation/test/docs checkpoint committed as 4061c0d (following docs correction commit does not change source).
   Write the final docs/handoff/K34.md conclusion with exact gate results. Never push.

## Live jobs and retained evidence

Scratch root: /Users/dev/projects/pi-work/scratch-K34. All measurements are under b/: base, inline
(existing opt-in ALU), pointer (existing opt-in memory), wrapper (default ALU), sustained-base,
sustained-wrapper, sustained-pointer, sustained-shift. Every directory has game/ and evidence.json with
manifest and both-mode 300-frame oracle results. Reports: alu-paired.json, wrapper-paired.json,
pointer-paired.json, yield-paired.json, sustained-alu-paired.json, sustained-pointer-paired.json,
sustained-shift-paired.json. Keep contaminated samples; no quiet-host/game-speed claim.

Live detached launch roots observed: codegen2 PID86415, final-focused PID6289. Identity is an observation,
not permission to signal later reused PIDs. Logs/exit markers are scratch-K34/codegen2.log/.exit and
final-focused.log/.exit. These were accidentally launched overlapping (contrary to desired serial policy);
no timing evidence was collected during their overlap. Do not launch more suites until both exit.
codegen2 may have loaded an earlier version of the new expected-value assertion; final-focused source
has the corrected RAX=0x80000000 expectation. One final source test edit adds default-pointer-vs-full-helper
equality; it happened after launch, so inspect whether final-focused loaded it; rerun if necessary.
Earlier focused.log/.exit PASS177 (includes codegen+build-chunks), codegen.log/.exit PASS172
(ALU/pointer only). Final source shifts are not yet a completed full-matrix pass. Disk6.4GiB free.

Remaining reviewer request: add helper-header object/linked/Asyncify invalidation regression if existing
cache dependency tests do not establish it. Do not bump cache schema or change build ownership gratuitously;
reviewer approved existing content fingerprints. Also inspect actual final wasm helper call elimination
and quantify synchronization separately if useful. No full Tier1, final external validation or CI claim.
## Continuation checkpoint — reviewer #322

The inherited final-focused codegen matrix completed 181/181 PASS (two files, exit 0) and loaded the corrected RAX=0x80000000 assertion. The earlier overlapping codegen2 run is retained as a stale-source failure (174 pass / 2 failed) from the old RAX=0 expectation, not a current-source failure. A focused CC0 cache regression was added in tests/unit/lifted-header-cache.test.ts and passes: a private copied helper-header change rebuilds one dependent object, changes the linked and JSPI hashes, misses Asyncify, and then warm-caches all artifacts. It uses a reloc-free x86 fixture after the first AMD64 no-relocation diagnostic. Typecheck and focused ESLint pass. Commits are 6a514c2, 9bbddc4, 36a396b and 9500bc0; inspect the log before final handoff.

A fresh serial Tier-1 runner is active at /Users/dev/projects/pi-work/scratch-K34/tier1, with BGT_E2E_PORT=5279, dual/real JSPI, WebGPU required, and no light exclusions. Doctor exited 0; lint and remaining gates are still running. Do not claim any gate until its exit marker and log are inspected. Previous failed focused cache attempts are retained; no assertions were weakened.
