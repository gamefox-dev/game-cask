# K29 leaf admission audit (source, not test certification)

The generated `N_*` frame cannot suspend. Type-separated `x86_leaf_import_fn` and `w32_leaf_fn`
entry points therefore have a deliberately narrow allowlist. Neither the lifter nor loader guesses
leaf status from an arbitrary import name; the profile installs a typed adapter only for audited implementations.
The general bound callback-capable signature is invoked only after returning to the outer native driver.

| Explicit adapters | Reachable implementation | Suspension/callback/SEH boundary |
|---|---|---|
| malloc, calloc, realloc, free | shared `w32_crt_alloc.h` → `w32_heap_*` → `hb_alloc/realloc/free` | fixed owner0, no heap exception flag dispatch; no new-handler/invalid-parameter callback invoked |
| allocation failure | `crt_errno` → lazily initialized `crt_errno_cell` → `w32_misc_alloc` | guest backing allocation/checks only; no callback, scheduler or explicit exception dispatcher |
| strlen/wcslen, strcmp/wcscmp, strncmp/wcsncmp | `str_len/str_cmp` → `sch64` → checked read | no allocation or guest invocation; out-of-range/protected/unmapped read aborts via `x86_fault` |
| GetLastError | authoritative current TEB error cell | pure read, mirrors ordinary per-thread implementation |
| SetLastError | current thread/TEB error cell | pure write, returns same shared bridge result |
| GetCurrentThreadId | current cooperative task index+1 | no scheduling/object allocation |
| TlsGetValue | TLS allocation mask/current TEB vector, current TEB error cell | exact shared success/error LastError effect, pointer-sized result; no FLS callbacks |

Before the envelope, `w32_thread_leaf_ready` refuses callback scopes, any transfer, pending wait kind,
yield request or deferred result. This is a non-consuming eligibility check. Refused bindings take
the ordinary bound-driver path, including its scheduler/park behavior. Callback/pending context tests
exercise the actual gate; the profile PE includes real qsort guest callbacks and Sleep suspension.

Not admitted: qsort/bsearch callbacks, new/delete, FLS operations, guest/thread creation, waits/yields,
RaiseException/RtlUnwind*, I/O or any generic CRT/thread/Win64 dispatch. Adding an adapter requires
updating the explicit leaf classification regression and auditing its complete failure call graph.
`ca_zero`, `hb_zero` and heap metadata policies retain their pre-existing shared implementation limits;
this lane does not claim a new general invalid-free or access-violation SEH subsystem.

Every accepted call retains the profile trace/API counters, Win64 home writes, result and return-stack
handling; all GPRs/flags/clocks are synchronized around the leaf. No guest register-local or raw host
memory pointer is authoritative across a leaf capable of growing the bounded guest backing. Loader
bindings/site caches are allocated or initialized once, not per invocation. Requested guest heap
allocation by malloc is of course still performed.
