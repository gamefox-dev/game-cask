# K31 checkpoint — reviewer #269 requests a fresh session

**WIP, not Q78 acceptance.** Branch lane/K31, base dev.18 211daca.
Initial implementation commit f3ed073; checkpoint follow-up is the commit containing this file.
No push, installs, web, game inputs or compaction. Test port BGT_E2E_PORT=5276.
External owned evidence: /Users/dev/projects/pi-work/scratch-K31.

## Read first / evidence

Read AGENTS.md/CLAUDE.md, docs/pipeline.md profiling/census/scheduler sections,
docs/v03-status.md and K10/K26 handoffs. Required read-only porter proposal:
/Users/dev/projects/pi-work/trial-mmx8-001/reports/perf-mp3/summary.md and metric-contract.md.
No game data was read or copied. Previous status: docs/handoff/K31.md (also WIP).

## Implemented, not proven complete

1. Separate monotonic process and per-task u64 retirement, by lifted/generic/interpreted
   execution. Does not use restored X.tsc as a process clock or change TSC semantics.
   AMD64 batches clock deltas at existing native synchronization boundaries, excluding
   the current faulting instruction. i386 commits after semantics and before calls/control
   transfers. Generic/interpreted commits after semantic completion; pre-execution quantum
   attempts and incomplete REP dispatches do not retire. REP retires once at final completion,
   not per iteration/partial dispatch. Import bodies/callback scaffolding add no instructions.
2. Scheduler account table (64 non-reused identities), start address/state, lazy host-wall
   durations by ready/sleep/event-object/I/O/suspended/host-yield, separate virtual-state
   milliseconds, requested finite waits/infinite-wait count, switch-ins, parked host wall.
   Metadata/retirement survive context restore and census reset. CPU time is explicitly null.
   Win32 hooks: block/wake/create/exit/suspend/resume/scheduler/file-request polls/park/abort.
3. Native-present cumulative process/thread snapshots in a bounded 64-row ring, explicit drops.
   Raw execution_accounting JSON preserves retirement as decimal strings (full u64). Host
   subtracts consecutive presents using BigInt before safe numeric conversion. No post-update
   or TSC approximations: only wholly-contained intervals. Probe reports instructions/frame,
   instructions/active-wall-second and guest-thread count. Active wall is NOT CPU time.
4. BGT_CPU_ACCOUNTING=0 erases new hot-path retirement/accounting work and reports unavailable.
   Profiling-off retains cheap retirement/metadata, no scheduler timing/present snapshots.

Files: platforms/x86/{x86_profile.h,x86_rt.c,x86_sched.[ch],x86_lift*.h};
platforms/win32/{w32_core.c,w32_thread.[ch],w32_kernel.c}; tools/x86 emitters;
tools/build/pipeline.mjs; bgt/runtime/{host.ts,instruction-accounting.ts}; tools/probe/probe.mjs.
Existing snapshot-only C harnesses gained counter storage, no semantic substitutes/assertion
weakening. Serializer capacity fixture now explicitly imports a hand clock.

Snapshot-only codegen/x87 harnesses now explicitly disable profiling (they have no clock
provider; dedicated real-runtime fixtures cover timing), avoiding a newly reachable
clock import in their exported synthetic scheduler helpers. This last test-only adjustment
also needs validation; no assertion was removed.

Last edits preserve original x86_sched_init placement after i386 TLS callbacks (no scheduling
change), but associate thread0 retirement storage at metadata creation; restore blocked reason
when resuming suspended blocked threads; freeze all identities at process exit and exclude
endless exited-thread parking. These last C edits need a clean post-edit compile/test.

## Reviewer decisions / measured numbers

Reviewer approved separate accounting opt-out versus tying retirement to sampled profiling:
retirement remains available with profiling off; scheduler timing/snapshots follow profiling.
**Condition:** keep default-on ONLY if incremental retirement overhead is small, target under
approximately 2% on CPU-heavy fixtures AND scale, BOTH suspension modes. If larger, default
off; keep BGT_CPU_ACCOUNTING as switch. Current WIP default is on: NOT an acceptance decision.

**Retirement-counter overhead: UNMEASURED (no samples/percentage).**
**Scheduler/snapshot overhead: UNMEASURED.** No throughput/60fps/game improvement claimed.
The porter's old observed-window overhead is not a K31 accounting-overhead measurement.

Initial focused run focus-initial.log/.exit: exit1, 3 tests passed, 1 serializer failure because
new time_us import lacked an import object. Fixed with explicit hand clock.
Initial types and types2: exit0 (before new retirement tests).
Retirement-only initial attempt: exit1, zero tests, malformed multiline TS source string.
Repaired escaping; types3 exit2 was the same parse error, not a production regression.
Checkpoint types: exit0 after escaping repair, includes both new TS test files.
Checkpoint check-host-gcc: exit0 (real GCC discovery and host checks; Apple link/deployment
warnings retained). These are NOT Tier1 or counter-correctness evidence.

## Owned background jobs — inspect exit files; never infer success

All paths below under scratch-K31. Do not delete outputs while roots run.

- Root50457: focus2 completed exit1: 54 failed /121 passed /175 tests, 1 failed +2 passed
  files, 422.59s. Compile failures initially lacked x86_profile.h in lifted headers, fixed
  during the run; NOT clean evidence. It is now running full npm run lint; ESLint and host
  GCC checks passed and example builds reached x64-audio at last observation. lint-initial.exit
  still pending. Do NOT launch a duplicate full lint or delete outputs until this root exits.
- Root3579: waits for lint-initial.exit, THEN focus3 (retirement.test.ts,
  instruction-accounting.test.ts, metrics-capacity.test.ts), THEN types4. Markers focus3.exit
  and types4.exit pending. Explicitly serial behind first runner. New tests NOT YET executed
  after escaping repair as of writing. No assertion/test deadline weakened.
- Root12836: static typecheck, check-host-gcc, then node tools/build/build.mjs
  examples/x64-smoke --check. checkpoint-types.exit=0, checkpoint-gcc.exit=0;
  checkpoint-build.exit=0: full x64-smoke build, 3,932 lifted instructions, 1,525,030-byte
  wasm, 50.379s cold build. Launched before final lifecycle edits. Root29638 reruns the same
  focused check after those edits; checkpoint-build-final.exit=0 (cached rebuild, 2.968s,
  all31 objects cached). This is a successful build check, not a clean full suite.
- Roots30087 (initial focused) and76105 (parse-failing retirement attempt/types3) finished.

Codegen and the parse-only retirement attempt briefly overlapped; latter failed before any
fixture builds/tests. Do not repeat: future suites serially. Do not generic-kill/shared-clean.

## Exact next steps

1. Inspect pending exits/tails, repair real compile/type/lint failures, get a clean focused
   compile on final C edits. The edited-under-running matrix is not clean evidence.
2. Run/fix retirement.test.ts. It generates original PE32/PE32+ and REAL lifts, links
   retirement_runtime.h to real decoder/semantics/runtime/scheduler: hand-counted 18-insn
   loop/CALL/CPUID/zero-REP, preexecution quantum, partial REP, faults, context restore,
   disabled counters, real Asyncify/JSPI park. NOT RUN after escaping repair. Verify expected
   counts for i386/AMD64, size/fast, profile0/1 and accounting0/1; no assertion weakening.
3. Add missing acceptance fixtures: actual Win32 CreateThread/Sleep/event wait/yield/
   suspend/resume/I/O, known instruction work, hand-clock active/ready/wait durations,
   parked callbacks; real C native-present capture/delta/drop/reset tests. Current new tests
   cover raw context selection and summary math, NOT full Win32 waits/present capture.
4. Review native invalid full-width targets, memory fault replay, precharged/nonaffine/affine
   clocks, fast/deferred imports/callbacks; generic/interpreter exactly-once completion;
   partial REP rule; nested parks/abort/exited lifetime. Preserve TSC/traces/scheduling.
   Handwritten overrides cannot invent retired guest instructions.
5. Sensitive negative controls: remove commit hooks, count attempts, restore process counts
   with thread context, include parked wall as active, move capture to post-update, lose
   drops. Retain failing-before evidence; none performed yet.
6. Measure matched CC0 CPU-heavy AND scale: account0/1 with profile0, interleaved multiple
   warmed samples, Asyncify AND real JSPI. Existing tools/bench/codegen.test.ts/config and
   benches give resource/oracle patterns. Also isolate scheduler/snapshot overhead. Keep
   inputs/traces/counts equal; retain resources/raw timings; delete owned large outputs
   after hashing. No borrowed K10/K26 percentages. Apply reviewer's default-on rule honestly.
7. Document fields/integer strings/clock domains/REP/import/callback/fault/reset/ring/drop
   semantics and measured overhead in docs/pipeline.md (not yet updated).
8. All Tier1 serial/background on unchanged implementation: doctor; full Clang and real-GCC
   lint/checks; typecheck; full npm test; BGT_REQUIRE_WEBGPU=1 npm run test:e2e BOTH suspension
   modes and BOTH backends; leakcheck; EVERY pipeline oracle300 BOTH suspension modes.
   Keep exact x64-gl-scale expected-error contract, existing assertions/skips/deadlines.
   Port5276, never developer5173. No full Tier1 gate passed on this WIP.
9. Fresh independent validator/session required, none ran. Reviewer coordinates. Commit
   lane/K31, never push. Finalize docs/handoff/K31.md with real evidence, not this checkpoint.

## Gate inventory

No doctor; no clean full lint (queued); no full units; no browsers; no oracle sweep; no
leakcheck; no overhead experiment; no negative controls; no independent validation; no CI.
Only precisely scoped early/static results above exist. Not completion/game/hardware/mobile
or performance certification. Reviewer #269 explicitly requested end-of-session here.
