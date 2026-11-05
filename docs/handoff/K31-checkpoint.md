# K31b checkpoint — reviewer #273 requests a fresh session

**WIP, NOT Q78/Tier1 acceptance.** Branch lane/K31, base dev.18 211daca.
Previous implementation commits f3ed073 + d4054da; this checkpoint's commit contains K31b changes.
No push/installs/web/game data/compaction. Port BGT_E2E_PORT=5276. Evidence and owned runners:
**/Users/dev/projects/pi-work/scratch-K31**. Read original brief /Users/dev/projects/pi-work/briefs/k31-counters.md,
AGENTS.md/CLAUDE.md, docs/pipeline.md, v03-status, K10/K26 and read-only porter perf-mp3 contract.

## Implementation inherited / K31b changes

Separate process/per-task u64 retirement, native/generic/interpreted; no restored TSC subtraction.
AMD64 batches clock deltas at native synchronization boundaries, excludes faulting instruction;
i386 commits after semantics before transfers. Partial REP retires once at final completion.
No synthetic thunk/import/callback-scaffolding/override instructions. Context restore and census reset
preserve retirement. Scheduler owns stable64 identities, metadata/state, active/ready/sleep/object/I/O/
suspended/host-yield host wall, virtual durations/requested waits/switch-ins/actual host parking.
CPU time stays null. Native-present cumulative process/thread snapshots: bounded64 ring, explicit drops.
Strings preserve u64; host BigInt subtraction precedes safe numeric conversion; wholly-contained pairs only.
BGT_CPU_ACCOUNTING=0 erases hot work and reports unavailable; profile0 retains retirement/metadata only.

K31b:
- Fixed host summary missing-timing denominator: absent thread timing now makes active total/throughput null,
  never silently adds zero. Added sensitive regression.
- Added real Win32 API/scheduler/core full-pipeline hand-clock fixture for both widths. CreateThread,
  Sleep, event wait/signal, yield, suspend/resume, I/O-account hooks, park and exit. Known3 interpreted
  instructions under each selected identity; exact running/ready/wait/park buckets, switch-ins,
  virtual Sleep16ms vs requested10ms, native-present delta3, post-present tail exclusion, reset and ring drops8.
  This controls real API calls from fixture C; not yet a guest-import-driven hand-counted multithread program.
- Retirement fixture now actually links real x87/libm with WASI-offline entropy adapter; earlier freestanding
  compile was not exercised. Added full-width invalid CALL/JMP/RET target faults and actual Asyncify/JSPI
  parked active-wall freeze/retirement assertions. Mixed fixture uses i386 BSWAP versus AMD64 CPUID:
  CPUID is unsupported in existing i386 semantics, not a K31 implementation regression. Count remains18.
- Restored original i386 indirect-call bad-return fault address (target t, not X.eip); no scheduling change.
- Added serializer accounting0/profile0 availability/no-clock test. Existing overflow/capacity assertions intact.
- Added retirement4/6 assertions to existing real interpreted CALL -> native import -> nested callback/park/
  exception fixture. **Not run yet**; queued behind overhead. Handwritten import/native scaffolding contributes0.
- Documented field rules/clock domains/default condition in docs/pipeline.md (explicit validation-in-progress).
- Added tools/bench/accounting.{test,config}.ts: original CC0 CPU-heavy i386/AMD64 and full12000-owner scale,
  private account0/1 artifacts, profile0/1, both real suspension modes,9 alternating paired warmed samples,
  300 updates each, equal state/API/legacy execution metrics/logs. Full scale in progress.
- Added present-overhead.c and present-accounting.{test,config}.ts microbenchmark: real capture,1/64 identities,
  both modes, real clock. **Not compiled/run/typechecked** after creation; not queued. No guest-throughput claim.

## Actual results (not full finish line)

- inherited lint-initial **exit0**: full npm run lint, ESLint + real GCC host +38 example check-builds;
  source changed during early inherited run, and later K31b tests/docs/summary were added. NOT final-tree lint.
- focus3 **exit1**,11 pass/2 fail: i386 mixed CPUID unsupported. Fixed by supported same-size generic BSWAP.
- scheduler1 **exit1**,2 failures before execution: tiny PE fixture lacked required _tls_index anchor.
- focus4 **exit1**,14 pass/1 fail,4 files,185.56s: ALL retirement7, summary4, serializer2 + i386 scheduler pass;
  AMD64 scheduler fixture could not relocate because empty entry had no relocations. Fixture now references a
  volatile global pointer (original CC0) and has _tls_index; assertions unchanged.
- scheduler2 **exit0**,2/2 widths PASS,31.34s after relocation repair. These are clean scheduler fixture results.
- types4 / continue-types / types5 **exit0**. types5 includes scheduler + main overhead benchmark but predates
  nested-import assertions and present microbenchmark. types6 queued. No assertion/deadline/skip weakened.
- git diff --check passed before final checkpoint documentation.

## Partial MEASURED overhead (NOT acceptance/default decision)

Live report **overhead.json** is still being written. First8 rows CPU-heavy complete; full scale pending.
9 interleaved alternating pairs, one discarded fresh-instance warmup/artifact/mode; host init/build excluded.
Profile0 isolates retirement; profile1 includes scheduler work in addition. Samples are short/shared-machine,
large negative Asyncify differences may reflect code shape/JIT effects; do NOT call them a robust speedup.

| fixture | profile | mode | off median ms | on median ms | on/off-1 |
|---|---:|---|---:|---:|---:|
| cpu-x86 |0|Asyncify|100.998500|51.049833|-49.4549%|
| cpu-x86 |0|JSPI|41.890792|42.415416|+1.2524%|
| cpu-x64 |0|Asyncify|12.915959|9.019875|-30.1649%|
| cpu-x64 |0|JSPI|8.250375|7.940292|-3.7584%|
| cpu-x86 |1|Asyncify|109.298375|51.079500|-53.2660%|
| cpu-x86 |1|JSPI|41.405750|44.770334|+8.1259%|
| cpu-x64 |1|Asyncify|14.460125|9.662333|-33.1795%|
| cpu-x64 |1|JSPI|7.645375|8.671667|+13.4237%|

Reviewer #267 stands: retain default-on ONLY if measured incremental retirement overhead small (target ~2%)
on CPU-heavy AND scale BOTH suspension modes, otherwise default off behind BGT_CPU_ACCOUNTING.
Current default is still WIP on; full matrix missing, no accepted overhead conclusion. Profile1 percentages
are not isolated retirement cost and include scheduler/snapshot instrumentation (CPU fixtures have no presents).
Native-present microbenchmark is unmeasured. No game/60fps/hardware throughput improvement claim.

## Live owned jobs — all serial queues, inspect exit markers

No ps permission. Do not generic-kill or remove shared locks/tickets/caches. Do not delete active outputs.
All paths below in scratch-K31; known roots can be checked via kill -0 (no signal).

1. Root14400 **overhead2-run.sh**: running main overhead matrix. overhead2.log/.exit, report overhead.json.
   At 14:59 local it had completed CPU8 rows, lifted full scale50 shards and was compiling/postprocessing
   scale account variants. Full12000 source generated; resource report retained. Artifacts private under
   node_modules/.cache/bgt/k31-overhead/artifacts; runner removes own wasm trees only after each profile pair.
   No overhead2.exit yet. Earlier overhead.exit=98 is a deliberately blocked predecessor, NOT measured failure.
2. Root23570 **post-overhead-run.sh** waits overhead2.exit, THEN import-retire focused, doctor, types6, ESLint6.
   Pending import-retire.exit, doctor.exit, types6.exit, eslint6.exit. It runs regardless of overhead success,
   so inspect every result separately. Static/type checks include present microbenchmark if unedited.
3. Root71026 **negative-queue.sh** waits eslint6.exit, THEN negative-run.py private archive mutations.
   Pending negative.exit, negative-evidence.json. Script archives committed HEAD + all modified/untracked source,
   symlinks packages EXCEPT .cache, uses direct Node vitest (serial behind others), removes owned archive only on
   full completion. Five planned mutants: missing retirement, attempted quantum retired, process restored with
   context, parked active time, ring drops lost. **No mutants executed yet.** A nonzero test process alone is
   NOT sensitivity proof: inspect actual assertion failures, reject compile/setup failures. Archive failure
   can retain negative-tree; clean ONLY after root ends. Script/schema not itself tested yet.
4. Prior roots50457/3579/52867/63895/85057/12245 finished: explicit lint-initial/focus3/types4/scheduler1/
   continue-types/overhead98/focus4/types5/scheduler2 exits above. No other K31 heavy root intended.

Disk ~11GiB free at checkpoint; run suites serially/background, remove OWNED large outputs after hashes.

## Exact next steps

1. Audit pending overhead2 rows and checks/mutation assertions; repair real compile/type/test failures.
   Present microbenchmark needs first real compile/run (dedicated config, BGT_PRESENT_ACCOUNTING_REPORT
   absolute owned path), serial AFTER negative runner. No new overlapping suite. Final fresh summary/serializer/
   retirement/scheduler focused rerun if source changes; do not rerun unchanged completed gates casually.
2. Apply reviewer default-on condition honestly using complete scale+CPU profile0 data BOTH modes. If uncertain
   or noisy not justified, safe default accounting off with explicit BGT_CPU_ACCOUNTING=1 enable and truthful
   unavailable output. Existing default-dependent dedicated tests may need explicit enable, not weakened assertions.
   Main benchmark profile1 isolates total scheduler addition with C profiling held on; microbench isolates snapshot.
   Retain raw samples/resources/identity and artifact hashes before cleaning. No K10 borrowed percentages.
3. Strengthen end-to-end acceptance where still missing: actual guest-import-driven multithread known-count
   Sleep/event/yield/callbacks and real range-ReadFile polling (current test directly controls I/O-account hook).
   Check native present path boundary, actual abort freeze, nested parks, deferred imports, control/memory faults,
   all clock models, REP rules and exited lifetime. Real scheduler hand-clock fixture already passes exact budgets.
4. Sensitive controls audit/repair; summary BigInt/post-present boundary mutation still unimplemented.
5. Finalize docs/pipeline.md with default and measured overhead; durable small evidence/handoff, no giant wasm.
6. All Tier1 on unchanged final source SERIAL/BACKGROUND: doctor; full lint Clang + real GCC example checks
   (including scale; explicit Clang host if npm lint uses GCC); types; full npm test; BGT_REQUIRE_WEBGPU=1 full
   npm run test:e2e BOTH suspension modes (actual WebGL2+WebGPU); leakcheck; EVERY pipeline oracle300 in BOTH
   modes. Keep exact x64-gl-scale-only expected-error contract. No new skips/deadlines/tolerance weakening.
7. Fresh independent validation/session reviewer-coordinated; none ran in lane. Commit lane/K31, never push.
   Finish docs/handoff/K31.md and final <200 words only when honest gates/remaining boundaries recorded.

## Unrun gates / limits

No final-tree doctor, full Clang/GCC lint, full units, browsers, oracle sweep, leakcheck, full overhead,
completed sensitivity or independent validation/CI. The initial38 check-build lint succeeded but is not final
source acceptance. docs/handoff/K31.md is older WIP; this checkpoint supersedes its next-step state.
Reviewer #273 explicitly requests ending session here. No compaction or success claim.
