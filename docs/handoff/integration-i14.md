# Integration I14 — K28 + K26 + K27 + K29

**Complete: final merged-tree gates green under the coordinator-approved I13 review boundary.**
Branch `integration/p1`, base dev.16 `50960e9`. Kit status: **v0.3.0-dev.17**.
No game inputs, installs, push, production integration repair, weakened assertions/deadlines,
new skip policy or suspension-default change. Asyncify remains the default.

## Ordered no-ff merges and semantic composition

1. `9c665f5` merges `lane/K28` (`28600d2`): browser-local GLSL progress, unchanged assertions/workload,
   60s tile /120s cross deadlines. Full merged-tree cross tests took **17.5s Asyncify /18.5s JSPI**.
2. `549e8fb` merges `lane/K26` (`282987f`): disjoint measured interpreter spans, optional
   `bgt_profile_abort`, generic export/JSPI rejection guards and failed-update wall accounting.
   Its measured size attribution and approved may-suspend-analysis follow-up stay evidence/spec only;
   **no Asyncify may-suspend optimization is implemented**.
3. `db2bb83` merges `lane/K27` (`3062d5b`): native SIMD/atomic forms, legacy shuffle/unpack
   alignment (#237), segmented addr32 width and EIP-relative decode repairs.
4. `59b5375` merges `lane/K29` (`8d1584e`): guarded typed leaf imports / bound outer driver (#240),
   64-bit string-pointer checks (#242), and test-scoped tool discovery for unchanged SSE matrices.

Only `docs/v03-status.md` conflicted; both histories are retained. A separate doc-only `f139274`
removes transient conflict markers accidentally retained in the K26 merge; no markers remain.
Runtime/emitter merges were textual-clean and audited by meaning: K26 pauses physical/sample spans
at the existing native entry before either K29 import path; bound callbacks can reopen only their
own interpreted intervals; pending bound tokens are consumed before suspension; host guards close
abandoned exception/trap stacks without treating normal yield as failure. K27 specialization and
K29 call lowering coexist in the emitter. **K23 supervised build sources and K24/K25 renderers are
byte-unchanged from dev.16**; builds still use their supervised transport and feature contracts.

## Integration regression and sole authoring failure

`ebeb4c7` adds original CC0 regression `tests/unit/interpreter-import-spans.test.ts` and extends
`tests/fixtures/c/interpreter-dispatch-spans.c`. It drives an actual interpreted AMD64 CALL into the
native driver, then K29's typed leaf or bound API, using a hand clock and production runtime:

- Leaf API work excluded: **40ms interpreted /140ms update wall**.
- Bound nested callback excluded from its parent but counted once itself: **60ms /260ms wall**.
- Bound yield parks at exactly **40ms**; +1000ms idle cannot grow interpretation; normal park/resume
  invokes **zero abort hooks** and the bound API executes exactly once.
- API / nested callback / post-rewind exception closes at **20/30/40ms**, respectively; original
  error identity survives, sampled pointers clear, stale idle restoration cannot reopen time, failed
  updates retain wall but not completed frames, and actual direct/leaf counts are asserted.
- All paths run under **actual Asyncify and real Node JSPI**, not a mocked scheduler.

Focused initial timing/exception run **14/14 PASS**. Initial full typecheck failed only because the
new test matrix's spread widened a string type (`types.exit=2`). `4099838` narrows that TypeScript
annotation; auditor proves **identical transpiled JavaScript** before/after. Final Clang/GCC lint and
typecheck all passed after correction. No production code changed or test assertion was weakened.
Initial failure/log/source identity is preserved; this is not an all-green first attempt.

## Final-source gates

Final implementation/test source **4099838** (full identity/tree and all file SHA-256s in
`reports/i14/final/final-source*`). Initial source `ebeb4c7` differs only by the erased type annotation;
doctor/original lint preceded it, units were already running, and the complete remaining sweep plus
final lint/typecheck ran after it. No finished browser/unit/oracle suite was repeated for transient
API errors. Later changes are documentation/evidence only.

Serial runners: `reports/i14/gates.sh`, then `reports/i14/finalize-gates.sh`; auditor
`reports/i14/audit.mjs`. Raw per-step logs/exits/timestamps, browser JSON/PNG, all68 oracle reports,
benchmark samples/resources and source hashes remain in `reports/i14/final/`. Durable compact audit:
[integration-i14-evidence.json](integration-i14-evidence.json).

Node24.19.0; buildJobs2; real JSPI; required desktop WebGPU + forced WebGL2/auto; owned port5274,
never developer5173; no light exclusions; Playwright `--trace off` only. Unchanged machine-wide
harness/shim admission, no foreign/shared tickets/locks/processes touched. First builds were cold.

| Gate | Audited result |
|---|---|
| Doctor | ready, exit0 |
| Full Clang + real GCC14 lint | final exit0 each, **38/38 example checks each** |
| Explicit Clang host compilation | exit0 |
| Typecheck | final exit0 after annotation correction |
| Full npm test, original deadlines | **2,305 passed /129 files /0 skips**, exit0 |
| Full Asyncify browser | **300 passed /51 existing skips /0 failures /0 flaky**, exit0 |
| Full JSPI browser | **300 passed /51 identical existing skips /0 failures /0 flaky**, exit0 |
| Explicit K24/K25 native replay | **11/11**, WebGL2 5 + WebGPU 6, exit0 |
| K26 hand-clock/exception/summary + I14 import spans | **17/17 /5 files**, exit0 |
| K26 clock benchmark | 1/1, exact enabled/disabled import counts, exit0 |
| Every pipeline oracle | **34 fixtures ×2 modes ×300 =20,400 identical frame pairs**, all68 exit0 |
| K27 paired native-form benchmark | both modes/presets, **500,000→0 generic executions**, exits0 |
| K29 paired import benchmark | 9 hot forms, **reason5 exits0 /dynamic thunk dispatches0**, exits0 |
| Leakcheck / diff-check / structured audit | exit0 each; final documentation closeout also checked |

Both full browser modes really ran WebGL2 **135 pass /24 skip**, WebGPU **157/26**, auto **8/1**.
Exact full inventories match; all51 skip identities equal I13. Both full modes are uninterrupted
green: no timeout recovery, retries, unavailable-backend substitution or new skips.
K24 capacity/full-u32 IDs/12,000-pair scale and K25 component-fill/lifetime pass on both backends;
WGSL intentionally WebGPU-only. Actually viewed both extracted scale PNGs: red half, green/blue
quarters and black margins agree, byte-identical across backends. Desktop only, not device certification.

Every oracle requests/compares exactly300, zero lifted interpretation/stubs, null errors/stage/divergence,
and equal state + semantic trace hashes within/across modes. The exact #204 **scale-only** recording
contract remains: deliberate BUFFER_CREATE E_LIMIT, one counted buffer OOM and recovery, ten named
recording-only GPU-dependent failures; every other fixture zero command errors. Scale peaks remain
buffer12002/VAO12000, buffer failures1/VAO0, no unimplemented GL; recording evidence is not raster evidence.
All68 interpreted raw measured totals equal summary milliseconds and fit actual host update wall;
shares **7.68–99.84% Asyncify /7.56–99.79% JSPI**. Maximum x64-memory: **4530.090/4537.563ms**
Asyncify and **2631.242/2636.814ms** JSPI. Lifted physical interpretation is0 in every fixture.

## Benchmarks (CC0 synthetic only; not game performance)

Both benchmarks use real detached **dev.16 50960e9** as the incoming integration baseline, identical
new textual fixtures/toolchain/dependencies, serial before/after builds and300-update oracles with
matching semantic hashes. Original raw samples/resources are retained, including contention/outliers.

K27: one discarded warmup +seven fresh instances, five opcode sites each100000 before, empty reason1
census after, interp0/stubs0/drops0. Median ms per300 updates (startup included):

| Mode/preset | Before | After |
|---|---:|---:|
| Asyncify size |21.557|4.000|
| Asyncify fast |21.917|3.468|
| JSPI size |19.684|4.515|
| JSPI fast |31.657|4.136|

K29: actual **Asyncify** measurements;100000 calls/case, one discarded warmup +five fresh instances,
host begin/end markers delimit assembly loops only. Exact API counts, success/LastError, exited1,
interp0/stubs0/drops0; every after instance reason5 census empty and thunk_dispatches0. Missing baseline
boundary counters remain **null**, never invented0. Median ns/call and shared-machine ratio:

| Import/form | Before | After | Ratio |
|---|---:|---:|---:|
| strcmp tail |294.35|102.82|2.86×|
| strcmp IAT |300.33|82.81|3.63×|
| strcmp register |315.72|83.27|3.79×|
| GetLastError |363.47|85.22|4.27×|
| SetLastError |358.41|87.33|4.10×|
| TlsGetValue |392.67|92.21|4.26×|
| GetCurrentThreadId |247.21|98.40|2.51×|
| malloc |404.27|223.94|1.81×|
| free |406.01|217.84|1.86×|

Clock benchmark9×1M samples: enabled monotonic import median **27.23ns**, physical enter/exit pair
**55.11ns** (two clocks), constant pair7.34ns. Disabled transitions have **zero imports**, optimized
away; sub-resolution elapsed times are not latency claims. No normalized engine-overhead inference.

Reproduce via the existing configs: `tests/native-forms-bench.config.ts` with BGT_FORMS_BASELINE and
BGT_FORMS_REPORT, BGT_ORACLE_SUSPENSION=asyncify|jspi; `tools/bench/imports.config.ts` copied unchanged
with its fixture generator into dev.16, BGT_IMPORT_REPORT per revision. See both benchmark READMEs.
No extra Asyncify analysis/optimization or broad Win64/game performance acceptance is implied.

## Review, cleanup and boundaries

Coordinator bridge **2026-11-05** explicitly accepted **inherited vK28/vK26b/vK27b/vK29 PASS +
coordinator read of test-only ebeb4c7 + final-tree author gates**, matching I13. **No separate
independent merged-tree PASS or CI is claimed.** No game inputs/replay/playability, mobile/physical
hardware, Safari/Firefox or new parallel-worker atomicity certification.

All owned runner roots (29963 serial,95939 correction,27344 focused) are absent after completed
exit files. Detached baseline removed normally after measurements. Removed **74 owned temporary
fixture/slice/benchmark output directories (533,245,533 file bytes)**; retained content-addressed
compiler/Asyncify/dependency caches and permanent lock inodes, all raw evidence/PNG/hashes. Bulky
browser HTML/artifact copies were discarded after retaining JSON attachment bytes. Cleanup ledger:
`reports/i14/final/cleanup.json`. No shared cache was cleared during builds; no suite remains active.
Final documentation leakcheck and diff-check are retained under `reports/i14/final/closeout-*`.
