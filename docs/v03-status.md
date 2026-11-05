# v0.3 merged implementation status

## K32 lane record — bounded native calls / indirect sites / owner regions

Implementation6297545 over dev.18 211daca; **author implementation Tier1 green, external focused
vK32 PASS at6297545**, not a merged release or independent full-Tier1/CI claim. Direct AMD64 lifted calls
use bounded guarded N calls/resumes; cross-chunk weak targets require nonnull+registry equality; exact-PC
indirect sites and native owner-region entries avoid repeated driver/generic crossings. Self-recursive
owners remain flat after measured regression. Actual Asyncify/JSPI, exact full CPU/RAM, suspension/nonlocal
transfers, strict/permission/registry/table guards, cache freshness and seven behavioural mutations pass.

Shared-machine uninstrumented five-pair A/B: direct36.06→26.52ns Asyncify /33.23→26.81ns JSPI;
tail56.59→44.96 /50.90→38.95ns. Owner regions6452.09→44.68 /5426.03→54.67ns per iteration include
removing generic/interior resumptions. Deep/indirect within paired spread: **no speedup claim**. Separate
both-mode counted driver steps reproduce; stats default-off, no production hot diagnostic increments.
No game speedup or resolution of507 game indirect sites, isolated wasm-call latency or self-modifying
code support claimed. Decoder REX.B opcode90 repair has independent width-correct regressions.

Author gates: doctor, Clang+realGCC lint37 default checks each, explicit Clang host/38th scale check,
types, **2335 units/131files/0skips**, uninterrupted browsers **300pass/51existing skips each mode**,
required WebGL2/WebGPU/auto, all**34×2×300=20400** identical oracle pairs, leak/diff checks. Exact skip
inventory matches I14; measured interpreter spans fit host budgets; no exclusions/deadline weakening.
Reviewer-requested post6297545 **test-only SEH integration delta** is documented separately in the
[handoff](handoff/K32.md); successful AMD64 table unwind is supported, i386 frame-based SEH remains
an explicit kit follow-up (RaiseException fails closed). Final lane evidence: [gates](handoff/K32-final-gates.json),
[compact paired timing/mutations](handoff/K32-measurements.json) (raw archives cited in scratch).
Coordinator accepted test-only54c40eb after review: actual parked/resumed direct-call AMD64 SEH,
300-update/full-CPU identity across engines/modes, missing-unwind-metadata mutant fails/restored2/2 pass;
i386 missing dispatcher fails closed. No production code changed after external review.

## Integration I14 final — v0.3.0-dev.17 (K28 + K26 + K27 + K29)

Ordered no-ff merges over dev.16 retain K23 supervised builds and K24/K25 GPU behavior unchanged.
K28 browser-local GLSL progress; K26 measured interpreter spans/abort boundary/failed-update wall;
K27 native SIMD/atomic forms, alignment and segmented addr32/EIP-relative repairs; K29 guarded
leaf/bound imports, full-width string pointers and per-test SSE tool discovery now coexist.
Only status history conflicted; **no production integration repair**. New hand-clock regression
covers interpreted CALL→native driver→leaf/bound, nested callback, normal park/rewind and import
exceptions in actual Asyncify/JSPI. Final source **4099838** differs from initial ebeb4c7 only by an
erased TypeScript annotation correction (initial typecheck failed; final checks pass).

Final merged-tree doctor, full Clang/GCC lint **38/38 examples each**, explicit Clang host checks,
typecheck and leakcheck pass; **2,305 units /129 files /0 skips**. Full Asyncify **300 pass /51 existing
skips /0 failures /0 flaky**, full JSPI **300/51/0/0**, both uninterrupted green, actual required
WebGL2/WebGPU/auto; exact skip inventory equals I13. GLSL cross cases **17.5/18.5s**, unchanged pixels.
K24/K25 explicit native replay **11/11**, both backends; K26 + I14 span fixtures **17/17**.
**34 pipeline fixtures ×2 modes ×300 =20,400 identical pairs**; all68 exit0, zero lifted interpretation/
stubs, null errors, equal state and semantic traces within/across modes, physical measured interpreter
time inside actual update budgets. Exact #204 scale-only expected-error contract remains intact.

Matched dev.16 synthetic benchmarks: K27 **500,000→0 generic executions**, empty opcode census
(size/fast, both suspension modes); K29 all9 hot import forms **reason5 exits0 /thunk dispatches0**,
**1.81–4.27×** median speedups (actual Asyncify,100000 calls, exact API counts, baseline missing
boundary counters remain null). These shared-machine measurements are not game performance.
K26 size attribution/follow-up is retained; **Asyncify may-suspend analysis is not implemented**.

Coordinator-approved I13 review boundary: inherited **vK28/vK26b/vK27b/vK29 PASS**, narrow test-only
integration-diff read and final-tree author gates; **no independent merged-tree PASS/CI** claimed.
All runners finished, owned baseline/temporary outputs removed, raw evidence retained. No game,
physical-device or mobile certification. [Handoff](handoff/integration-i14.md),
[audited evidence](handoff/integration-i14-evidence.json).

## K29 gate record — guarded direct imports (unit blocker repaired; acceptance external)

K29 adds full-width guarded IAT/provenance lowering and explicit non-suspending CRT/thread leaf
bindings; callback/suspending APIs retain a bound outer-driver path, changed operands dynamic fallback.
Focused profile/snapshot/string/context tests pass; guard-removal and pointer-truncation mutations
fail their assertions. The serial nine-case100000-call dev.16 A/B has zero final reason5 exits/dynamic
thunk crossings, identical300-update oracle hashes across versions, and synthetic call-loop medians
1.76–4.42× faster. Baseline IAT/register forms already have zero reason5 exits; missing baseline
dynamic counters are not reported as zero. Final gate audit retains doctor, Clang/GCC lint (38 examples),
typecheck, full leakcheck, both suspension browser runs (300 pass/51 intentional skips each, both native
backends), and all34×2×300 pipeline oracles (20,400 identical frame pairs, matching cross-suspension
hashes). K29h actually measures all four SSE-matrix cases on dev.16 and incoming HEAD: both
time out at the unchanged60000ms deadline under the same current conditions; 106 paired emitted
C files are identical. Repeated tool freshness discovery (median1319ms versus2.24ms native lift)
is the dominant avoidable setup cost. Reviewer-authorized per-test lazy discovery reuse keeps the
first lookup inside the deadline and invalidates between tests; real tool-source/SDK-header freshness
regressions pass and fail when reset is removed. All four cases now pass in22.3–30.4s; full units
**2075/2075,119 files,no skips** pass. No production/build-layer/assertion/deadline/skip change.
The prior byte-identity-only inheritance claim was insufficient; the new A/B is actual evidence, not
a claim that the historical I13 green run was false. Independent validation and real-game remeasurement
remain external. Memory faults retain the abort
contract, not new SEH. [Gate evidence](handoff/K29-gates.json); actual failures, repairs, samples and
remaining boundaries: [K29 handoff](handoff/K29.md).

## Integration I13 final — K23 + K25 + K24 (merged-tree gates complete)

Ordered no-ff merges over dev.15 preserve K21/K22 coverage convergence and bounded suspension.
K23 supervised finite-file helpers, K25 typed vertex component fill/failed-pipeline lifetime, and
K24 negotiated full-u32 buffer IDs/dynamic buffer and VAO tables coexist; byte budgets and exact
x64-gl-scale-only expected-error contract remain unchanged. Integration repair `cb82808` keeps nested
Binaryen children in the ancestor supervisor group while independent lock guardians retain writer
draining. Negative controls fail before; final focused18/18 pass. Final merged-tree gates:
doctor, Clang/GCC lint37/37 examples each, explicit Clang host checks, types, **2,065 units /114 files /0 skips**,
leakcheck, four-mode convergence16/16 (**70,003→0** interpreted instructions, equal traces, zero drops)
and short concurrent stress128/128 (64 cold/64 warm, equal digests). **33 pipeline fixtures ×2 modes
×300 =19,800 identical frame pairs**; all66 exit0, equal state/semantic traces within/across modes,
null errors/stages/divergence, lifted interp0/stubs0; exact #204 scale-only contract retained.
Explicit native K24 capacity/full-u32 IDs and K25 component-fill/lifetime replay **11/11**, both backends.

Full JSPI browser: **300 passed /51 existing skips /0 unexpected /0 flaky**, exit0. Asyncify:
**combined300 passed /51 same skips**, not an uninterrupted green full run: original **299 pass /1
unchanged360000ms GLSL cross-backend timeout**, exit1 retained; ONLY that test reran unchanged after
the sweep and **1/1 passed**, exit0 (5.8min test,6.2min with setup). No other completed gate repeated.
Exact full/skip inventories and all66 reports audited; all implementation hashes unchanged. Both
background roots exited;27 owned temporary directories removed only afterward. Finalization is docs-only.

Inherited external vK23b/vK25/vK24 PASS plus reviewer **#228** repair-diff read is the accepted review boundary;
no separate independent merged-tree PASS/CI, game or physical-device claim.
[I13 handoff](handoff/integration-i13.md), [audited evidence](handoff/integration-i13-evidence.json).
## K26g exception-boundary repair — author Tier 1 green; delta review pending

External vK26 FAIL on cd28ca8 found host exceptions bypassing C span cleanup (P2).
Decision #251 repair **f1a7621** adds optional `bgt_profile_abort(now_us)`, host export/rejection
guards and failed-update wall accounting; closes/discards spans and clears abandoned sampled/idle
state without masking original errors. All four width/suspension reviewer regressions fail before
and pass after; absent-export compatibility and normal-yield zero-cleanup/exact80/90ms tests pass.
Private stack/idle cleanup mutants fail both widths. Focused **24/24**, full units **2,027 /109 files**.

Clean repair source full author Tier 1: doctor, ESLint + real GCC **36/36 example checks**, explicit
clang, types, leakcheck; full browsers **291 pass /51 unchanged skips /0 failures /0 flaky per
suspension mode**, required WebGL2/WebGPU; **32 fixtures ×2 modes ×300 =19,200 identical oracle
frame pairs**, lifted interp0/stubs[], null errors, equal cross-mode hashes. All64 interpreted
physical totals fit actual host update budgets (maximum99.78%). Refreshed clock median27.49ns/import,
55.30ns/transition pair; disabled transitions0 clocks; shared-machine samples, not game overhead.
Finalization is documentation/evidence only. **External delta re-review pending**, not an independent
PASS or CI claim. Review cd28ca8..f1a7621; no production build/emitter changes.
[Repair handoff](handoff/K26.md), [repair gates](handoff/K26-repair-gate-evidence.json),
[repair timing/sensitivity](handoff/K26-repair-timing-evidence.json). Historical source gates below
remain correctly scoped to d454da7.

## K26 historical normal-path gates — physical interpreter timing / measured size attribution

Q73 no longer extrapolates timer overhead into a physical exclusive budget. Disjoint measured
interpreter spans use the host monotonic clock, exclude native/API/scheduler/parked work, survive
census reset, and close on return/fault. Raw sampled diagnostics remain labelled; unavailable or
invalid update budgets give explicit null/status, not clamped shares. Exact hand-clock CC0 tests
cover real i386/AMD64 dispatch, nesting, 300 GameHost updates, Asyncify/real JSPI and profiling0/1;
three private-archive negative controls fail as intended. Clock median27.8ns/import,55.6ns per
enter/exit pair; disabled transitions0 clocks (shared-machine observations, not game overhead).

Clean source **d454da7**: doctor; full lint **36/36 examples**, real GCC + explicit clang; types;
**2,019 units /108 files /0 skips**; full browser **291 pass /51 unchanged skips /0 failures /0 flaky
per suspension mode**, both backends required; leakcheck; **32 pipeline fixtures ×2 modes ×300
=19,200 identical oracle frame pairs**, lifted interp0/stubs[], equal cross-variant hashes.
All64 real interpreted oracle summaries fit wall time; maximum share99.71%. Finalization docs only.

Matched CC0 attribution separates **528,241B lost whole-module optimization** from **646,375B
conservative shard-summary expansion**; wholeO2→partition **+13.46%**. Supplied read-only porter
manifests place99.74% of final growth at postprocessing, not new per-lifted-function hooks.
Shared-machine runtime samples are retained without claiming isolated causal overhead. Reviewer
**#232 approved a separate conservative may-suspend analysis follow-up**; no production build/emitter
changes here. **No independent K26 review or CI claimed**; external reviewer coordination remains.
[Handoff and approved spec](handoff/K26.md), [gates](handoff/K26-gate-evidence.json),
[timing](handoff/K26-timing-evidence.json), [size](handoff/K26-size-evidence.json).

## Integration I12 final — K21 + K22 (merged-tree gates complete)

Merged with `--no-ff`, K21 then K22, over dev.14 `4bcc068`. Default coverage convergence and exact
identity/adoption/strict-slice policy coexist with bounded Asyncify, JSPI-only and JSPI-preferred packages.
Asyncify remains default. Integration repairs identify the active variant on execution summaries/probe output
and coverage snapshot metrics, and include the partition name parser in post-link cache identity.
Binaryen partition children preserve type order so shard-local usage cannot change shared section indices;
all strict assembly checks remain. Regressions cover all four convergence variants, snapshot serialization
and every postprocess implementation input. Asyncify remains the global default.

Final source gates: doctor; full lint **36/36 examples**, real GCC + explicit clang; types;
**2,015 units /106 files /0 skips**; leakcheck; **32 pipeline oracles ×2 modes ×300 =19,200 identical
frame pairs**, lifted interp0/stubs0/errors0 and equal cross-variant trace hashes. Asyncify full browser:
**291 passed /51 existing skips /0 failures /0 flaky**. JSPI browser: **reviewer-approved combined291
passed /51 existing skips /0 unresolved failures**, not an uninterrupted green full run: first full attempt
had one teardown ENOSPC, second had one different360000ms timeout under ~40 load on10 cores; the latter
passes unchanged in focused recovery. Both full attempts and recovery are explicitly retained.
Four-mode convergence (default, forced-partition Asyncify, JSPI-only/preferred) **70,003→0** interpreted
instructions, identical traces, zero drops. Reduced scale **1,044 owners /five partitions**, all300
reference/raw/Asyncify/real-JSPI checksums equal and10,500 yields per variant; temporary wasm removed.

Inherited external lane reviews: **vK21b PASS /vK22b PASS**. Reviewer accepted the narrow repair diff and
the type-order flag/regression; this is not a separate independent merged-tree validation or CI run.
No game/playability or physical-device certification. [I12 handoff](handoff/integration-i12.md),
[compact evidence](handoff/integration-i12-evidence.json).

## K21 final — coverage convergence and guest presentations (lane Tier 1 green)

Default coverage selection automatically merges successful probe/passing-port-test evidence with exact per-input
module/game identity, deterministic owner/interior/static-closure provenance and explicit all-analysis selection.
Strict slices remain supplied-evidence-only and reject all. Adopt/re-stamp migration requires unchanged modules,
preserves executed evidence and records source/manifest hashes. Rejected evidence preserves the previous manifest.
Persistent interpreter entries/counts survive census reset/profiling-off; exclusive sampled fallback timing and
real guest presentation count/rate/avg/p95 accompany updates/s. **Updates are not guest frames.**

Final lane evidence: **2,000 units /102 files**, browser **287 passed /51 existing skips**, doctor/lint/clang/GCC/
types/leakcheck pass, **32 pipeline oracles ×300 updates** identical with zero lifted interpretation/stubs.
External **vK21 FAIL →vK21b PASS** repairs fixture initialization, final-outcome-only evidence publication and
preserved adoption manifests, with sensitive regressions. Original CC0 loop converges **70,003→0 interpreted
instructions** with identical traces. Selection scale measurements are build/size costs, not game-speed claims.
Contracts: [coverage convergence](coverage-convergence.md); evidence/limits: [K21 handoff](handoff/K21.md).

## K22 final — bounded game-scale suspension (lane Tier 1 green)

Implementation **41a3a53** resolves the pinned wasm32 Binaryen CLI's **4 GiB parse-heap limit** with bounded
post-link Asyncify body partitions, conservative cross-partition suspension summaries and checked assembly.
A CC0 **417,126,367-byte /10,438-owner** module that fails whole-module parsing/O2/Asyncify builds in
**50 partitions /1445.22 s** (max RSS1.50 GB, peak physical footprint1.87 GB); mathematical/raw/Asyncify/real-JSPI
checksums match all300 frames and10,500 deep parked yields per variant. Failures have actionable diagnostics.
JSPI-only builds bypass wasm-opt; dual packages retain Asyncify fallback. Reviewer #180 keeps **Asyncify default**,
with persistent per-game **game.json suspension: "jspi-preferred"** opt-in and active-variant metrics.

Final lane gates on unchanged implementation: doctor; full lint including **36 example checks**, clang and real
GCC; typecheck; **2,004 units /102 files /no skips**; full required-WebGPU browser **291 passed /51 unchanged
skips /0 failures /0 flaky per variant**; leakcheck; **32 pipeline fixtures ×2 variants ×300 =19,200 identical
oracle frame pairs**, no lifted interpretation/stubs/errors, equal cross-variant hashes. One compile.py stdin-hang
failure is preserved; unchanged complete x64-scale JSPI oracle retry passes. Transport repair belongs to K23.

External **vK22 verification-incomplete FAIL →vK22b PASS/PASS** closes mutation-control and actual both-backend
selection/fallback/metrics/cache/integrity gates, with no confirmed production defect. No later production/test
source edits. Mixed fixture load/speed evidence does not justify a universal JSPI switch; bounded x64-scale
Asyncify/JSPI is68.8/53.5 MB and43.91/30.29 ms per300-frame batch, shared-machine/no-rasterization observations.
Finalization is documentation/evidence only; no CI, integration, game/playability or physical-device certification.
Exact commands, evidence and retained limitations: [K22 handoff](handoff/K22.md).

## K24 — Q67 buffer/VAO scale and hot-path repair (author Tier 1 green)

Final implementation **8a132ce**, documentation-only finalization. Reviewer #200 approves additive
v0.3 **CAP_GPU_BUFFER_HANDLES (bit14)** with explicit per-host opt-in, unchanged byte budgets,
frozen v0.2/unnegotiated behavior and unchanged other namespaces. ABI §13.14 documents full nonzero-u32
buffer IDs and negotiation/reset semantics. Dynamic profile buffer/VAO tables and wire ownership are
bounded by host bytes, not a replacement object-count ceiling; VAOs have no BGT handle. Ordinary
uniforms use the extended pool without a fixed shared count ceiling; real exhaustion remains counted
GL_OUT_OF_MEMORY plus gl_objects live/peak/failure metrics.

CC0 proof: **24,000** live buffers/stores and VAOs; **12,000** real buffer/VAO pairs drawing, churning,
mapping, retaining deleted generations, feedback/UBO ranges and byte-OOM recovery on **both** WebGL2
and WebGPU; all36,000 native per-buffer words across three generations verified. The identical fixture
fails on dev.14 with black panels on both backends. Ten historical workloads×300frames preserve all
**262,596 semantic wire commands** exactly, ignoring only transport addresses. Above-pressure capacity
changes are deliberate. The #204 scale-only oracle contract requires exactly one deliberate BUFFER_CREATE
E_LIMIT and exact counted OOM/recovery; missing/duplicate/unrelated errors fail. Other fixtures retain
zero command errors; native recovery pixels are mandatory.

K24d removes per-call namespace/initial-name scans, dormant cleanup and retained-buffer capacity sweeps.
Cached namespaces, direct small-name lookup, bounded-load hashes with backward-shift deletion, cold
retirement queues and lowest-free handle cursor avoid hot-path allocation/scanning and quadratic churn,
preserving handle choices and destroy order. Native1M-call medians improve from incoming625/611/640ms
to10/12/11ms (IsEnabled/GetShaderiv/BindBuffer). Deterministic200,000-call work tests and actual scan/
tombstone mutations discriminate the repair. Identical lifted Node traces, including metrics+JSON per
frame, show no consistent slowdown versus dev.14. Interleaved unchanged WebGPU browser A/B/A/B passes:
base156.236/118.559s vs incoming122.542/125.047s. **The reported1.3–1.8× browser slowdown was not
reproduced or causally diagnosed.** No additional renderer/runtime/ABI or test-budget change was made
for performance.

**Final author Tier1:** doctor; Clang/real GCC14 lint (36 example check-builds each); explicit Clang host
checks; typecheck; **2,010 units /103 files /0 skips**; full required-WebGPU browser **291 passed /51
unchanged existing skips /0 failures /0 flakes** (WebGL2 131/24, WebGPU152/26, auto8/1); leakcheck739 files;
**33 pipeline oracles×300 =9,900 identical pairs**, null errors/divergence/stage, no stubs, lifted
interp_insns0 and equal trace hashes. All50 serial gate steps and the final structured audit exit0;
618 tracked input hashes remain unchanged. Focused41 native /20 lifted /7 browser and26 parity/contract
tests pass. Full-suite GLSL passes the unchanged360s limit: WebGL2 **128.260s**, WebGPU **138.656s**,
cross-backend **276.150s** (focused107.056/105.086/253.561s). Earlier interrupted-build and historical
browser-timeout evidence is retained, not waived or relabelled. No jobs remain; own caches cleaned.

Game demand remains unknown; porter measures/replays after merge. Reviewer-owned independent review
remains external; no in-lane independent review, game/physical-device or general performance certification.
Details, commands, before/after measurements and retained failures: [K24 handoff](handoff/K24.md).

## Integration I11 final — K18 over K17a/K17b/K16a + K19 (Tier 1 green)

**c59d4ab** merges **f1c36f3** (lane/K18) over **ef8ab6b** with `--no-ff`. Only this ledger
conflicted; all implementation files auto-merged and needed **no integration production repair**.
Final tested tree **8fa70b9** adds original CC0 startup-recording coverage across both actual suspension
artifacts/native backends. K19's opaque-screen/recorder/replay, K17a's builtin/offset/overload/const repairs,
K17b's mapped/default element storage, and K16a's shared bounded host memory remain intact.

**46/46 final-source background steps PASS:** doctor; ESLint + real GCC + explicit clang host checks;
**34 example check-builds**; typecheck; **1,976 units /98 files /no skips**; full required-WebGPU browser
**285 passed /51 existing skips /0 failed /0 flaky in each of Asyncify and JSPI modes** (per mode:
WebGL2 **128/24**, WebGPU **149/26**, auto **8/1** pass/skip); leakcheck. Skip inventories match exactly.
**31 pipeline examples ×300 =9,300 identical Asyncify oracle pairs**, plus x64-crt/win32-hello JSPI
**600 pairs**; all errors/divergence null, lifted interp_insns0, empty stubs, equal cross-variant trace digests.
Default-only and opt-in builds for both fixtures verify identical Asyncify artifacts and real JSPI selection.
Native private shader audit is **120/120 stages per backend**, zero errors, not captured-program rendering.

Merged **2,011,529-insn /62-chunk /93-object** benchmark: unchanged **6.633s (0 compiled /93 cached)**;
fresh runtime-header edit **14.849s (23/70)**, analysis/all62 lifted chunks cached, zero uncacheable objects,
unchanged hashes for each artifact. New-fixture build **611.116s (64/29)** reused runtime objects;
shared-machine observations, not normalized cold or guest-speed claims. Hermetic volatile builtins remain pinned.

Coordinator-supplied external lane review: **vK18 FAIL → vK18b FAIL → vK18c PASS**; K17a's
**vK17a2 PASS on49dec3b /aaf2473 annotation-only**, K17b's bounded independent PASS and decisions
**#135/#139/#142/#146** retain their scope. No new independent integration review is claimed.
JSPI stays experimental/opt-in with Asyncify fallback. K19's separate legacy2D control difference
(**606 pixels**) remains open; no exact full-replay parity, title/playability or physical-device certification.
Finalization is documentation/evidence only. Commands, exact gate evidence and retained boundaries:
[I11 handoff](handoff/integration-i11.md).

## Integration I10 final — K17a over K16a + K17b (Tier 1 green)

**0c53519** is the `--no-ff` merge of **4dd92aa** (K17a) over **53457a7**
(K16a shared bounded host memory + K17b default element storage/mapped buffers). Only this status document
conflicted; every lane entry is retained. Code auto-merged and needed **no integration repair**.
K17a's external **vK17a FAIL → vK17a2 PASS at 49dec3b**, annotation-only **aaf2473**, and decisions
**#135/#139/#142** retain their original scope; no new independent review is claimed.

**Final merged-source gates on 0c53519:** doctor ready; ESLint + clang/real GCC lint with **34 example
check-builds**; typecheck; **1,931 unit tests /91 files**, no skips/failures; required-WebGPU full browser
**269 passed /51 existing skips /0 failed /0 flaky** (WebGL2 **122/24**, WebGPU **139/26**, auto **8/1**);
leakcheck PASS. **All 31 pipeline examples ×300 =9,300 identical oracle pairs**, requested/compared300,
null errors/divergence/failureStage, exit0, lifted interp_insns0 and empty stubs/gl_stubs throughout.
The serial background sweep completed **38/38 steps exit0**, without exclusions, retries or policy changes.

Native external capture audit: **543 submissions** (mm6 129, mm7 414), exported rejection controls,
and **16 freshly canonicalized raw fragments** (mm7 1, mm8 15) deduplicate to **120 stages**
(**53 vertex /67 fragment**); **120/120 compile on each of WebGL2 and WebGPU**, zero errors.
The actual merged C frontend regenerated raw emissions; all private inputs/emissions/results stayed outside
Git. This is stage compilation, not captured-program linking, pixels, a title replay or playability proof.
Documentation finalization is source-neutral; post-doc leakcheck **672 files PASS** and the explicit clang
host-check companion PASS on unchanged implementation. Commands/evidence/boundaries:
[I10 handoff](handoff/integration-i10.md).

## K17b final — Q57 Windows core default element storage (Tier 1 green)

Implementation **97a07ee** accepts/counters/diagnoses VAO0 element-buffer binding and uploads in core
contexts; bounded real map/range/flush/unmap support preserves native generated bytes and shared-buffer
storage across later named VAOs. Review repair **5a4f6b2** keeps strict VAO0 attribute setup/draw errors
with linked-program positive controls and counts explicit flush state changes. Test-only **abd7aa6**
updates the GL census for implemented MapBuffer; **f6056a3** adds reviewer #145's real compiled Win64
map/unmap behavioural contract. No production code changed after5a4f6b2.

Final source **f6056a3** Tier1 evidence from `scratch-K17b/gates-final4/`: focused **10/10 units /2 files**
and focused **2/2 real WebGL2/WebGPU** exact-pixel tests; doctor ready; lint PASS (ESLint, Clang/real GCC
host checks, **34 example check-builds**); explicit **35/35 example builds**; typecheck PASS; full
**1,197/1,197 units /89 files**, no skips/failures; full required browser **247 passed /51 existing
skips /0 failures /0 flaky** (WebGL2 **111/24**, WebGPU **128/26**, auto **8/1**); leakcheck **661
committable files** before and after final docs; and **31 pipeline examples ×300 =9,300 identical oracle pairs**.
Every oracle has requested/compared300, null errors/divergence/failureStage, exit0, lifted interp_insns0
and empty stubs. No light exclusions or admission changes.

The focused and full suites assert the CC0 Q57 fixture's exact five panel pixels, generated feedback words
and odd flush neighbours, 14 compatibility events across5 kinds with one diagnostic each, strict VAO0
attribute/draw errors, and later named-VAO indexed draws. The full unit suite also asserts actual map/unmap
writes, flush retention, pointer/flags queries and mapped-operation rejection; all five mapping APIs are
implemented while FenceSync remains an explicit stub. This is not merely a removed census expectation.

A fresh independent follow-up is **PASS within bounded F1/F2 repair/native scope**; it ran all9 native modes
and the VAO0-guard mutation as required on clean1fd7205, but did not run Tier1/browser and its npm retry
never got admission. No title, first-frame, playability, Windows-hardware or unchanged-porter replay claim.
Audit recommendations and historical failed attempts remain in [K17b handoff](handoff/K17b.md).

## K18 historical local validation — incremental builds and experimental opt-in JSPI

Historical implementation **b40e5fd** adds exact per-object/transitive dependency caching, atomic payload publication,
phase/resource reporting and stable guest/runtime header boundaries. Parent-relative/computed include shadows
found by the prior fresh review are repaired with native/wasm regressions and conservative compiler rediscovery.
JSPI emits a second verified artifact and requires explicit runtime opt-in; Asyncify remains the default and
unsupported API/artifact selection falls back. No translator semantics, GL implementation or BGT wire ABI change.

**Local gates on b40e5fd:** doctor ready; full lint (clang + real GCC, **33 example checks**); typecheck; full
**1,206 units /90 files /no skips**, with real JSPI enabled; **both complete Chromium browser suites**, each
**249 passes /51 identical existing skips /0 failures /0 flakes** (WebGL2 **112/24**, required WebGPU **129/26**,
auto **8/1** pass/skip); leakcheck; **30 pipeline fixtures ×2 modes ×300 =18,000 identical oracle frame pairs**,
null errors/divergence, zero lifted interpretation and empty stubs, with every cross-mode trace digest equal.
First full units had four 60-second codegen timeouts; unchanged assertions pass in the entire final full rerun
with CLI --testTimeout=600000. No committed timeout, assertion, tolerance or skip weakening.

Matched-size before/after build matrices include phase timings and memory/load/disk snapshots on the same shared
machine. **2.01M-insn final-source** unchanged **6.286 s**, fresh runtime-only rebuild **17.467 s** versus baseline
**321.965 s**; all **62 lifted chunks/analysis remain cached**, only **23 runtime objects** recompile. Historical
cold/new-fixture after was **686.096 s**; cold cache states/load differ, so no normalized cold-speed claim. Chromium
headless JSPI matches all traces but is **larger/slower on scale** (66.6 MB/38.76 ms versus 56.2 MB/33.78 ms median).
**Experimental/opt-in only: no porter/game or physical-device acceptance; external independent final-commit review
is pending with the operator.** No new independent review was launched. Exact caveats, logs, hashes and evidence:
[K18 handoff](handoff/K18.md), [matched measurements](handoff/K18-final-measurements.json),
[oracles](handoff/K18-oracle-evidence.json), [browsers](handoff/K18-browser-evidence.json).

## K16a final — Q50/Q51 shared host memory (kit Tier 1 PASS)

Q51 extension replaces separate GL/CRT pools with one bounded reusable host allocator and accounts
runtime/GL/CRT/FILE use/peak/shared limit/backing. Host libc preserves ENOMEM; FILE buffering preserves
ferror/ENOMEM before VFS read; failures log consumer/size/use/limit without allocation. Build-time
`pipeline.memory.hostArenaMiB` accepts 16..512 (default64 retained from repaired stress evidence).
Implementation **`dd4d101`** over **`0f7d459`** retains the fresh independent bounded PASS, seven native
ASan+UBSan/supplementary-GCC modes, and 15/15 post-stress stages per native backend. Final test repair
**`93ec8fe`** replaces incomplete wasm import adapters with shared production `GameHost` instantiation
and gives the two-build exhaustion tests a 300-second cold-build budget without changing assertions.

**Final Tier 1 on `93ec8fe`:** doctor ready; lint (ESLint + clang + real GCC, **33 example check-builds**);
typecheck; full **1,193 units /88 files, no skips**; full required-WebGPU browser suite **245 passed /51
existing skips /0 failures /0 flakes** (WebGL2 110/24, WebGPU 127/26, auto 8/1 pass/skip); leakcheck
**654 files**; and **30 ×300 =9,000 identical pipeline oracle frame pairs**, null errors/divergence,
zero lifted interpretation and empty stubs throughout. One completed serial sweep, no light exclusions.
All three real mixed GLSL/FILE stress/pixel cases pass, including 2,048 FILE cycles with eight live parents.
Finalization after these gates is documentation-only; post-doc leakcheck is recorded in the handoff.
No title/playability or captured-program rendering claim; no porter rerun. GDI private replay/deleted
CPU-storage findings remain deferred by reviewer #127 to a separate lane. Exact commits, final evidence
and preserved interrupted failures: [K16a handoff](handoff/K16a.md).

### Previous Q50 checkpoint (historical)

Implementation `0f7d459` releases transient GLSL parse tables after compile/link, retains compiled-source snapshots,
reuses bounded host spans across sizes, exposes compile/link failure reasons and host allocator metrics, and adds
CC0 shader-cache stress/lifetime/OOM regressions. Reproduced pre-fix 64 MiB exhaustion at warm-up cycle 113; after
768 cycles all 15 supplied fragment stages pass the profile frontend and both native browser stage compilers.
Six focused native tests and three real-browser stress/pixel tests pass; fresh independent bounded source/failure
review is **PASS**. The Q50-only checkpoint did not finish Tier 1; the combined Q50/Q51 final sweep above
supersedes that pending state. No title/playability claim. See [K16a handoff](handoff/K16a.md).

## K17a final — Q54 GLSL builtins (lane evidence; combined gates follow)

Merged lane `lane/K17a` at **4dd92aa** retains inverse and the full GLSL330/ES300 builtin audit,
legal constant offsets, user builtin-name overload resolution and WGSL local-const repairs.
External **vK17a FAIL → vK17a2 PASS on 49dec3b**; **aaf2473** is reviewer-verified annotation-only.
Lane gates: **1,917 units /88 files**, **267 browser passes /51 existing skips**, **30×300 oracle pairs**,
**120 native captured stages per backend**, doctor/lint/typecheck/leakcheck PASS. Decisions **#135/#139/#142**
and finite inverse/depth-filter approximation boundaries remain in [K17a handoff](handoff/K17a.md).
These are lane-only counts, not combined K16a/K17b acceptance. The earlier checkpoint below is historical.

## K17a checkpoint — Q54 GLSL matrix/builtin coverage (not merged/final Tier1)

Lane `lane/K17a` delivers generated `inverse(mat2/3/4)` at **b3d05bd** and the builtin-audit
implementation at **1cb3d8f**: typed matrix/packing/bitcasts/out-parameter/scalar geometric lowering and
applicable projection/offset/gradient texture variants for existing storage, with no ABI expansion.
**244 original CC0 fixtures / 976 cross-backend GLSL330/ES300 pixel results** pass in the scratch renderer
run; **120 unique private captured/canonicalized stages compile natively per backend**. ESLint, typecheck
and leakcheck pass. Full Tier1/oracle jobs and fresh independent review remain **pending**, not certified.
Reviewer requested a stable handoff/fresh-session continuation. Complete builtin-name outcome table,
storage/noise decisions #135/#139, evidence and exact next steps: [K17a handoff](handoff/K17a.md).

## Integration I9 final — K14b + K14a + K15h

Ordered `--no-ff` merges **`db5dc46`** (K14b / `c09faa7`), **`5bbe48a`** (K14a / `fe3b72e`), then
**`f6f8028`** (K15h / `12efec7`) retain K10/K11/K13 and K12 behavior. Repairs **`9b86642`**, **`323f07f`**,
**`730c09c`**, **`3f42927`** fix anonymous struct-field hygiene, C local-struct shadowing, TS inline instance
bindings and sampler-compatible overload reflection, each with failing-before regressions.

**Tier 1 gates completed on final source `3f42927`** (`ada103d` and finalization are docs-only):
**1,183 unit tests / 86 files**, **245 browser passes / 51 unchanged intentional skips**
(WebGL2 **110/24**, WebGPU **127/26**, auto **8/1**), doctor, lint (clang + real GCC; **33 example checks**),
typecheck and leakcheck (**646 committable files**) pass. Full leakcheck also rerun after final docs edits.
**30 default ×300 = 9,000 identical oracle frame pairs**, plus CRT/C++/scale fast **900 pairs**:
**9,900 total**. The 32 successful runner oracle reports have null errors/divergence, zero lifted interpretation
and empty stubs. Runner results: **39 steps, 38 exit 0**; fast-scale alone hit Vitest’s **600 s timeout** during
the cold build of the **1,609,529-instruction** fixture. Reviewer’s same-tree rerun with
**`--testTimeout 3600000`** passed **300/300 identical frames, errors null**; the original failure is retained.
**Backlog:** oracle test timeout must allow cold builds of large fixtures (or separate build/comparison budgets),
without weakening frame/error assertions. No code or timeout changes in this documentation finalization.

Additional focused evidence: **120 units**, **4 browser tests**, scratch-only **543 captured submissions /
104 unique stages + one reprocessed fragment: 105/105 native stage compiles per backend**, zero errors.
Independent reviews: **vK14b PASS** (`c09faa7`); **vK14a FAIL → fixes → vK14a2 PASS** (`3f42927`,
105/105 captured stages per backend); **K15h’s own independent review: no blockers**.
Exact evidence, reviewer rerun log and scope: [I9 final handoff](handoff/integration-i9.md).
No engine speedup, F-PERF-CRT closure, first draw/title/playability, unrestricted GL3.3 or physical
hardware/Safari/Firefox certification is claimed. Historical lane/checkpoint counts below are not final I9 evidence.

## Integration I8 final three-lane checkpoint — K11 + K10 + K13

Ordered merges remain **`140b96c`** (K11 / `2124b13`), **`aa0f739`** (K10 / `f1fd1d9`), then **`fb1ce3d`**
(K13 / `9f5c191`), with follow-up commits `6f5eeae`, `7e31051`, `0f64339`. K13 adds bounded native scalar SSE,
checked native-step lookup/chaining and exact native suffix interiors; K10 coverage/census and Asyncify semantics are
preserved, with only generated `N_*` steps excluded from Asyncify. K9 GL and K12 heap sources remain preserved.

Three-lane validation evidence: **1,057 unit tests / 81 files**, **232 browser passes / 51 unchanged skips**
(WebGL2 104/24, WebGPU 120/26, auto 8/1), lint's **33/33 example check-builds**, and leakcheck's **619 files**
passed in the logged run. **29 default pipeline oracles ×300 = 8,700 pairs** plus `x64-crt`, `x64-cpp`, and
`x64-scale` in size/fast (**1,800 pairs**) all matched with null errors, zero lifted interpretation and empty stubs;
**10,500 total frame pairs**. Exact final-checkpoint caveat and logs: [I8 handoff](handoff/integration-i8.md).
A provider 429 prevented the requested follow-up review of the corrected suffix-test-only change; no independent PASS
claim is made for that change. No engine speedup, first-draw, title or F-PERF-CRT closure claim.

## Integration I8 — K11 + K10 over K12 (pre-K13 verification)

Reviewer scope extension: K13 (`9f5c191`) is now being integrated after these two lanes. The counts below are
pre-K13 evidence, not a final three-lane acceptance claim.

### K11 + K10 checkpoint

Ordered `--no-ff` merges **`140b96c`** (K11 / `2124b13`) then **`aa0f739`** (K10 / `f1fd1d9`) preserve K12's
segregated heap and K9's GL work. Size remains default; fast is opt-in. K10 coverage/strict checks and census reasons
are exercised in both presets, including affine quantum/guard boundaries and suspending handwritten overrides.
Final merged implementation gates: doctor, ESLint + clang/real-GCC lint (**33 example check-builds**, including scale),
typecheck and leakcheck pass; **1,020 unit tests / 79 files**, **232 browser passes / 51 unchanged intentional skips**,
both required backends. **29 default pipeline oracles × 300 = 8,700 identical pairs**, plus CRT/C++/scale in fast
(**900 more pairs**); the explicit size/fast matrix repeats three size controls (**10,500 total compared pairs**).
All lifted runs have zero interpreted instructions and empty stubs. Fresh independent bounded source follow-up passes;
no engine-speedup, first-draw or F-PERF-CRT closure claim. Details: [I8 handoff](handoff/integration-i8.md).

## K13 — native scalar SSE and flat boundary chaining

K13 adds native scalar SSE conversions/COMI, flat foreign-owner/thunk chaining, checked lookup caching and
bounded SSE/tiny native interior entries. Post-review gates: **840 units /68 files**, **218 browser passes /51
unchanged skips**, **25 ×2 presets ×300 =15,000 identical oracle pairs**. Final size+fast isolated A/B: scalar
~3×, interior ~2.6–3.1×; import/vtable gains are small/noisy (fast import unchanged), not an engine-speedup claim.
Independent **vK13 FAIL then vK13b PASS at 59ddafd** after memory-permission and test-sensitivity fixes.
Committed every sample, scope/tradeoffs: [K13 handoff](handoff/K13.md).

## K11 — opt-in lifted-code speed policies

K11 delivers opt-in AMD64 memory/ALU/attribute/counting policies (`pipeline.liftPreset: "fast"`, size-oriented defaults retained); **807 units / 66 files**, **218 browser passes / 51 unchanged skips**, **25 default pipeline oracles ×300** plus **6 ×2 policy oracles ×300** pass. Full measurements, bounded independent validation and explicit no-engine-speedup boundary: [K11 handoff](handoff/K11.md).
## K14b — Q41/Q42/Q43 completion

Commit `55e11c1` completes sparse fragment-output masks, linked std140 uniform-block ranges with the approved counted desktop zero-tail policy for undersized bound ranges, bounded GPU continuation and ordered `BUFFER_COPY` / `glCopyBufferSubData` on both WebGL 2 and WebGPU. Original CC0 fixtures cover exact sparse MRT pixels, 80/176/192-byte block reflection and relinking, short-range diagnostics/recovery, 289 native byte-copy comparisons per backend, and 3,000 ordered feedback draws. Final gates: **996 unit tests / 75 files**, **241 browser passes / 51 existing intentional skips / 0 failures**, doctor, ESLint + Clang/real-GCC lint (**33 example check-builds**), typecheck and leakcheck; **30 pipeline oracles × 300 frames = 9,000 identical pairs**. The ranges browser fixture records **121 guest checks per backend**, peak **9,008 lists / 39,008 commands**, with exact cross-backend finish results. No target title/playability or unrestricted GL 3.3 claim; see [K14b handoff](handoff/K14b.md).
## K14a checkpoint — Q40 opaque sampler helper parameters

Commit `8e6f602` adds bounded GLSL 3.30 / ES 3.00 opaque sampler-parameter specialization to the GL profile and
both native translators, with CC0 forwarding, overload, shadow/integer, array-identity, invalid-use and fallthrough
regressions. Final full unit evidence is **1,039/1,039 tests across 73 files**; doctor, lint (32 example checks),
leakcheck and typecheck passed. The native scratch audit found **104 unique captured stages plus the rejected
fragment; 105/105 compiled on each backend**, but it predates the last reviewer-fix amendment and is explicitly
pending rerun on the exact final tree. Full browser/oracle evidence likewise needs the checkpoint rerun; see
[K14a handoff](handoff/K14a.md). Q41–Q43 remain separate K14b requests. No title-screen or game-playability claim.

## K12 — deterministic guest heap and CRT allocation

K12 adds a bounded-work segregated guest heap for both Win32 widths, real logical `HeapCreate` ownership and
quotas, boundary-tag coalescing/in-place realloc, truthful failure/exception behavior, and the shared CRT
malloc/aligned/recalloc family. Original CC0 x64/i386 fixtures cover contracts and 300-frame differential
oracles; native invariants exercise 150,000 randomized operations per width. The same-machine CC0 benchmark
holds at 12.606–17.497 ns/operation from 4,005 to 40,005 live allocations versus 3,620–149,858 ns for the
old first-fit implementation. Final K12 gates: **979 unit tests / 72 files**, **232 browser passes / 51 existing
intentional skips**, doctor, clang+GCC lint (**32 example check-builds**), typecheck, leakcheck, and **29 pipeline oracles × 300 = 8,700
identical pairs**. Nested SEH/native-callback OOM is an explicit x86-runtime boundary with a precise diagnostic;
ordinary exhausted-backing AMD64 OOM dispatch is covered. Details: [K12 handoff](handoff/K12.md).

## Integration I7 — K9a + K9b

Integration commit **`2638514`** merges K9a with lane K9b/K9c using `--no-ff`, preserving K9a's GLSL integer,
aggregate-equality, lazy-expression and copy-in/copy-out lowering through K9b's WebGPU transform-feedback
vertex-to-compute path, plus K9b's Q34 transform feedback and Q35 blits. The conflict resolution exports the shared
identifier mangler while retaining K9a's complete reserved-word mapping. An original CC0 regression combines hex
literals, vector/struct equality and an inout helper in a captured vertex shader; exact interleaved/separate bytes
pass in GLSL330 and ES300 on both backends. Final gates: **965 unit tests / 71 files**, **228 browser passes / 51
unchanged intentional skips**, doctor, Clang + real GCC lint (**30 example checks**), typecheck and leakcheck pass;
**27 pipeline oracles × 300 frames = 8,100 identical pairs**, with zero lifted interpretation and empty stubs.
Details: [I7 handoff](handoff/integration-i7.md).

## K9a GLSL translation contracts

K9a adds full 32-bit integer literal/constant handling, scalar aggregate equality, lazy conditional/short-circuit
expression lowering and `out`/`inout` copy-in/copy-out with mutable caller storage, plus original CC0 cross-backend
numerical regressions. Scratch-only audit: **135 captured submissions / 61 unique sources**, all translate and compile
on both actual native compilers (stage compilation, not captured pipeline/render certification). WebGL 2 explicitly
rejects the native boundary `put(v.wy[dynamicIndex])` for out/inout parameters before native compilation; later unrelated
shader compilation/rendering is tested. Direct swizzles, array elements, members and aliases remain supported.
Final gates on `3dbd9e0`: doctor, clang + GCC lint (28 example checks), typecheck and leakcheck pass;
**939 units / 68 files**, **218 browser passes / 51 intentional skips**, **25 pipeline oracles × 300 frames = 7,500
identical pairs**. Original numeric corpus: **350 rendered results** (348 common + 2 WebGPU native-boundary controls),
plus two explicit WebGL rejections and subsequent successful renders. Fresh independent bounded review passes.
No wire ABI changes or target first-draw/title/playability claim. Details: [K9a handoff](handoff/K9a.md).

## K9b / K9c Q34 and Q35

Lane K9c (`3fea2b8`, `a256b2a`) implements ordered transform feedback (§13.11 / opcodes 0x61..0x63) on both backends: native WebGL2 capture and separate WebGPU vertex→compute lowering, pending/linked interfaces, original builtin capture, interleaved/separate buffers, ordering/discard/queries/errors and exact native readback. The original CC0 `x64-gl-feedback` fixture has **100 guest checks per backend**, exact captured bytes and cross-backend finish pixels; native edge regressions cover unaligned fetches, failed-link/setup cleanup, fail-closed generated-buffer recovery and 4.2M expanded strip outputs. Fresh independent source review at `a256b2a`: **PASS within bounded read-only scope**, no Tier1 attribution. Lane K9b's single-sample blits (§13.10 / 0x60, `3776c8e`) remain covered. Final Tier 1: **813 units / 69 files**, **226 browser passes / 51 existing skips**, **27 × 300 = 8,100 identical pipeline oracle pairs**, doctor, ESLint + clang/real-GCC lint (30 check-builds), typecheck and leakcheck green. Generated-buffer recovery fails closed rather than restoring stale bytes; array/matrix varyings and native-WGSL capture remain explicit errors. No target first-draw/title or unrestricted GL33 claim. See [K9b/K9c handoff](handoff/K9b.md).

## K10 — execution profiling and coverage

K10 execution profiling/coverage lane is delivered on its branch: sampled timing/resettable census windows,
no-`-g` named profiling, wasm-local coverage buffering and exact native Asyncify exclusions. Final implementation
`d9b0603` is locally Tier1 green: doctor, clang/GCC lint (29 builds), typecheck, **803 units/73 files**, **218 browser
passes/51 intentional skips**, leakcheck and **25×300=7500 identical oracle pairs**. This is lane evidence, not a new
merged-tree/game acceptance claim. F-PERF-CRT remains open (final0.97× reference); the138MiB named game rebuild
remains porter verification. See [K10 handoff](handoff/K10.md) and [benchmarks](../tools/bench/README-execution.md).

## K8a Q21 final completion

Lane K8a continuation 3 completes the bounded Q21 GL contracts on top of `39c42d5`. The final implementation commits
are `c231e5e`, `732a19f`, `e0d268f`, `579bebd`, `0b1e751`, `c8792f7`, `872b112` and the final documentation commit.
Depth uploads/readback, all 18 integer texture formats and typed samplers/render targets, indexed typed clears, current
attributes, swizzles, lazy depth mip growth and configurable budgeting are covered by actual WebGL2/WebGPU fixtures.
WebGPU `DEPTH24_STENCIL8` stencil readback remains truthful `E_UNSUPPORTED`; integer out-of-range fragment output into
narrower targets remains an explicit native boundary and is excluded from portable cross-backend equality.

Final local tier-1 evidence: doctor ready; lint (ESLint, clang and real GCC) pass; typecheck pass; **790 unit tests / 66
files pass**; **218 browser tests pass / 51 intentional skips / 0 failures**; leakcheck pass; **25 pipeline examples ×
300 frames = 7,500 identical oracle pairs**, null errors, zero lifted interpretation and empty stub lists. The fresh
independent review passed within bounded source-review scope and did not claim tier-1 attribution. No original game
files were copied or run, and no first-draw/title/playability claim is made. See `docs/handoff/K8a.md` for fixture,
coverage and limitation detail.

Integration I6a on `integration/p1` merges **K8b** after K7i, then **K8c**, each with `--no-ff`. K8b adds typed
GLSL boolean-selector `mix` lowering and translation regressions for WebGPU/WebGL 2; K8c adds process-local WASAPI
endpoint-notification ownership and shared DOS `\\?\`/`\\.\` path normalization. K7i's separate compilation,
lazy declared test builds, shared CAS and sandbox-safe portable heavy gate remain intact; the earlier I5 GPU, CRT,
VFS, x87, bridge and scale work remains in place.
This is still **0.3.0-dev.1**, a bounded kit-development delivery, not unrestricted Windows/OpenGL compatibility,
a release certification, or a new game-playability claim. This merged ledger supersedes the old per-stage missing
lists. Historical measurements remain in [verification.md](verification.md); lane details are in [handoff/](handoff/).

## I6a merged verification

Doctor, ESLint + clang + real GCC lint (**27 example check-builds**), typecheck and leakcheck pass. The full sandbox
unit suite is **765 passed / 63 files / 0 failed**, including `tests/unit/pi-harness.test.ts`; K8b's new GLSL unit
file declares `x64-glsl`, so K7i lazy selection builds every declared fixture. Full required-WebGPU browser suite is
**210 passed / 51 existing intentional skips / 0 failed / 0 flaky** (WebGL 2 **95/24**, WebGPU **107/26**, auto
**8/1**). All **23 pipeline examples × 300 frames = 6,900 identical pairs**, null errors, zero lifted interpretation
and empty lifted stub lists. Details and command evidence: [I6a handoff](handoff/integration-i6a.md).

## I5 merged verification

Doctor, clang + real GCC lint (**27 examples**), typecheck and leakcheck pass. Full required-WebGPU browser suite:
**208 passed / 51 existing intentional skips / 0 failed / 0 flaky** (WebGL 2 **94/24**, WebGPU **106/26**, auto **8/1**).
All **23 pipeline examples × 300 frames = 6,900 identical pairs**, null errors, zero lifted interpretation and empty
lifted stub lists. The unchanged default unit suite is **655 passed / 5 failed**, 59 files, no skips: only the merged
K6e FIFO gate's sandbox-denied `ps`/liveness regressions fail. Reviewer-directed **external validation of
`tests/unit/pi-harness.test.ts` on the exact commit is pending**; no sandbox change, skipped acceptance test or K7i
cherry-pick is substituted. No full Tier 1-green claim is made while that gate is pending. Details and intermediate
failures: [I5 handoff](handoff/integration-i5.md).
The original CC0 `x64-gl-fbo` fixture now verifies typed sampler reflection, nonzero units 3/5 with unit-zero
bindings cleared, distinct 3D slices/array layers, and shader-biased mips; all existing FBO/pixel assertions remain.
Host frontend regressions cover dimensional sampler arrays, Y-only coordinate/gradient/fetch conversion,
GLSL ES 3.00 declarations, WGSL texture types and retained shader bias. No tolerances or assertions were weakened.

## Historical I3 merged verification

- **Tier 1 green on final implementation `d5f836c`:** doctor ready; lint (ESLint, real GCC and all **22 example
  check-builds**), typecheck and leakcheck pass. Explicit host builds also pass with **clang 21 and GCC 14.2**,
  `-O2 -Wall -Wextra -Werror`.
- Unit: **504 tests / 43 files passed**, zero skips/failures. The first merged run exposed K3's standalone harness
  missing K2 protection metadata; repaired with definitions only, without changing any x87 assertions. Final suite
  was rerun after the last empty-path regression. Bridge fixtures still isolate/restore inherited provider settings.
- Browser: **196 passed / 51 existing intentional skips / 0 failures**, WebGPU required: WebGL 2 **89/24 skipped**,
  WebGPU **99/26 skipped**, auto **8/1 skipped**. Skips are unchanged backend/tour exclusions and opt-in no-adapter /
  injected-broken-device policy cases; neither GPU backend was unavailable. No skip policy was added or weakened.
- **All 18 pipeline examples × 300 frames = 5,400 identical frame pairs**, both errors null, lifted
  `interp_insns=0`, empty stub lists. Includes K1 sysdlls, K2 contracts and LSC scale. Smoke additionally compares
  20 startup frames; its existing unit/browser workloads retain 600 GL loops. Four native examples have no guest
  interpreter and retain their build/browser/known-answer coverage, not a fabricated differential self-oracle.
  Exact inventory and commands: [I3 handoff](handoff/integration-i3.md).
- Browser tests own port **5203**, never developer `:5173`; unrelated SPA readiness cannot be reused.
- Real fresh independent sessions inspected the merges/hooks and later repairs. Final fresh reviewer independently
  passed **55 focused tests / 5 files** at `d5f836c`, including both guest widths/execution modes, x87, codegen,
  bridge and host entropy/scheduler checks; **PASS within bounded scope**. Broad Tier 1 gates above are integrator
  evidence, not attributed to that reviewer. Earlier I1/I2 reviews remain in their historical handoffs.

## K6d follow-up verification

The Q24 CRT metadata follow-up is verified on top of I4 (`ca2cd17`): one VFS implementation now serves kernel32
and both-width CRT stat/fstat/access/directory/find/cwd/fullpath/remove/rename families, plus implemented registry
value deletion. Final gates: doctor, clang + GCC lint (**24 examples**), typecheck and leakcheck pass;
**576 unit tests / 53 files**, **200 browser passes / 51 existing intentional skips**, both backends exercised;
**20 pipeline oracles × 300 frames = 6,000 identical pairs**, null errors, zero lifted interpretation and empty
stub lists. Both-width CRT fixtures add **251 i386 / 330 AMD64 checks**, lifted and interpreted, and complete
**600-frame** identical oracles. These local bounded results supersede no historical native/hardware limits.
Details, review findings, fixes and provenance: [K6d handoff](handoff/K6d.md).

## Delivered implementation

| Area | Merged behavior / evidence | Explicit boundary |
|---|---|---|
| AMD64 execution, Task 1 | Shared decoder/interpreter/lifter, baseline SSE/SSE2, Win64 callbacks, TLS, MinGW C++ SEH/unwind; known-result and zero-interpretation fixtures | Not arbitrary Win64, MSVC personalities or AVX; bounded x87 model below |
| CRT + memory, Task 2a | Shared 396-name CRT registry, normal -O2 C/STL native-reference fixtures, 600 MiB touched/153600 pages checked in a configured 2048 MiB window | Default 1024 MiB guest window, images 16–64 MiB; locale/files/math/formatting remain bounded |
| S1 + K6a GPU ABI §13/§13.7 | All 30 opcodes 0x40..0x5d, C/TS layouts/encoders, 2D/3D/array storage, extra formats, LOD samplers, readback/mip generation, resource/pass/budget validation | Frozen old IO/commands and 80-byte limits retained; no cube/layered/depth-volume storage |
| WG WebGPU | All §13 commands; native WGSL plus kit GLSL330/ES300→WGSL frontend; formats, MRT, depth/stencil, indexed/base-vertex/instances, recovery and ordered 2D/GPU screen/readback | Practical frontend, not unrestricted GLSL; explicit errors for unsupported syntax; language mask 7 |
| W2 WebGL 2 | All §13 commands; GLSL330/ES300 execution, portable IDs/strides, MRT/depth/stencil/mips, interleaving/readback and actual context-loss restoration | WGSL is **WebGPU-only**; mask 6; CAP_GPU requires extensions and portable limits |
| GL OpenGL profile + K6a/K6b | WGL/GL 3.3→§13/§13.7; 360 names, 192 implemented / 168 explicit unsupported; textures/FBOs, preprocessing, active-uniform/block/attribute reflection, uniform arrays/structs; `x64-gl`, `x64-gl-fbo` and `x64-glsl` real-backend pixels | Bounded GL subset, not full GL 3.3; cube maps rejected; recording semantic oracle is separate from raster evidence |
| E COM/audio/input + K8c | Class registry/identity/refcounts/task memory, WASAPI shared stereo float32/int16 + virtual clock, process-local endpoint notification ownership, Raw Input, separate four-slot gamepads, XInput and best-effort rumble | No general COM marshaling, capture/exclusive audio, WinMM/DirectSound expansion, full HID or physical rumble verification |
| C threads | Deterministic cooperative i386/AMD64 workers, waits/events/mutexes/semaphores/CS/SRW/CV/address waits, TLS/FLS/TEBs/last error and instruction quantum | Bounded single process; native callback continuations are LIFO, not general native fibers |
| F codegen | Register-local AMD64 integer/common SSE emission, conservative flag liveness, guarded flat-memory spans, cold semantic/quantum boundaries | Correctness gates green; literal x64-crt performance acceptance remains **unmet** |
| G reviewer bridge | Workspace-only extension, persistent loopback queues/status/waits/live and no-tools fork questions, independent-clone launcher | Same-user coordination, not authentication/isolation; settled does not mean tests passed |
| Existing UI/files/slices | Phase 0 UI/font fixes, streamed read-only Win32 files, coverage-guided strict code/data slices and explicit outside-slice stops | Not minimum loader images, lazy wasm chunks or complete Win32 APIs |
| K1 system DLLs | Nine DLL namespaces; 43 exercised exports, offline Winsock ownership/errors, DirectInput snapshots, Web Crypto entropy and bounded AVRT scheduler weights | No network/DNS transport, compositor, IME, adapters or fabricated unavailable hardware; [K1](handoff/K1.md) |
| K2 existing DLLs / census | Width-aware complete ordered registry census with failure-only annotations; page protections, FILE/descriptors, mutable VFS enumeration, icons, clipboard and pointer tracking | 33 of 131 requested unique contracts are tested failure-only; process-local writes, bounded UI/memory/CRT; [contracts](../platforms/win32/CONTRACTS.md) |
| K6d CRT filesystem / registry | Shared kernel/CRT metadata, stat/find layouts, nested directory/cwd/path/rename/remove operations, timestamps/errno and RegDeleteValueA/W tombstones; [handoff](handoff/K6d.md) | No i386 FILE layer, persistent writable kernel files, Unicode/extra drives/short names/chmod/utime, or RegDeleteKey; native error mappings remain INFERRED |
| K3 x87 / analysis / metadata | Shared software ext80 basic arithmetic/control/state; retained-function census, conservative AMD64 NULL pruning and bounded unwind-table continuation | Binary64-accuracy transcendentals; explicit unmasked-exception faults, not general Windows FP SEH; [precision model](../platforms/x86/X87.md) |
| LBR harness | Process-owned exits, queued isolated lanes, bounded session-fork retries, machine-wide heavy gate, verified cleanup; CI reviewer requests default 45 min | Same-user coordination, not authentication; nested seatbelt and Linux lockf availability not certified; [handoff](handoff/harness-hardening.md) |
| LSC scale / loading | Bounded function-preserving chunks, content caches/writer leases, hash-verified streaming wasm loads; 1,609,529-insn fixture with native checksum + 300-frame oracle | Not a 7.1M game build, lazy modules, mobile performance or a full-workspace disk bound; [measurements/caveats](handoff/scale.md) |

Details: [GPU ABI](../bgt/abi/ABI.md#13-v03-gpu-layer-additive-interface),
[WebGPU backend](../bgt/renderers/webgpu/README.md), [WebGL 2 backend](../bgt/renderers/webgl2/README.md),
[threads](../platforms/win32/THREADS.md), [pipeline](pipeline.md), [trials/bridge](trials.md).

## Integration decisions (not lane replacement)

1. Keep all E COM/audio/input, GL and kernel/USER/GDI import tables and every profile DLL. Give thread-aware
   duplicate APIs priority; preserve C's scheduler, per-thread errors, deferred-result traces and continuation tables.
   Compile audio/COM/input/GL/thread/scheduler sources for both guest widths.
2. Replace E's temporary main-thread event adapter with scheduler-owned events. Native audio signaling validates the
   shared event namespace and wakes waiters without changing guest arguments/last error. COM apartment mode/nesting
   is per guest thread. I2's audio client is created/rendered/released entirely on a guest audio thread while the
   primary joins it; nested worker wakeups still check isolated STA/MTA nesting/last error. Exact 48,000 stereo-frame
   sample/amplitude/frequency/duration assertions remain unchanged.
3. Keep F's optimized emitter, not C's older generic emitter. Its cold CALL path returns on a pre-execution quantum
   transfer before invoking the unexecuted target. Existing thread spin/continuation and codegen CPU/RAM regressions pass.
4. Share CAP_GPU/backend negotiation and restoration events. Fail closed on **host logical resources, queued GPU work
   or renderer objects**, including loss before first GPU draw. Resource-free legacy 2D fallback may renegotiate to
   WebGL 2; no live §13 language/resource migration is performed. This resolves WG/W2 policy overlap using the explicit
   safe default after a reviewer timeout; existing fallback and GPU-loss assertions were preserved.
5. K2/K1 core conflict: retain all DLL tables and the union of FindFirstFile/INVALID_SOCKET full-width invalid
   handles. Use the ordered, preprocessed census with K1's compact table declarations as well as K2's width,
   precedence and failure-only behavior. No lane-specific second inventory replaces runtime registrations.
6. PathFileExistsW and GetFileAttributes share K2's shipped/mutable metadata index with enumeration. Queries do
   not consume kernel/CRT/search slots and preserve PathFileExistsW last error. Anonymous tmpfile remains unnamed;
   named writable/temp paths, directories, rename and unlink are visible immediately. K6d additionally implements
   nested cwd, empty process-local directory deletion and closed mutable-file removal through both kernel/CRT
   front ends; shipped assets remain read-only. Persistent kernel writes remain unavailable.
7. Preserve K3's lifter/FPU changes and K2's per-page checks. A monotonic global protection flag disables unchecked
   whole-block span paths before any local mutation once non-default permissions are installed. Checked semantic
   boundaries retain legal read-only reads and precise protected-write faults; restoring RWX does not reset the flag.
   This is conservative, not a new performance claim.
8. Kernel SetThreadPriority drives K1's scheduler hook without replenishing credits; GetThreadPriority retains the
   requested Windows value, separate from AVRT's temporary scheduler weight. CI reviewer requests containing “run CI”
   default to 2700 seconds (ordinary decisions: 900), with explicit timeout overrides and 15–45-minute guidance.

## Remaining limits / deferred acceptance

### F-PERF-CRT remains open

Lane F's saved same-toolchain whole-module benchmark reports CPU-heavy code **4.85× smaller / 3.65× faster**, but
`x64-crt` only **1.55× smaller / 1.10× faster**, below the literal ≥2× size-and-speed requirement. `x64-cpp` and
`win32-hello` did not improve execution time in that sample. These are lane measurements, **not rebenchmarked on the
larger merged profile**. Cache differences prevent claiming compilation speedups; no 7M-instruction feasibility or
universal speedup. See [codegen handoff](handoff/codegen.md) and its committed before/after JSON.

### GPU / GL

WGSL is not translated for WebGL 2. The maintained WG frontend consumes canonical §13 shaders, not unrestricted
preprocessing/extensions or ordinary non-block GL uniforms. K6b's bounded C frontend preprocesses, reflects and
flattens those uniforms, arrays/structs, blocks and constant sampler-array elements before backend compilation;
the WG frontend supports user structs and local out/inout arguments. Both renderers restore uploaded resources
but lose rendered attachments and emit reset/targets-lost events; unrecoverable resources are never silently migrated.

The K20 baseline replaced the 255-name tables with ABI-sized **1023-slot tables and full-GLuint name lookup** in all nine
supported object namespaces. **K24 supersedes its buffer/VAO count limits** with byte-bounded dynamic guest
tables and negotiated full-u32 buffer handles (§13.14); the other seven namespaces retain1023 slots.
Without the K24 opt-in, textures/renderbuffers share1001 storage handles and buffers/program uniforms
share1015, excluding retained private reservations; frozen ABI ceilings and byte budgets are unchanged. Exhaustion raises
GL_OUT_OF_MEMORY with per-namespace live/peak/failure metrics and diagnostics. Pipeline caches remain 128 descriptors
(sampler descriptors now ABI-sized and pressure-evicted, with current-draw states protected), one current WGL
context and one shader per stage. Generated VAO/FBO/RBO names become objects on first bind, matching
texture/buffer/query reserved-name semantics; samplers/shaders/programs exist immediately. **K20e author Tier 1 passes**: 1994 units,
287 browser passes/51 existing skips, and 32 pipeline oracles ×300 frames; cold before/after native capacity pixels
and exhaustion metrics pass both backends. External review found reserved-name identity, sampler-cache churn and
test-adapter batch-framing defects; K20e repairs all three with before/after regressions and fresh full Tier 1.
Independent revalidation remains reviewer-owned. See
[K20 handoff](handoff/K20.md) for limits, the accepted unbound-FBO lifetime wire delta, and porter follow-up.
The shader frontend uses pooled storage (1 MiB source/expansion, 512 uniforms, 16 KiB ordinary uniform data,
8 samplers/7 user blocks); texture uploads remain bounded by the ABI. K6a adds color texture/FBO readback and
validated pixel-store conversion, nonzero mips, renderbuffers and multiple draw buffers. No cube/1D/rectangle/MSAA,
layered/3D attachment, depth transfer or integer/SNORM/compressed-format support is claimed. Array-shadow/integer
samplers, dynamic sampler indexing/parameters, row-major/block-array/interface-block translation remain unsupported. K9a adds all 2..4-column/row matrix forms to the WG frontend, including padded std140 two-row matrices;
the separate GL profile's existing non-square limitations are unchanged. Mapping/query/sync APIs, conversions outside
float1..4/normalized-u8x4/i32/u32 attributes, divisors other than 0/1, scissored/masked clears, reversed depth ranges
and constant-alpha combinations are unsupported or visibly rejected. Legal border wrap and LOD bias parameters
remain queryable counted approximations. See [K6a](handoff/K6a.md), [K6b](handoff/K6b.md) and the superseding
[I5 integration](handoff/integration-i5.md) limits. I2 compiles/rasterizes `x64-gl` on both actual
backends, with per-tile goldens, side-effecting UV evaluation, colored ordered readback and cross-image comparisons.
One `gpu-scenes` fixture supplies common GLSL/ES scenes to both backends; native WGSL/lifetime extras remain selectable
within that fixture, not a duplicate executable. [Tolerance and launch details](../examples/gpu-scenes/README.md).
`x64-smoke` normally links GL 3.3 + worker/file + ten-second WASAPI thread + XInput; 600 GL frames/6,000 draws, exact


[Showing lines 1-528 of 529 (50.0KB limit). Use offset=529 to continue.]