# Lifted-code benchmark

```sh
BGT_CODEGEN_REPORT=/absolute/path/codegen.json \
  npx vitest run --config tools/bench/codegen.config.ts
```

Runs the explicitly listed x64 console/GUI/memory fixtures, `win32-hello`, and a generated original CC0 integer CPU fixture (not every current x64 example).
The fixture lives in `node_modules/.cache/bgt/codegen-cpu`, never in a game input directory. It executes 512
noinline arithmetic functions 32 times by default, then prints the checked checksum `00000009 a47a8001` and sleeps.
`BGT_CODEGEN_ROUNDS=1024` extends this to a 36,709,146-dispatch workload. An independent u32-pair reference computes
the expected u64 checksum for every requested round count; no lifted guest result supplies its own expected value.
It is engine-independent and uses the ordinary PE analysis/lift/build path.

Per program, the JSON records specialized/generic static counts, whole wasm bytes and bytes/instruction,
build time, compiler object/cache counts, Asyncify cache state, five run-time samples and their median,
console output, runtime metrics (including generic executions, interpreted instructions and yields), CPU/memory/load
resource snapshots, ALU materialization fractions and individual trial timings. Each program also builds its unchanged
interpret-only reference and runs an identical 300-frame differential oracle. Reference guest-dispatch counts supply
throughput (not static memberships or REP micro-iterations). Every run must execute zero interpreted instructions and
print no FAIL result. The CPU checksum is asserted.

Execution timing includes 300 fixed update/render/consume frames after loading/initialization; the first update
contains guest startup and the benchmark work. It excludes wasm compilation/instantiation and loader initialization.
One batch of fresh-instance warmups is discarded before five measured batches. Each batch defaults to eight fresh
instances (`BGT_CODEGEN_TRIALS`); the report retains every trial and reports the median batch mean. K11's short-program
comparison used 24 trials/batch; its long CPU comparison used three. Small console programs spend much of
this interval in host/frame overhead: these numbers are not pure guest-CPU timings. No device/vsync/GPU timing claim.

Build time includes fixture preparation, analysis/lifting, compilation/linking/postprocessing and assets. Always
inspect cache counters: a cached build and an uncached build cannot establish a compiler speedup. Bytes/instruction
uses the entire module, including fixed runtime/profile and Asyncify costs, not marginal lifted-code size.

`BGT_CODEGEN_IDS=codegen-cpu,x64-crt` selects a subset for iteration. `BGT_CODEGEN_PRESET=size|fast` explicitly selects
K11's default/all-on policy. Non-CPU input configurations are copied into ignored benchmark input directories, never
modified in examples/. The policy oracle matrix is `npx vitest run --config tools/bench/lift-policy.config.ts` and
compares both presets for six fixtures, including the full 1.6M-instruction scale example, at 300 frames each. The default report is private
`reports/codegen.json`; `BGT_CODEGEN_REPORT` selects another destination. The benchmark has a separate Vitest
configuration so it does not add timing-sensitive tests to `npm test`. It deliberately does not assert speed ratios.

## Scalar SSE, import, vtable and interior-boundary cases (K13)

```sh
BGT_CODEGEN_IDS=x64-crt,x64-cpp,x64-scale,codegen-boundary BGT_CODEGEN_PRESET=size \
  BGT_CODEGEN_REPORT=/absolute/cumulative-size.json npx vitest run --config tools/bench/codegen.config.ts
BGT_CODEGEN_IDS=codegen-scalar,codegen-imports,codegen-vtable,codegen-interior BGT_CODEGEN_PRESET=fast \
  BGT_CODEGEN_REPORT=/absolute/isolated-fast.json npx vitest run --config tools/bench/codegen.config.ts
```

Repeat **both** groups with both presets on the baseline and changed source. `boundary.c` and
`boundary-landing.S` are original CC0: the cumulative case runs 100,000 scalar SSE conversion/arithmetical
sequences, calls Windows imports through volatile pointers (checking last error), and calls two vtable targets.
The four isolated cases select just one pattern with independently computed checksums. `codegen-interior` uses
a legal interior code pointer inside a leaf's unwind range, not a fabricated owner or game address. Cases use
ordinary Windows/CRT fixture builds; there are no profile overrides. Reports include `generic_per_lifted_call`.
That denominator counts registry/native-region entries, not guest CALL instructions, and can shrink when generic
boundaries disappear. Inspect **both absolute counters** rather than treating a ratio change as a guest-work change.

The committed K13 before/after and isolated-case JSON and complete size/fast oracle matrix are in
`docs/handoff/K13-measurements.json` and `K13-oracles.json`; see `K13.md` for limits and timing interpretation.

## Comparing against a commit

Use the same benchmark files on a detached worktree of the comparison commit, with the same Node/Zig/Binaryen
and environment. Build/run the two versions sequentially; do not run concurrent benchmark processes. Preserve
JSON from each version and compare matching IDs/instruction counts and checksums. Remove the temporary worktree
and generated scratch outputs afterwards. A performance gate must be evaluated from those reports, not from a
change in static specialized-instruction count alone.

K11's full per-step/policy measurements and explicit no-universal-speedup boundary are in `docs/handoff/K11.md`,
`K11-benchmarks.json` and `K11-measurements.json`. All four policies remain opt-in. Lane F evidence, including the explicitly **unmet x64-crt 2× gate**, is in `docs/handoff/codegen.md` and
`docs/handoff/codegen-before.json` / `docs/handoff/codegen-after.json`.
