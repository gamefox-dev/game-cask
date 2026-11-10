# Independent K40 kit review

## Verdict

**Bounded independent validation PASS; final integration acceptance remains conditional.** No production correctness blocker was found in the final coverage-only diff against `bd43888`. This is not unconditional acceptance, a Tier1 pass, or a claim of general game speedup. Unchanged full-suite/browser/oracle gates remain required and were not independently run here. An across-the-board no-regression performance claim is **not supported**: the Asyncify VM paired median regresses.

Fresh session; did not author the changes. Read AGENTS.md, CLAUDE.md, the independent-validator brief, and docs/trials.md; adapted review to kit work, not ports. Used codemode only, existing sandbox, no network/install/push. No production/test/bench edits or independent semantic mutations. Before validator-ready I performed only read-only inspection and analysis. After that marker I ran the two requested bounded commands serially. Only this report and the requested validator-done marker are deliberate output writes.

## Independent commands

1. BGT_TRIAL_SCRATCH=/Users/dev/projects/pi-work/scratch-K40 BGT_BUILD_JOBS=2 BGT_E2E_PORT=5292 npm test -- --maxWorkers=1 tests/unit/coverage-buffer.test.ts tests/unit/coverage-transport-exact.test.ts tests/unit/lift-dispatch.test.ts
   - **PASS: 3 files, 15 tests**, 8.12 s; no skips reported.
2. Same environment, node --test tools/bench/k40-count-unit.test.mjs
   - **PASS: 5 tests**, 2.70 s; zero failed/skipped/cancelled.
3. Read-only git diff/status/diff --check, Python recomputation of saved evidence, SHA256/byte comparisons, and stdout-only disassembly of the six original baseline wasm variants. Final diff --check clean; x86_rt.c has **no diff** against bd43888.

The full perf/preparation/recording runs and author mutation runs were **inspected**, not independently rerun. No overlap with the author suite runner was introduced.

## Production semantics and guards

Final production change is confined to platforms/x86/x86_coverage.h: outline miss/flush/enqueue into a mode-1-only noinline helper. Registry shared-row lookup and two-way experiments are absent from the final runtime. Although git status shows x86_rt.c changed relative to the WIP HEAD, its contents match bd43888, which is the relevant baseline.

- Mode 1 rejects every kind except 1 and 2 before events increment. Under that restriction, the new (old & kind) == kind condition is equivalent to the former !add. Each accepted call still increments events once, including hits; only hits increment cache_hits.
- Hash, slot count, queue capacity and slot replacement are unchanged. Address zero works with initially zero keys because its initial kind is zero. A hash collision still starts with old=0 and may re-report; it does not suppress evidence from the new address.
- old is captured before a pressure flush and passed by value. add is computed from that old value before the flush. Flush-before-write, old|kind, pending append order and newly added kind bits match the former code exactly.
- Flush still increments crossings before each host hook and clears pending_n only after the loop completes. Existing host-exception behavior is preserved, **not improved**: a throwing hook leaves the queue uncleared, and a retry can repeat the already-delivered prefix. No transactional/exactly-once exception guarantee is established.
- The independent host 1,048,576-entry/drop policy in bgt/runtime/host.ts is untouched. The same ordered transport implies the same host drop decisions for the same host state. Local deduplication and collisions are not a new host overflow policy. These benchmark recordings have zero drops, so positive overflow is supported by source equivalence/existing tests, not by these recordings.
- Mode 0 direct accounting/import behavior and mode 2 strict membership/first-entry behavior are textually unchanged. The new helper is compiled only in mode 1. The independent bounded run exercises buffered and strict coverage; it does not add a fresh mode-0 execution proof.
- Runtime native permission-before-force ordering, registration cache clearing/generation, expected-symbol and null rejection, indirect-site invalidation, strict checks, depth cap, pending-import/quantum/transfer/stop boundaries, continuation PC/stack-floor checks, and native depth unwind remain baseline code. No new admission or guest-pointer cache exists.

## Tests and sensitivity

| Evidence | Assessment |
|---|---|
| tests/unit/coverage-transport-exact.test.ts | Stronger than final-union checking: compares the complete ordered address/kind sequence and events/hits/crossings to an old-policy JS model. Exercises kind additions, repeated hits, invalid kinds, zero/high-bit addresses, deterministic random collisions and queue pressure. Independent run passed. |
| native_registry_growth.c / lift-dispatch.test.ts | Warms exact-PC and indirect-site caches; growth replaces a formerly native row, adds another target, then a mid-frame caller override rejects resume and checks depth. Force-interpreter on an interior PC and warm NX resume are real runtime assertions, not no-error checks. Independent run passed. |
| Author sensitivity logs | mutant-coverage.exit, mutant-invalidation.exit, mutant-permission.exit are all 1. Logs show exact-transport failure, growth returning 3 rather than 0, and NX resume failing to throw, respectively. The marker identifies old-kind, registration-clear and live-NX mutants. I inspected these logs, did not execute those mutations. Final source restoration was verified against baseline/diff and audited source hashes. |
| Dynamic counter tests | Four copied K39 analytic cases plus one K40 case passed independently. Cover known loop/call/local counts, explicit/fallthrough exits, memory offsets/classification, once-only side-effecting address evaluation, conversions/comparisons, select/if/br_table/br/call_indirect/imports. K40 checks consecutive-PC count=2 across five lookups and a registration reset, without charging injected diagnostics as original operators. |

**Weaknesses, not hidden:** the transport test asserts after the final flush, not at each pressure boundary; a changed batching capacity with an otherwise identical eventual sequence/counters can pass. It does not simulate a throwing/reentrant host hook or a saturated real host map. Registry growth's override is simulated by replacing a registry table, not by building a whole override pipeline. The reuse test does not measure real cache collisions, permissions, mid-window registration generation turnover, or first-PC-zero behavior. The analytic instrumentation tests are finite examples, not a general Wasm-transform proof; traps/nonlocal control inside operand evaluation, exception handling, SIMD/multivalue and arbitrary WAT syntax are outside their demonstrated scope. Counter wrappers often charge before evaluating operands, so exceptional paths can charge a parent operator/exit that never completes.

## Benchmark and artifact audit

Reviewed tools/bench/k40.test.ts, k40-fixture.mjs, k40-count.mjs, k40-wasm-count.mjs, k40-report.mjs, k40-evidence.mjs and docs/handoff/K40-measurements.json, with raw scratch evidence.

- Recomputed all **30 saved wasm size/SHA256 pairs** across 15 artifact families; all match the final audit. All seven listed source hashes match current files. Audited fixed-record module identities/assets separately from timing artifacts.
- Independently checked **60 saved lifted/interpreter rows**: 330 API hashes equal per oracle pair; retired total equals component sum and thread-total sum; oracle thread IDs/totals agree; accounting is enabled. Base/final API hash sequences, coverage unions/drop state and full accounting objects also agree in both modes for all three fixtures. These are single-thread fixtures: they do not prove scheduling or full CPU/RAM equality.
- The initial record-calls failure was real: independently rebuilt manifests differed in PE identity and build timing. It is superseded by NEW fixed-PE recording builds, not erased by deleting snapshot fields. The replacement six base/final recording pairs are byte-identical, with byte lengths/SHA256 matching the audit.
- The replacement proof calls the actual BGTRuntime.prototype.coverageSnapshot serializer, freezes performance.now, compares all emitted fields and per-update accounting, and uses a common module manifest after separately checking matching module identities/assets. Its inputs come from copied compact loader PEs; tools/build/files.mjs explains why loader-asset hashes differ from the original streamed source-module identities in timing builds. These are separate controlled recording artifacts, **not byte equality of the original timing-build manifests**.
- This is a headless runtime-shaped receiver, not an initialized browser BGTRuntime: diagnostics/timing and GPU/frame/error bookkeeping are fixed, rangeFiles is null, and build metadata is held common. There is no projected deletion from the serialized output. Equality proves controlled serializer/host evidence compatibility, not equal real browser wall times, streaming diagnostics, UI error collection, or publication behavior.
- Arithmetic sentinel recomputes to **0**. All 32 leaves perform identical operations, and the recurrence has a short cycle. A no-op kernel returning zero, some skipped even call counts, or wrong target selection among identical leaves can evade the standalone log check. The substantial measured retirement, interpreter comparison and separate distinct-target guard tests are therefore important; do not call the sentinel alone strong arithmetic/target correctness proof.

### Real timing pairs, recomputed

30 warm +300 timed host updates; one discarded pair and nine alternating-order fresh-instance pairs, both actual suspension variants. Timing branch does not mock clocks or time counter-instrumented wasm. Instantiate/init and warmup are excluded. Negative paired delta means faster. Units ms/300 updates.

| Fixture/mode | Base median | Final median | Median paired delta | Paired range |
|---|---:|---:|---:|---:|
| calls Asyncify | 57.283 | 56.629 | -0.281 | -3.406..+0.476 |
| calls JSPI | 51.471 | 49.661 | -1.915 | -4.354..+3.325 |
| VM Asyncify | 14.383 | 14.609 | **+0.601** | -1.013..+1.556 |
| VM JSPI | 12.840 | 12.609 | -0.217 | -0.348..-0.113 |
| memory Asyncify | 86.414 | 81.041 | -5.373 | -10.205..-2.478 |
| memory JSPI | 82.745 | 71.814 | -11.071 | -12.028..-9.085 |

Stored paired deltas match recomputation; no subtraction of unrelated medians was used. Memory improvements are consistent in this sample; calls are noisy, and Asyncify VM is not a no-loss result. No confidence interval, host isolation or independent timing repetition was established. Two-way rejection is justified: its mixed win was accompanied by VM regressions and a large JSPI memory regression (~+9.759 ms paired median versus cover). Shared-lookup results likewise do not justify retention as a broad win.

### Operators and sampled attribution

Both-mode counts use actual baseline wasm, instrument original AST nodes only, and compare API hashes, exact core metrics/accounting and coverage against the original. Injected diagnostic counters are not recursively instrumented. Aggregation excludes helper entry/exit metadata, hot duplicate labels, sites, call targets, address-candidate overlaps and reuse diagnostics from total operator work. Asyncify transformation overhead remains actual work in its variant, not guest retirement.

Inspected original disassembly for all six baseline variants: the sole explicit x86_find_lifted return follows the exact-PC cache-hit checks. Thus using that return count as a baseline cache-hit count is justified **for these artifacts**, not an invariant guaranteed by the analytic test or another optimizer/registry experiment. Observed mixed hit ratio is ~87.509%; VM/memory ~99.9985%/~99.999987%. Consecutive-PC reuse and registration calls in counted windows are zero, not proof that generation-sensitive caching is unnecessary.

Four-helper exclusive operator shares are calls 40.406%/43.312%, VM 11.544%/13.515%, memory 36.118%/39.195% (Asyncify/JSPI). They exclude native_indirect and inlined caller publication. These are **operator counts, not cycles, register spills or additive wall-time attribution**. Separately sampled baseline profiles use matching retired-count denominators for 30+300 windows; 123–617 samples/profile are coarse. Zero samples for a helper do not mean zero cost, and inlining/JIT attribution can obscure self-time. Per-entry sampled estimates are not isolated helper latency or the measured optimization benefit.

## Remaining gates / concrete limits

No must-fix production blocker emerged from this bounded review. Final acceptance is blocked on the author's unchanged full Tier1 gates and final handoff, not waived by these 20 passing tests. I did not run full npm test, browser backends/suspension matrix, all-pipeline 300-update oracles, doctor, compiler/lint/type/leak gates here. Existing full suites were not edited by this validation; the production/test diff adds checks rather than weakening them. If acceptance specifically requires no VM loss, the positive Asyncify VM paired delta also needs resolution or an explicit tradeoff decision. Retain these qualifications in the final handoff; neither sampled timing nor recording-byte equality supports a universal performance/equivalence claim.
