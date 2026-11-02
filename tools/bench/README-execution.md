# K10 execution measurements

Original CC0 fixtures only; no game files, captures or shader sources. Measurements use the installed Node 24.19.0,
Zig 0.13.0, Binaryen and Apple M4 host; each report includes machine start/end snapshots. `ps` is sandbox-denied,
so top processes are **null with EPERM**, not asserted empty. Concurrent machine load and approximately 9 GiB swap
make small timing differences unreliable. This is not a quiescent-machine hardware certification.

## Reproduce

```sh
npm run bench:execution
npm run bench:asyncify -- reports/asyncify.json
# More narrowly:
BGT_EXECUTION_IDS=x64-crt,x64-cpp BGT_EXECUTION_REPORT=/tmp/execution.json npm run bench:execution
```

Do not run another publisher of the same fixture during execution measurement. Build and postprocess timings record
cache state; cached and uncached times are never compared as an optimization speedup. `bench:asyncify` uses precisely
the same named, DWARF-stripped linked input for both uncached invocations. `bench:execution` is headless (no GPU),
300 fixed update/render/consume frames, five fresh instances after one discarded warmup, compile/init excluded.
Every sample checks the API-trace result, no FAIL logs, no stubs and zero lifted interpretation. The generated
`k10-coverage-hot` fixture also checks an independently computed u32 checksum after 4,194,304 indirect guest calls;
its source generation lives in `execution.test.ts`. No per-game addresses or special execution path are used.

## Committed execution report

[`k10-execution.json`](k10-execution.json) records all raw samples, categories, API timing, generic-exit census,
resource snapshots, build/cache facts and execution counters. The final run was measured at **d9b0603** (the report's commit); an earlier short-sample summary is retained
separately to expose the substantial CRT variance rather than cherry-pick its favorable sample.

| Fixture | direct/full ms | buffered/full ms | buffered/restricted ms | interpreter ms | after/reference speedup |
|---|---:|---:|---:|---:|---:|
| x64-crt | 6.238 | 5.160 | 4.333 | 4.183 | 0.97× |
| x64-cpp | 3.687 | 3.670 | 3.571 | 4.985 | 1.40× |
| x64-scale (1,609,529 instructions, chunked) | 35.845 | 31.752 | 30.880 | 86.118 | 2.79× |
| generated dispatch-heavy | 591.461 | 329.841 | 334.138 | 860.491 | 2.58× |

The **coverage-only** change cuts host crossings: CRT **2023→837**, C++ **2796→214**, scale **49672→24202**,
dispatch-heavy **8,389,564→72** (>99.999% reduction). Direct/full versus buffered/full isolates that change.
The coverage-only dispatch-heavy median falls 44.2%; sparse scale entries give a smaller 11.4% median reduction. The exact-count
cache metrics, not a presumed universal speedup, establish that hot repeated Wasm→JS crossings were removed.
The direct-mapped cache can collide/re-report; it never discards entries or bypasses the host overflow policy.

Generic executions per lifted call are unchanged: CRT **1.92285**, C++ **0.08897**, scale **0.49582**, dispatch-heavy
**0.00000536**. The CPU model did not change in this lane. CRT's top exits are **failed guards**, C++'s are shared
opcode forms; those general code-model improvements belong to K11. The coverage → re-lift fixture still converges
from >70k interpreted instructions to zero in two selective builds, followed by an identical strict/reference run.

**F-PERF-CRT remains open:** the final sample is only **0.97×** over the reference. An earlier short sample reached
2.13×, while another was ~0.92×; it would be dishonest to close the historical acceptance using that favorable
4–10 ms observation. The fixture retires only roughly 10k semantic-clock instructions, spends much of 300 frames
idle/host-side, and still has 3888 generic executions/2022 lifted calls, so a robust universal ≥2× claim remains open.
This report does not establish ≥2× wasm-size reduction or game performance. Category estimates with 1–4 samples
must not be summed as exact wall time. See docs/pipeline.md for inclusive/sample/timer semantics.

## Asyncify: small actual exclusion, no fabricated whole-module speedup

[`k10-asyncify.json`](k10-asyncify.json) inspects actual postprocessed bodies using the state global read by the
exported `asyncify_get_state`, not guesses from names. Conservative output has **2 CRT / 15 C++ generated wrappers**
with Asyncify state checks; restricted output has **0 / 0**. Region signatures already exclude native regions from
the suspendable indirect-call set. Exact generated wrapper exclusions remove **326 / 2445 bytes** in these outputs.
Actual uncached times: CRT **9.172→9.126 s**, C++ **22.500→19.421 s**; machine pressure prevents claiming those small
sample changes are a general postprocess acceleration. Scale whole-module postprocess remains **~138–141 s**, and
its before/after wasm size is essentially unchanged. Parsing/optimizing/emitting the whole module remains a build
cost; this lane does not implement lazy wasm or a smaller postprocess graph.

`BGT_ASYNCIFY_FULL=1` restores conservative analysis. Default exclusion uses exact definitions found only in generated
sources, never broad F_/R_ wildcards or `asyncify-ignore-indirect`. Overrides, shared semantics, dispatcher, profile
APIs and native callbacks remain suspendable; the regression's handwritten override really yields twice. Lists above
180k bytes safely fall back to conservative analysis rather than exceeding the platform argv bound. Manifest metrics
record the list count/hash, linked size, postprocess cache state and elapsed time.

## Instrumentation overhead

[`k10-profile-overhead.json`](k10-profile-overhead.json): C timing/census enabled versus disabled on identical short
fixtures, JS timing present in both. Measured median overhead **8.3% CRT / 3.6% C++**, not a total instrumentation
bound and not a target-game measurement. The extra 1ms CDP profiler is opt-in and outside that comparison. The expanded/resettable 262k census landed after the original C-overhead sample; the final execution report uses
that implementation, while the committed overhead report remains explicitly historical. The
`guest_instruction_clock` field remains the raw active-context AMD64 `X.tsc`; exact threaded process-retirement
accounting is owned by K11. No exact instructions/s is fabricated from it.
