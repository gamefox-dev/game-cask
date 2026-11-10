# K40 checkpoint — admission / coverage / registry (Q74)

**WIP, not accepted or finished.** lane/K40 over dev.24 bd43888. Reviewer #381 requested
this checkpoint, owned-job drain and end of session; no compaction. No game files, web,
installs, push, ABI/schema/emitter-policy change, or weakened existing tests. Scratch root
**/Users/dev/projects/pi-work/scratch-K40/** is retained. This is not the final K40 handoff.

## Decisions / boundaries

- **#379:** approve measurement, then shared internal exact-PC registry lookup and an equivalent
  coverage-cache hit fast path. Preserve permission/force/strict checks, counters, queue, drops,
  collision semantics. No once-per-callee recording. Ask again before a new direct-site key/API.
- **#380:** approve a bounded **two-way exact-PC** registry-cache experiment, same address key and
  registration-clear invalidation. Keep it **only** with a paired win on the mixed fixture and
  no loss on VM/memory; require registration/override/permission regressions. Do steps 1/2 first.
- **#381:** checkpoint WIP building tree, document numbers/next steps, drain jobs and end.

No new direct-site API or generation-keyed admission cache was implemented. All checks that can
change execution remain live. Original K32 already skips wrapper/flat-driver crossings for direct
N calls, has exact-PC immutable registry caching and four-target indirect-site caching, and reads
virtual-call operands each time. It does **not** skip enter/resume registry validation or coverage.

## Implemented experiments (cumulative artifacts, not accepted defaults)

1. **lookup:** platforms/x86/x86_rt.c shares find_lifted_entry() returning the cached fn/native
   row. find_native no longer calls the public fn-only wrapper then rehashes/reloads the row.
   Same permission-before-force ordering, same lookup/miss/range contract, same strict coverage.
   This refactor has mixed timing and must not be sold as a broad win.
2. **cover:** platforms/x86/x86_coverage.h outlines the cold miss/flush/enqueue path, preserving
   pre-flush old kind, hash, slot replacement, event/hit/crossing counters and queue order.
   Mode0 reference and mode2 strict paths are unchanged. No event or kind bit is deleted.
3. **ways:** current WIP runtime adds a second way at each existing 1024 bucket, bounded round-robin
   replacement, registration clears both ways and replacement bytes. Same exact-PC key and live
   dynamic guards. **Built/oracled, NOT TIMED yet. Not approved to retain without #380 evidence.**

Registry rows, native ABI and call lowering are unchanged. Code-page permissions are rechecked,
not cached; no guest pointer persists. No SMC support is added. Override/force/recursion32,
quantum/native-stop, RA/RSP, imports/callbacks/nonlocal paths are not removed or reordered.

## Measured exact baseline (accounting ON, profiling OFF)

Original CC0 k40-fixture.mjs: 32 eleven-instruction leaves, half direct/half indexed virtual calls,
returns, loop and Sleep. 256 iterations, 8 source calls/iteration; approximately one source call per
13.75 retired instructions in the counted window. K35 sustained VM and memory controls unchanged.
No game-equivalence or game-speedup claim.

K39's original-wasm operator instrumentation is adapted in tools/bench/k40-wasm-count.mjs.
Instrument **immutable actual JSPI wasm**, count original operators only, do not time counting builds.
30 warm +300 counted host updates; API trace hashes, exact retirement/core metrics and coverage
union/drop state equal the original at all 330 updates/final snapshot as applicable. These checks
are not whole-memory/CPU equivalence. Dynamic measurement was **JSPI only**; both-mode counting
and isolated per-step wall-time attribution remain unfinished. Operators are not cycles/spills.

| fixture | retired window | four-helper exclusive operator share | coverage hits/events |
| --- | ---: | ---: | ---: |
| mixed calls | 27,244,258 | 43.312% | 3,963,733/3,963,733 |
| VM | 15,798,619 | 13.515% | 574,950/574,955 |
| memory | 47,348,784 | 39.195% | 7,891,788/7,891,789 |

Four-helper group is coverage_entry/native_enter/native_resume/find_lifted; it does **not** include
native_indirect or inlined caller publication. Each hot coverage entry costs54 original operators;
enter76; resume~78. find_lifted averages79.295 mixed /55.004 VM /55.000 memory, suggesting mixed
cache conflicts, **not a measured hit-rate proof**. Registry result reuse rates / generation-change
census still need explicit measurement. Coverage is already deduplicated almost completely; its
remaining per-entry work/counters, not host crossings, is the target. K39 c/accounting-OFF shares
are a different artifact/mode, not a like-for-like subtraction.

## Paired timings: steps 1 and 2 measured; step 3 pending

Uninstrumented named artifacts; exact/accounting ON, profile OFF. One discarded triple then9
alternating-order fresh-instance triples,30 untimed +300 timed updates. Instantiate/init excluded.
Shared host, not CPU cycles or guest frames. Compact samples/resources/operator counts:
[K40-checkpoint-measurements.json](K40-checkpoint-measurements.json). Raw immutable artifacts,
evidence, logs and pairs remain in scratch. Negative delta means faster. Units **ms/300 updates**.

| fixture/mode | base/lookup/cover median | step1 lookup−base paired median (range) | step2 cover−lookup paired median (range) |
| --- | --- | --- | --- |
| mixed Asyncify |57.489/58.258/55.946|+.471 (−1.432..+1.802)|−2.239 (−3.751..−.947)|
| mixed JSPI |49.439/51.357/50.316|+2.096 (−.923..+5.437)|−1.268 (−4.213..+20.212)|
| VM Asyncify |14.365/15.047/14.599|+.861 (−.111..+1.102)|−.456 (−1.368..+.841)|
| VM JSPI |12.705/12.813/12.622|+.065 (−.071..+.267)|−.167 (−.272..−.013)|
| memory Asyncify |86.543/87.981/82.295|+1.455 (−.616..+4.528)|−6.445 (−10.766..−2.868)|
| memory JSPI |83.532/78.712/67.753|−4.820 (−7.012..−2.691)|−10.933 (−12.650..−9.959)|

Step2 improves memory in both modes; mixed JSPI contains a retained large outlier. Step1 regresses
several cells and should be reconsidered/rejected unless a final justified combination wins. Do
not subtract unrelated sample medians to attribute speedups. Earlier pair-*-base-lookup.json was
run while a focused suite overlapped; retain as historical but **do not use for acceptance**. The
triple table above ran after that suite exited. The initial parallel launch was a work-style error;
all subsequent preparation/pairing was serial. No two-way paired file exists yet.

## Proofs / current gates

- base/lookup/cover/ways preparation: **3 fixtures ×2 actual suspension modes**, each330-update
  lifted-vs-interpreted API hash equality, interp0/stubs[]. Scratch checkpoint-artifact-audit.json
  (committed as [K40-checkpoint-artifacts.json](K40-checkpoint-artifacts.json)) additionally confirms
  all variants' final total retired instructions equal interpreter and all
  traces + canonical sorted code/kind/drop snapshots equal baseline; it retains both wasm SHA256s.
  Full serialized coverage evidence-file byte identity (including identities/counters) still pending.
- Original K32-focused native-call + dispatch suite at lookup: **35 passed** (inspect focused.log).
  Final ways focused checkpoint: **15/15,3 files**, real runtime growth/mid-frame override/NX-resume,
  existing direct/indirect strict/NX/force guards and coverage transport. No final ways native-calls
  complete rerun yet. Its existing full CPU/RAM differential tests remain unchanged.
- New exact coverage test compares ordered transport bytes and event/hit/crossing counters to an
  independent old-policy JS model under pressure, collisions, kind unions, zero/high addresses and
  invalid kinds. Initial test failed because wasm imports pass signed i32; normalize with >>>0,
  matching production host. Final test passes. Earlier cover run14/15 is historical, not green.
- Original-wasm count fixtures **3/3** pass. Initial --all-features Binaryen assembly was not Node
  compatible; changed to K39's explicit features. Initial full metrics equality incorrectly compared
  wall-time fields; now explicitly compares exact core fields and traces, never timing fields.
- Checkpoint typecheck **PASS**, focused ESLint **PASS** after declaring structuredClone for the
  repo lint globals. git diff --check clean. Checkpoint leakcheck **PASS**,953 committable files
  before adding the artifact manifest. Full doctor/lint clang+GCC/npm test/browser/
  all-pipeline300 oracles and fresh independent validation remain **OPEN**. Do not claim Tier1.

## Jobs / disk / next session

All preparation/count/pair/focused roots exited. The only remaining root was **87634**, tier1.sh,
waiting for a never-created final-ready marker; explicitly terminated before it ran a gate.
Checkpoint runner57591 completed types/ESLint/focused; no suite or publisher remains running.
No unknown process/shared lock/cache was signalled. Scratch root is retained. Disk ~2.5GiB free at
checkpoint (started4GiB); inspect before new builds. Owned caches/products may be pruned serially,
never delete scratch root, shared caches or someone else's gate state. BGT_E2E_PORT=5292.

Exact next steps:

1. Read brief, this checkpoint and current diff; keep source at WIP until measured retention decision.
   Run BGT_K40_FIXTURE=calls BGT_K40_PAIR=cover,ways vitest --config tools/bench/k40.config.ts,
   repeat vm/memory, both modes run automatically. Require #380 mixed win/no VM or memory loss.
   Reject/revert two-way otherwise. Decide whether to retain lookup after its mixed results; measure
   coverage-only over original runtime if needed (do not assume cumulative result isolates it).
2. Finish measurement contract: both-mode operator evidence, registry cache-hit/generation reuse,
   per-call/time denominators with honest nonadditive wall-time attribution. Validate instrumentation
   analytically as K39 did; include full artifact/code hashes and more than API state hashes where needed.
3. Save byte-identical actual coverage recordings for a deterministic paired run, with module identity
   and all evidence counters, not just the current canonical code/kind union. Strengthen accounting ON
   per-thread/total equality assertions in bench itself; current stored audit is a separate proof.
4. Run focused ways/native-calls and invalidation sensitivity mutations. Keep no new skips/deadlines.
   Independently validate in a real fresh session (none ran here). Ask reviewer on any ABI/cache-key/
   evidence/oracle-trace decision beyond #379/#380.
5. After final source decision, commit source; only then run serial background Tier1. Scratch tier1.sh
   and oracles.mjs are scaffolding, **not tested**: audit oracle JSON comparedFrames shape, exact inventory,
   output pruning and disk before reuse. Full npm tests, both-browser-backends ×both suspension modes,
   all pipeline examples×both modes×300, doctor, lint real GCC+clang, types, leakcheck; all proofs exact.
   No final-ready marker should be created until these decisions are settled.
6. Write final docs/handoff/K40.md with actual accepted numbers/gates, commit on lane/K40; never push.

Repro environment for prep: BGT_CPU_PROFILE=0 BGT_CPU_ACCOUNTING=1 BGT_PROFILE_NAMES=1
BGT_BUILD_JOBS=2 BGT_TRIAL_SCRATCH=/Users/dev/projects/pi-work/scratch-K40. Preparation selects
BGT_K40_PREPARE=base|lookup|cover|ways and BGT_K40_FIXTURE=calls|vm|memory. Do not overwrite existing
immutable artifact directories; use new revision names. Bench pair mode builds nothing. Count tooling:
node tools/bench/k40-count.mjs; BGT_K40_COUNT=1 plus fixture; node tools/bench/k40-report.mjs.
