# Lifted-code benchmark

```sh
BGT_CODEGEN_REPORT=/absolute/path/codegen.json \
  npx vitest run --config tools/bench/codegen.config.ts
```

Runs all seven current `examples/x64-*`, `win32-hello`, and a generated original CC0 integer CPU fixture.
The fixture lives in `node_modules/.cache/bgt/codegen-cpu`, never in a game input directory. It executes 512
noinline arithmetic functions 32 times, then prints the checked checksum `00000009 a47a8001` and sleeps.
It is engine-independent and uses the ordinary PE analysis/lift/build path.

Per program, the JSON records specialized/generic static counts, whole wasm bytes and bytes/instruction,
build time, compiler object/cache counts, Asyncify cache state, five run-time samples and their median,
console output, and runtime metrics (including generic executions, interpreted instructions and yields).
Every run must execute zero interpreted instructions and print no FAIL result. The CPU checksum is asserted.

Execution timing includes 300 fixed update/render/consume frames after loading/initialization; the first update
contains guest startup and the benchmark work. It excludes wasm compilation/instantiation and loader initialization.
One fresh-instance warmup is discarded before five fresh-instance samples. Small console programs spend much of
this interval in host/frame overhead: these numbers are not pure guest-CPU timings. No device/vsync/GPU timing claim.

Build time includes fixture preparation, analysis/lifting, compilation/linking/postprocessing and assets. Always
inspect cache counters: a cached build and an uncached build cannot establish a compiler speedup. Bytes/instruction
uses the entire module, including fixed runtime/profile and Asyncify costs, not marginal lifted-code size.

`BGT_CODEGEN_IDS=codegen-cpu,x64-crt` selects a subset for iteration. The default report is private
`reports/codegen.json`; `BGT_CODEGEN_REPORT` selects another destination. The benchmark has a separate Vitest
configuration so it does not add timing-sensitive tests to `npm test`. It deliberately does not assert speed ratios.

## Comparing against a commit

Use the same benchmark files on a detached worktree of the comparison commit, with the same Node/Zig/Binaryen
and environment. Build/run the two versions sequentially; do not run concurrent benchmark processes. Preserve
JSON from each version and compare matching IDs/instruction counts and checksums. Remove the temporary worktree
and generated scratch outputs afterwards. A performance gate must be evaluated from those reports, not from a
change in static specialized-instruction count alone.

Lane F evidence, including the explicitly **unmet x64-crt 2× gate**, is in `docs/handoff/codegen.md` and
`docs/handoff/codegen-before.json` / `docs/handoff/codegen-after.json`.
