# Guest heap contracts (CC0)

`heap.c` is original CC0-1.0 source, compiled normally by the pipeline for AMD64 and (via
`../x86-heap/game.json`) i386. It imports Windows APIs, resolves the CRT allocation family dynamically,
and asserts actual contents, exact requested sizes, alignment, ownership, flags, failure returns and errno.
No BGT imports, game files, captured sources, or overrides.

The fixture includes fragmentation with 12,000 allocations, interleaved realloc/free, next-free in-place
growth, shrink/regrowth zeroing, both-side coalescing, moved realloc, separate heaps, quotas/destruction,
virtual-reservation gaps and all CRT aligned/offset/reallocation families. AMD64 catches real
STATUS_NO_MEMORY exceptions using a compiler-emitted SEH table and the existing generic dispatcher.
The shared negative fixtures separately require an unhandled exception (AMD64) or explicit missing-SEH
fault (i386), in both lifted and interpreted builds. Both complete examples have 300-frame differential
oracles; unit and browser tests require the explicit summary, zero failures and no interpretation/stubs.

Allocator and deliberate bounds: `platforms/win32/CONTRACTS.md`, guest heap section.
Performance workload (250,000 mallocs / 216,667 reallocs): `tests/fixtures/c/heap_bench.c`, driven by
`node tools/bench/heap-bench.mjs [revision|working] [output.json]`. This measures the real allocator
with native C accessors and simulated successful mapping, **not** browser/game performance. Its outputs
include per-phase CPU time per operation, exact live count, heap extent, checksum and resource snapshots.
