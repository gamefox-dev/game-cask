# Lane C — cooperative deterministic threads

## Finish line

Implemented in `platforms/x86/x86_sched.{c,h}` and `platforms/win32/w32_thread.{c,h}`. Scheduling policy,
implemented APIs and precise compatibility limits are in `platforms/win32/THREADS.md`. No BGT ABI change.

- `examples/x64-threads`: normal compiler CRT startup, -O2, no overrides. Producer/consumer queue, four workers,
  event barrier, critical section + condition variable, eight-token semaphore pipeline, timeouts and exit codes.
  Same original CC0 queue/checksum code is compiled natively with pthread adapters, as the CRT reference tests do.
  Exact result: `threads checksum=d494e6e3159c5fea processed=96 exits=406 errors=0 PASS`.
- Additional Windows contract checks cover auto/manual event consumption, wait-any/all, mutex recursion/ownership,
  semaphore overflow, CS recursion/CV reacquisition, SRW shared/exclusive/CV waits, WaitOnAddress wake/timeout,
  FLS destructor, explicit ExitThread, TLS exhaustion/reuse, static TLS attach/detach, GS TEB/last error, and
  a CPU-bound spin worker that only progresses if its instruction quantum permits the signaller to run.
- `examples/x86-threads`: independent FS/TLS/errors, nested caller-stack resumption, thread/event/mutex/CV waits,
  stdcall cleanup, thread exit codes and full-width EDX:EAX Interlocked64 argument/result checks.
- Both fixtures have zero interpreted instructions/stubs, exit successfully, and have identical 300-frame
  lifted/interpreted oracles. The x64 fixture also compares every frame hash across two separate 300-frame runs.
- `tests/e2e/threads.spec.ts` completes both fixtures on WebGL 2 and WebGPU (four added browser cases).
  These are console conformance fixtures, not game-playability claims.

## Final gates

The recovery session reran all gates; current logs are in `/Users/dev/projects/pi-work/scratch-C/resume-*.log`.
Earlier `final-*.log` files are retained as historical evidence. Oracle reports are private
`reports/oracle-<id>.json`; browser evidence is `reports/e2e-results.json` and `reports/e2e-artifacts/`.

- doctor ready; lint and typecheck clean.
- Unit: **99 tests / 18 files passed** (baseline 96 / 17).
- Browser: **85 passed, 4 pre-existing skips**: WebGL 2 40+2 skipped; WebGPU 40+2 skipped; auto 5 passed.
- Leakcheck clean: **236 committable files checked**.
- Explicit `npm run oracle -- examples/<id> 300`: all eight `x64-*` examples plus `win32-hello`, each identical,
  no lifted/interpreted errors. Both thread-fixture oracles are also asserted by the unit suite.

An initial simultaneous baseline unit/e2e invocation raced the existing fixture/tool build cache. It was rerun
sequentially: baseline 96 unit / 81 browser passes, 4 skips. No cache-concurrency claim/fix is made here.
The first full implementation browser run found a callback Sleep regression (Phase 0 conformance, both backends);
parking the native callback continuation fixed it. Existing assertions were not changed; targeted eight-case
browser rerun and then the full suite passed. TLS-detach counters also caught a real normal-return cleanup bug:
clearing the scheduler transfer before executing detach callbacks fixed it; the assertion remains in the fixture.

## Necessary cross-ownership integration (marked `/* LANE-C */`)

- `platforms/win32/w32_core.c`: thread API priority, actual deferred-result trace, completed-thunk transfer,
  primary scheduler loop, native-yield handoff, pre-TLS thread identity and separate PEB page mapping.
- `platforms/win32/w32_int.h`: AMD64 PEB moved beyond the full TEB, avoiding inline TLS slot overlap.
- `platforms/win32/w32_kernel.c`: file/module errors use current TEB error; CloseHandle routes the disjoint
  synchronisation-handle namespace. Old thread/TLS/interlocked/critical-section entries were moved out.
- `platforms/win32/w32_x64.c`: old thread bridges removed (owned area); one unwind bounds check now uses the
  current TEB stack limits, so worker stacks are not rejected as outside the primary stack.
- `platforms/x86/x86.h`: shared scheduler hooks and per-context callback depth.
- `platforms/x86/x86_rt.c`: transfer propagation, resume-entry lookup, architecture-neutral hook, thread-return
  sentinel and callback continuation depth. Source-function metrics do not count i386 continuation entries.
- `platforms/x86/x86_exec64.c`: instruction/REP quantum can return before executing the pending instruction.
- `tools/x86/lift64.h`: propagate quantum transfer from each lifted instruction.
- `tools/x86/x86tool.c`: resumable i386 label entries, exact continuation registry, transfer propagation,
  instruction quantum and additive `entries` statistic (distinct from function count).
- `tools/build/pipeline.mjs`: compile scheduler/thread sources and use continuation registry count in the driver.
- `tools/x86/imports-coverage.mjs`: census uses the new shared thread signature table on both guest widths.

No changes to `docs/v03-status.md`, `docs/verification.md`, BGT runtime/ABI, game inputs or other lanes' fixtures.

## Remaining compatibility boundaries / next-lane issues

See THREADS.md for explicit bounds (64 lifetime thread slots, 1023 non-reused handles, 512 live lock addresses), unnamed
single-process objects, retained stack/TEB allocation, no APC delivery/priority/asynchronous thread termination or
fibers. Native profile callback continuations are LIFO, not arbitrary native-stack fibers; cyclic dependencies
between separately parked callbacks need general continuation switching. CPU quantum thread rotation is deferred
inside native callbacks, though browser frame yielding remains active. Existing InitOnceExecuteOnce, CRT locale/errno
and x87 per-thread state were not expanded by this lane. These are compatibility limits, not fixture exceptions.
Hardware iPhone/Safari/Firefox testing was not performed.

## Independent validation

Two fresh ephemeral pi sessions performed read-only review and executed the focused thread suite independently.
The first review found two concrete bugs despite the passing broad gates: deleted critical sections consumed
permanent registry entries, and GetExitCodeThread rejected GetCurrentThread's pseudo-handle. Both were fixed.
Both architecture fixtures now check 520 distinct CS initialize/enter/leave/delete lifecycles and assert
`GetExitCodeThread(GetCurrentThread(), ...) == TRUE` with STILL_ACTIVE. These assertions fail against the old code.

The second fresh session rechecked both fixes and reran
`npx vitest run --config /Users/dev/projects/pi-work/scratch-C/vitest.config.mjs`: **3 tests passed**; verdict
**PASS**. Reports: `scratch-C/independent-review.md` (initial FAIL, retained) and
`scratch-C/independent-recheck.md` (PASS), alongside both session logs. The reviewer executed the native reference,
300-frame/two-run and differential tests through that focused suite; it inspected, rather than reran, the broad
saved gate logs. The coordinator reran every required broad gate and all nine explicit oracles after the fixes.
No test assertion was weakened or removed. These reviews make no game-playability claim.

## Recovery-session verification

Reviewed the recovered tracked diff and every new source/test/fixture: no truncated writes were found. Required
build, unit, browser and oracle gates were rerun sequentially, without duplicate suite execution. The native-reference
helper now removes its temporary executable directory in `finally`, including compile/run failures. Lane-owned
scratch build outputs were removed; no files outside this clone or scratch were deleted. No ENOSPC recurred.
Successful build gates include existing compiler/linker warnings; they are not a warning-free-build claim.

A further fresh ephemeral pi session independently reviewed the recovered implementation and ran the focused
thread suite once: **3 tests passed**, verdict **PASS**, no concrete finish-line blockers. Its actual report is
`scratch-C/resume-independent.log`; it inspected the resumed broad gate logs rather than rerunning them. An initial
validator launch failed provider authentication before executing validation; the explicit lane-provider retry
produced the successful independent report. This session did not reuse an earlier validator conversation.
