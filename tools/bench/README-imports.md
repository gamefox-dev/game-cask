# Guarded AMD64 imports (K29)

Original CC0 fixture only; no original game input. The benchmark generates a minimal PE per hot import,
with a hand-written Win64 loop and original import-only CRT COFF subsections.
No compiler CRT startup is linked. The normal PE loader binds the IAT.

```sh
BGT_IMPORT_COUNT=1000 BGT_IMPORT_REPORT=/absolute/smoke.json \
  npx vitest run --config tools/bench/imports.config.ts
# Full sample uses 100000 calls per instance (the default).
BGT_IMPORT_REPORT=/absolute/after.json \
  npx vitest run --config tools/bench/imports.config.ts
```

Run before/after serially with the same benchmark and fixture generator, dependencies and toolchain.
The baseline is dev.16 `50960e9`; do not emulate it by merely disabling one after-path.
Each row first passes a 300-update lifted/interpreted oracle. One discarded fresh-instance warmup
and five fresh-instance samples follow. Host timestamps at `IMPORT begin/end` delimit only the
assembly loop. Instantiation and per-frame work after the end marker are excluded. malloc cleanup
and free preparation are outside the markers. The loop includes argument setup, result writes and
its branch; ns/call is not an isolated native API instruction cost. Exact API counts, reason-5 census
and all available boundary counters accompany raw times/resources; dropped census is a failure.
The baseline has no new K29 counters, so missing counters must not be reported as zero.

Functions: strcmp (tail veneer, IAT and copied nonvolatile register forms), GetLastError, SetLastError,
TlsGetValue, GetCurrentThreadId, malloc and free. Owned fixture/pipeline outputs are removed in
`finally`, including interpreted outputs. Shared content-addressed compiler caches remain governed
by the existing byte-budget cache, not deleted across lanes. Results under shared-machine contention
are bounded synthetic evidence, not an engine or game speedup.
