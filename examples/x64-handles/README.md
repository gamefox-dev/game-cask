# Owned Win32 handle contracts (CC0)

`handles.c` is original CC0 synthetic code, compiled by the ordinary MinGW-target CRT at `-O2`.
It exercises documented Win32 contracts, not any engine behavior. No original Windows binary is run on the host.
The companion `../x86-handles` builds the same source with the baseline i386 entry contract (normal i386 UCRT
is not supported by this profile).

Coverage includes current-thread pseudo duplication followed by priority/TLS use; real aliases, access masks,
SAME_ACCESS/CLOSE_SOURCE, per-handle inheritance/protect-close flags; process/thread IDs and open-by-ID;
worker priorities, joins/exit codes, mixed waits; shared event/mutex/semaphore state; shared file cursor/lifetime;
registry-key ownership/rights and RegCloseKey; console aliases including 300 bytes with an embedded NUL;
full-width invalid handles/pointers, protected output spans and failure byte counts. Two 2,048-cycle churn loops
require reusable handle/object/file capacity; a concurrent allocation exhaustion test requires truthful failure,
CLOSE_SOURCE on failure, and restored capacity after release. Thread creation failure must not consume lifetime slots.
The fixture finishes by terminating this process through an owned process alias.

`tests/unit/handles.test.ts` checks named assertion failures, completion, normal-CRT metadata, exact console bytes,
zero interpreted instructions/stubs and independent 300-frame lifted/interpreted comparisons for both widths.
`tests/e2e/handles.spec.ts` checks completion and trace change on actual WebGL 2 and WebGPU.
The oracle compares two execution modes against one profile; it is not a native-Windows conformance oracle.

Boundaries: one cooperative process, bounded concurrent table and lifetime scheduler slots; no external process,
named cross-process object, mapping, pipe, native Windows console, ACL/impersonation or asynchronous context backend.
See `../../platforms/win32/CONTRACTS.md` and `THREADS.md`. Above-window pointer rejection tests concern this profile's
checked guest-address model, not a claim about undocumented native Windows HANDLE bit canonicalization.
