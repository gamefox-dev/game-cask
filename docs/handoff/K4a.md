# Lane K4a — owned Win32 handles (Q10/Q11)

Implementation commits: **94e8bea** (shared ownership/aliases and fixtures), **a0ef170** (sync-release validation),
**4a41222** (truthful legacy registry deletion stub annotations, reviewer-requested).
No push, game files, host PE execution, web fetch, system installs, engine-specific branch or test weakening.
External measurement files were read in place; none was copied into this repository.

## Delivered contracts

- One shared object/handle table for both guest widths: scheduler threads, this process, events, mutexes,
  semaphores, read-only asset files, standard endpoints and opened registry keys. Each owned alias has independent
  access/INHERIT/PROTECT_FROM_CLOSE state and references its shared object. File cursors and asset lifetime are shared;
  last close releases the asset exactly once. Closed handle slots and disposable object slots are reusable.
- DuplicateHandle converts canonical current-thread/current-process pseudo-handles to distinct owned handles;
  supports same-process source/target aliases, SAME_ACCESS, CLOSE_SOURCE (also on failure and close-only NULL target),
  independent inheritance, requested/generic rights, output-span checks, and full-width invalid-handle rejection.
  NULL output retains the documented legacy lost-handle behavior. No fake ownership or scheduler-slot allocation.
- Thread aliases work with waits, exit code, priority, suspend/resume and IDs. OpenThread takes IDs, not handles;
  live thread identity survives zero handles, completed identity survives retained aliases, and final close removes
  a completed thread's open-by-ID identity. `_beginthread` auto-close serials cannot close a recycled handle.
  Failed oversized-stack creation no longer consumes a lifetime thread slot.
- Same-process OpenProcess, GetProcessId/GetThreadId, current process exit/affinity queries, limited-query access,
  and TerminateProcess's second-argument exit code. Mixed thread/process/event/file waits preserve object semantics.
- Get/SetHandleInformation works across owned kinds; ordinary protected close fails. Registry keys use RegCloseKey;
  CloseHandle preserves Windows' documented ineffective-success registry exception. Minimal registry/CRT adapters
  were necessary because the original path tokens and magic standard-output values were not owned handles.
- File calls validate full-width pointers before narrowing, respect rights, initialize failed I/O byte counts and
  preserve shared positions on failure. Console WriteFile preserves length-delimited bytes beyond 255 and embedded
  NULs. Invalid GetStdHandle selectors return full-width INVALID_HANDLE_VALUE on AMD64.
- ReleaseMutex/ReleaseSemaphore reject wrong object kinds with ERROR_INVALID_HANDLE; nonpositive semaphore counts
  return ERROR_INVALID_PARAMETER, overflow ERROR_TOO_MANY_POSTS, and inaccessible/full-width previous-count outputs
  fail without changing the semaphore count.

Q11: DuplicateHandle and OpenProcess are genuinely result-producing, not FAPI. GetThreadContext/SetThreadContext
remain TF failure-only; process/pipe creation remains FAPI failure-only. Census regression checks both widths,
capabilities and unique registrations. `dlls.json` documents that availability is not behavioral completeness.
See [CONTRACTS.md](../../platforms/win32/CONTRACTS.md) and [THREADS.md](../../platforms/win32/THREADS.md).

## Audit scope / evidence limitation

The supplied gap census contains 48 KERNEL32 names: all 48 resolve on AMD64 (**34 result-producing / 14 failure-only**).
On i386, 33 are result-producing, 14 failure-only; the AMD64-specific C scope handler is intentionally unknown.
The DLL-only import inventory contains no NTDLL and no implemented mapping backend was found; reviewer explicitly
accepted leaving mappings unimplemented. The supplied files contain no full target import-name dump: the suggested
analysis summary has only instruction census and empty startup import lists, and PE metadata lists DLLs only.
A follow-up bridge question timed out with the explicit default to audit supplied gaps plus the relevant complete
profile registry and record this limitation. Therefore **a full target-import-name audit is not claimed**.
The registry audit found and repaired pseudo/ID/access/exit/standard-handle and release-validation gaps described above.

The minimal CRT standard-handle and existing `x64-contracts` test adapters are cross-ownership edits; the bridge
question timed out with its explicit safe default to make those adapters. The same default authorized the minimal
registry-owned-key adapter, not a general registry rewrite. Existing broader registry namespace/value-disposition/
delete semantics and arbitrary registry pointer validation remain outside this lane's handle-identity delivery.
In particular RegDeleteValueA/W were pre-existing unconditional-success handlers. The reviewer explicitly accepted
leaving real deletion out of scope, but requested truthful annotation: these are now STUB registrations (with
census regressions), not falsely advertised implemented handlers. Calling them records a stub; this lane does not
claim to have implemented registry deletion. No fixture/oracle hides a called stub.

## Fixtures and independent known outcomes

`examples/x64-handles`: normal linked MinGW CRT, **-O2**, original CC0 C, no overrides. Startup performs
process/current-thread/process SAME_ACCESS duplication, then priority and TLS use. The i386 companion shares the
source with a baseline no-CRT entry, **not** a claim of normal i386 UCRT support. Named checks cover aliases of every
supported kind, rights/flags, source closure, failure outputs, protected memory, mixed waits and termination.
Two 2048-cycle loops require handle/file capacity reclamation; concurrent exhaustion requires truthful error,
CLOSE_SOURCE failure cleanup and restored capacity. A worker checks pseudo identity relative to its caller.

Final fixture measurements at 4a41222:

| Fixture | Named checks (including churn) | Lifted functions / instructions | API names / calls | Overrides / interpreted / stubs |
|---|---:|---:|---:|---|
| x64-handles | **9455, 0 failures** | **81 / 4161** | **74 / 23078** | **0 / 0 / empty** |
| x86-handles | **9438, 0 failures** | **450 / 48301** | **55 / 23026** | **0 / 0 / empty** |

The larger i386 count includes compiler/import support code; it is not a larger hand-written test or a performance claim.
Both fixtures require zero interpreted instructions/stubs and matching **300-frame** lifted/interpreted oracles;
the oracle compares two execution modes against one profile, not native Windows semantics. Incoming high-half
handle/pointer tests concern the profile's checked address model, not undocumented native HANDLE canonicalization.

## Final gates

Final frozen-code rerun at 4a41222: doctor ready, lint (ESLint, real GCC and **all 24 example check-builds**),
typecheck and leakcheck pass. Unit **507 tests / 44 files passed**, zero skips/failures. Browser with WebGPU required
on owned `BGT_E2E_PORT=5203`: **200 passed / 51 existing intentional skips / 0 failures / 0 flaky**; WebGL 2
**91 pass / 24 skip**, WebGPU **101 / 26**, auto **8 / 1**. No backend-unavailability skip or weakened assertion.
Leakcheck includes **436 committable files** with this handoff. No developer `:5173` server was touched.
Logs/reports are ignored local evidence under `.scratch-K4a/` and `reports/`; final result markers are in
`final-complete.log` and `final-snapshot.log`.

Final explicit pipeline oracles: **20/20 × 300 frames = 6000 identical frame pairs**, both errors null,
all lifted `interp_insns=0`, all stub lists empty. Inventory: win32-conformance, win32-hello, x64-audio,
x64-basics, x64-contracts, x64-cpp, x64-cpprt, x64-crt, x64-gl, x64-gui, x64-handles, x64-input, x64-memory,
x64-scale, x64-smoke, x64-sysdlls, x64-threads, x64-tls, x86-handles, x86-threads. Four native BGT examples have
no guest interpreter oracle; their build/browser coverage is not mislabeled as differential validation.

Earlier red runs were retained, not represented as green: the independent reviews caught real defects, and an
initial broad run during source updates compared a stale lifted fixture with a newer interpreted fixture. Complete
frozen reruns replaced that evidence; no test was weakened. A temporary scratch metrics probe was removed after it
triggered ESLint's no-explicit-any rule; the final lint was rerun successfully with the scratch probe removed.

## Independent validation actually run

Three fresh independent sessions reviewed successive snapshots, without claimed delegation that did not run:

1. Source-only review found fixture redeclaration/magic-standard-handle assumptions, lifetime capacity regression,
   I/O count/rights/pointer issues and limited process-query access. It explicitly did **not** run stale fixtures.
2. Fresh recheck ran **3 focused tests** on current fixtures and confirmed repairs, but found GetStdHandle's invalid
   AMD64 sentinel was still zero-extended. Both-width invalid-selector regressions and shared-width dispatch fixed it.
3. Fresh final session reviewed **94e8bea**, ran **3 focused tests / 1 file**, checked source/payload currentness and
   returned **PASS within bounded handle scope**. It also executed the new serial-recycling and terminated-ID checks.
   It did not run broad/browser gates, and its PASS predates the small sync-release correction in a0ef170.

4. A fourth fresh independent session reviewed **94e8bea..4a41222** and verified source/manifest/payload currentness,
   then ran **3 focused tests / 1 file** (final verified run **1.89 s**), including both-width 300-frame oracles and
   new census assertions. **PASS within the two post-PASS deltas**; report `independent-post-audit.md`.
   No broad/browser results are attributed to that reviewer. Registry deletion remains explicitly out of scope.

## Explicit boundaries / integration follow-up

- 1023 concurrent handles/object identities, 63 live asset files, 64 persistent registry path entries; 64 lifetime
  scheduler threads including primary. Closed numeric slots may be reused, as on Windows. Stacks/TEBs remain retained.
- One cooperative process; no cross-process security/ACL/impersonation, mapping, pipe, named-object namespace,
  asynchronous thread context/termination, general native console input/waits or host realtime semantics.
  File rights cannot be escalated beyond the opened read-only asset. Unsupported facilities fail explicitly.
- Other lanes' Q12/Q13/Q14 tooling fixes are not implemented here. No target re-trial/startup/playability or physical
  mobile-device claim. The porter must resume the actual target after integration; further blockers remain possible.
- Full import-name evidence is missing as described above. Broader pre-existing registry semantics are not certified.
- Temporary fixture/test outputs were cleaned as appropriate; no ENOSPC occurred and no outside-clone files were removed.
