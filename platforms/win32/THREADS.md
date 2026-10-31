# Cooperative guest threads

`w32_thread.c` implements the same API signatures and state machine for i386 and AMD64. It uses
`x86_sched.c`, not browser workers, host threads, a guest instruction interpreter, or engine-specific paths.
No BGT ABI change is required: the only suspending host import remains `bgt_yield`.

## Scheduling policy

- Thread IDs are monotonically assigned, starting with primary thread 1. The bounded process admits 64 total
  thread creations including the primary thread; exhausted tables fail explicitly with ERROR_NOT_ENOUGH_MEMORY.
- Each context contains all guest GPRs, XMM registers, flags, MXCSR, K3 x87 stack/tags/control/status,
  FS/GS bases, instruction clock and PC/SP.
  Workers have independent guest stacks, TEBs, last-error cells, static TLS templates and dynamic TLS/FLS values.
- A blocking thunk first completes its guest return/stack cleanup. It requests transfer value 2, which unwinds
  generated native C frames to the process driver. The driver saves the context, resolves waiters, then chooses
  the next credited runnable context strictly after the previous one, wrapping through the fixed thread table.
  Default equal weights preserve round robin. Kernel SetThreadPriority -2..2 and AVRT use weights 1..5;
  kernel IDLE/TIME_CRITICAL (-15/+15) map to endpoint weights, not host realtime. GetThreadPriority preserves
  the kernel-requested Windows value. Credits refill only when eligible peers exhaust a round, never on a setter;
  repeated high-priority calls cannot starve peers (bounded by 5×64 selections). AVRT uses the same last-setter
  scheduler hook and revert restores its default weight.
  An SEH/longjmp transfer (value 1) instead resumes the same context.
- Wait arbitration scans in that same rotating order. Wait-any chooses the lowest available array index;
  wait-all checks every object before consuming anything. Auto events consume one signal, semaphores one token;
  manual events stay signalled. Mutex acquisition is recursive and an exited owner's mutex reports abandonment.
  Lock release reserves ownership for queued waiters; new SRW readers do not bypass a waiting writer.
- Sleep(0) and SwitchToThread rotate immediately. Sleep/SleepEx and finite object/CV/address waits use unsigned
  elapsed virtual milliseconds, never wall time. When nobody is runnable, the scheduler advances virtual time
  in 1 ms increments, yielding through `bgt_yield` at frame boundaries. INFINITE waits have no deadline.
- A CPU-bound thread reaches a deterministic two-million-instruction quantum, yields a browser frame and rotates.
  Lifted and interpreted execution use the same accounting. AMD64 REP operations can suspend between iterations;
  i386 REP is one indivisible guest instruction. LOCK instructions/exported Interlocked operations are indivisible.
- Legacy USER/file frame waits can retain native profile C locals. At their frame yield, a parked continuation
  lends execution to runnable workers and is restored only to its exact original host caller. Guest callbacks
  mark their native continuation depth: blocking thread APIs park/resume that continuation rather than discard it.
  Nested parks exclude outer native continuations until the inner call returns; this is not general native fiber
  stack switching. CPU quantum rotation is deferred inside such callbacks, though frame yielding still occurs.
- A blocked call contributes its actual completion/timeout result to the oracle trace when it wakes, not the
  temporary return-register placeholder. Signals reserve waiting auto-event tokens before a subsequent ResetEvent.

Guest PC continuation dispatch is explicit labelled C. AMD64 uses its existing instruction-range dispatcher;
for i386 the lifter emits exact instruction entries and a label-entry switch. `lift.entries` records registry
size separately from `lift.functions`. The runtime's `lifted_functions` metric still counts source functions.
There is no decoder/fetch loop in the generated code, and the fixtures assert zero interpreted instructions.

## Implemented surface

CreateThread, _beginthread/_beginthreadex, ExitThread, _endthread/_endthreadex, GetExitCodeThread,
GetThreadPriority/SetThreadPriority, thread handles/current IDs, CREATE_SUSPENDED + SuspendThread/ResumeThread; WaitForSingleObject[Ex]/WaitForMultipleObjects[Ex]; unnamed manual/auto events,
recursive mutexes, counting semaphores; critical sections, exclusive/shared SRW locks and condition variables;
WaitOnAddress/WakeByAddressSingle/All; Sleep/SleepEx/SwitchToThread; scalar/pointer/64-bit Interlocked operations;
64 reusable TLS slots, 128 reusable FLS slots with destructor callbacks (four exit passes).

TEB self/process/thread IDs, stack limits, PEB pointer, last error and inline dynamic TLS slots have guest-width
layouts. Static TLS templates and zero-fill are copied per worker; TLS callbacks receive THREAD_ATTACH/DETACH.
The AMD64 primary PEB was moved out of the full TEB to avoid aliasing TLS slots at TEB+0x1480.

## Explicit compatibility boundaries

This is a bounded single-process cooperative profile, not arbitrary Windows compatibility. The lock registry holds
512 live lock addresses; DeleteCriticalSection releases its entry for reuse. Named object namespaces
are rejected with ERROR_NOT_SUPPORTED; no cross-process handles, security/access enforcement, APC queues, alertable
APC delivery, host realtime scheduling, asynchronous TerminateThread, fibers, or dynamic module attachment.
SuspendThread counts are implemented cooperatively and remain independent of sleep/event waits; this is not
asynchronous host-context suspension. GetThreadContext/SetThreadContext fail explicitly rather than invent snapshots.
The Ex wait/sleep APIs provide ordinary waits (no APC delivery). Handles are non-reused numeric slots (1023 total
synchronisation/thread handles); closing one never terminates its worker. Stacks/TEBs are retained for process life.
Native callback nesting is LIFO: cyclic dependencies between separately parked profile callbacks need general native
continuation switching. Existing InitOnceExecuteOnce remains the older single-thread bridge, not a new concurrency
contract. Broader CRT per-thread locale/errno remain bounded. Whole-CPU copies isolate x87 state per thread;
precision/exception boundaries are documented in [X87.md](../x86/X87.md).

## Evidence / reproduction

- `examples/x64-threads`: normal linked MinGW-target CRT at -O2. Four workers consume an eight-slot queue, using
  an event barrier, critical section + condition variable, and semaphore backpressure. Thread exit codes total 406;
  96 jobs produce checksum `d494e6e3159c5fea`. `tests/support/native-threads.ts` compiles/runs the same original CC0
  queue/checksum source with pthread adapters and compares the entire printed result, as the CRT fixtures do.
- Windows-only contract assertions cover wait-any/all consumption, timeout/last-error, recursive mutex ownership,
  semaphore overflow/previous count, SRW shared/exclusive contention, CV timeout/reacquisition, critical recursion,
  TLS exhaustion/reuse/isolation, inline FS/GS TEB fields, static TLS callbacks, FLS destructor, explicit ExitThread,
  current-thread pseudo-handle exit status, 520 distinct initialize/enter/leave/delete CS lifecycles per architecture,
  address wake/timeout, and an instruction-quantum spin worker.
- `examples/x86-threads`: nested lifted caller/worker stacks, stdcall cleanup, FS/TLS/last-error isolation,
  event/CV/mutex waits, joins and full-width EDX:EAX Interlocked64 return/argument contracts.
- `tests/unit/threads.test.ts`: native comparison, two identical 300-frame state-hash sequences, zero interpretation,
  both 300-frame differential oracles and shared import census. `tests/e2e/threads.spec.ts`: complete both fixtures
  on WebGL 2 and WebGPU, asserting trace change, known completion output, zero interpretation/stubs/errors.

These are console conformance fixtures, not claims of game boot/interactivity/playability. No game files, system
installations, external downloads or Windows-host binary execution are involved.
