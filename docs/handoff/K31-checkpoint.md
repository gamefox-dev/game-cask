# K31c checkpoint — reviewer #281 requests a fresh session

**WIP, NOT Q78/Tier1 acceptance.** lane/K31, base dev.18 211daca.
Source commits f3ed073 + d4054da + b0a57af + **f65d33c**; 69041b5 is handoff-only.
This checkpoint commit is documentation-only. **No production/test delta after f65d33c.**
No push/installs/web/game data/compaction. Test port **BGT_E2E_PORT=5276**.
Read original brief /Users/dev/projects/pi-work/briefs/k31-counters.md, AGENTS.md/CLAUDE.md,
pipeline/v03-status, K10/K26, and supplied read-only perf-mp3 contract. Evidence/runners:
**/Users/dev/projects/pi-work/scratch-K31**. Final reply <200 words; end this session now.

## K31c implementation / completed work (do not redo)

Inherited separate process/per-owner u64 retirement native/generic/interpreted; no TSC subtraction.
Native batching at existing synchronization excludes current fault; i386 commits after semantics/before
transfers. Partial REP once at final completion, zero-count once. No synthetic import/thunk/callback/
override work. Context restore/census reset preserve retirement. Stable64 scheduler identities and
metadata/state, active/ready/Sleep/object/I/O/suspended/host-yield host wall; virtual requested/elapsed
waits, switch-ins and actual parking. CPU time null. Native-present64 cumulative process/thread ring,
explicit drops; decimal strings, BigInt subtraction before safe numeric conversion, contained pairs.
Profile0 retains retirement/identity/state, not timings/snapshots. Off erases hot work and is unavailable.

K31c source f65d33c:
- **Default accounting now OFF**, header and build environment; enable BGT_CPU_ACCOUNTING=1 and rebuild.
  Disabled/unset reports unavailable/null, never measured0. Reviewer267 threshold was not met.
- Added actual guest-import-driven known-count straight-line assembly program both widths, both
  dispatch modes, both real suspensions: i386 main45+worker7, AMD64 main46+worker9. CreateThread,
  real deferred range ReadFile polling, Sleep10/5, event wait/signal, SwitchToThread, join, closes,
  ExitProcess. Exact per-owner totals, active freeze during pending I/O, exit/reset lifetime checks.
- Added real scheduler/core memory fault: NOP retires1, failing MOV0; actual host export abort cleanup
  freezes running, exited worker/time and snapshots. Existing exact timing/ring assertions preserved.
- Added explicit post-last-present-tail summary test; default-off standalone serialization assertion.
- Fixed untested capture microbenchmark scaffolding with required Asyncify buffer exports.
- Fixed unused import/explicit-any benchmark lint only; no measured code/body semantics changed.
- Pipeline docs describe measured default-off and enable command. Durable **K31-measurements.json**
  has compact raw overhead samples/resources/identities and negative-control assertion evidence.

## Complete MEASURED overhead / reviewer decisions

Main overhead matrix **1/1 PASS,2060.42s**, overhead2.exit=0.9 alternating paired warmed samples,
300 fresh-instance updates each, same guest/API/state/legacy counters. Original CC0 CPU-heavy and
full12000-owner scale (not reduced). Raw full report overhead.json (SHA in committed compact evidence).

| fixture | profile | mode | off median ms | on median ms | on/off-1 |
|---|---:|---|---:|---:|---:|
|cpu-x86|0|Asyncify|100.998500|51.049833|-49.4549%|
|cpu-x86|0|JSPI|41.890792|42.415416|+1.2524%|
|cpu-x64|0|Asyncify|12.915959|9.019875|-30.1649%|
|cpu-x64|0|JSPI|8.250375|7.940292|-3.7584%|
|cpu-x86|1|Asyncify|109.298375|51.079500|-53.2660%|
|cpu-x86|1|JSPI|41.405750|44.770334|+8.1259%|
|cpu-x64|1|Asyncify|14.460125|9.662333|-33.1795%|
|cpu-x64|1|JSPI|7.645375|8.671667|+13.4237%|
|x64-scale|0|Asyncify|2432.5731|54.8996|-97.7431%|
|x64-scale|0|JSPI|33.314125|39.688917|+19.1354%|
|x64-scale|1|Asyncify|2775.0615|112.6151|-95.9419%|
|x64-scale|1|JSPI|44.5674|73.3519|+64.5863%|

Profile0 isolates retirement; scale JSPI **+19.1354% >~2%**, so default OFF is settled, not conditional.
Large favorable Asyncify differences are code-shape/JIT/shared-machine observations, **not robust speedups**.
Profile1 additionally measures scheduler instrumentation, not isolated retirement. No game/60fps claim.
Native-present capture microbench **1/1 PASS,3.14s**, present-overhead2.exit0; real clock,1/64 identities,
both modes,100000 captures x9. One-owner incremental ~33.145ns Asyncify/~31.559ns JSPI; full1/64 raw
samples/hashes/resources in present-overhead.json and committed evidence. No guest/GPU work or throughput claim.

Reviewer bridge decision in K31c: **entire broad Tier1 at shipped default OFF**; additionally accounting ON:
full npm test, EVERY pipeline oracle300 with **ON vs OFF traces identical**, and **WebGPU test:e2e in BOTH
suspension modes**. Need known-count and unavailable controls too. Default-OFF-only broad gates insufficient.
Reviewer also requests recording where19% goes (counter increments/spills/lost chaining); attribution pending.

## Focused / sensitivity actual results

- inherited focus4 retirement7/summary4/serializer2 pass (i386 scheduler pass), scheduler2 both widths pass.
- **import-retire.exit0**,2 tests,6.94s: actual nested native/import/callback/park/exception retirement4/6.
- **guest-accounting3.exit0**,2 tests,27.62s: all8 width/dispatch/suspension combinations execute.
- **focus-c.exit0**,9 tests/3files,39.22s: scheduler2 incl new actual fault/abort freeze, summary5,
  serializer2 incl default-off. Existing hand-clock budgets/drops assertions unchanged.
- **types7.exit0,eslint7.exit0**. Predate only the guest SafeSEH assembly annotation and artifact-id suffix
  fixture repairs; broad final checks include those. Earlier types6=2/eslint6=1 escaping+unused import/any fixed.
- **negative.exit0** runner means7 intended mutants each exit1 at actual assertions (no compile/setup false proof):
  retirement-removed0!=18; attempts-counted1!=0; process-restored18!=36; parked-running1000000!=0;
  drops-lost0!=8; unsafe-before-subtraction40!=42; post-present-tail90!=3. Private negative-tree removed.
  Logs named by mutants and negative-evidence.json retained; hashes/expected failures in committed evidence.
- guest-accounting initial exit1 no execution: newline string escaping; guest2 exit1 i386 SafeSEH and AMD64
  interpreted artifact id suffix. Repaired fixture only; guest3 full pass. present-overhead initial exit1 missing
  Asyncify buffers, repaired; second passes. No assertion/deadline/tolerance/skip weakened.
- Latest diff--check and commit hooks leakcheck passed. No final full units/browser/oracle result yet.

## LIVE owned jobs — detached serial queue; leave running

At **2026-11-05 08:56:21 UTC** both live roots passed kill -0. ps forbidden. Never generic-kill/remove shared
locks/caches/tickets or active outputs. All paths below under scratch-K31. Disk **8.3GiB free**.

### Root **55593** — tier1-run.sh

Runner log tier1-runner.log; evidence **tier1/**. Began on clean source **f65d33c**; commit identity and empty
initial.diff retained. Only documentation changed afterward. First **default-off/doctor.exit0**. Full lint in
progress, including real GCC and38 example checks, BGT_INCLUDE_SCALE=1; at last poll finished x86-handles
and was compiling/postprocessing x86-heap. x86-handles took~300s/1.82GiB peak child on shared machine.
**No lint.exit yet**, do not duplicate it. All subsequent steps still queued. Heavy shim waits are not failures.

Exact order, one heavy suite at a time:
1. **tier1/default-off/**: doctor, full lint, explicit clang host checks, typecheck, full units (maxWorkers1,
   original test deadlines), full Asyncify browser, full JSPI browser, leakcheck, every pipeline oracle300 both modes.
   Env BGT_CPU_ACCOUNTING unset (header default0), CPU_PROFILE unset; JSPI/TEST_JSPI=1, requiredWebGPU=1.
   Gates each name.log/.start/.end/**.exit**. Browser JSON copied to browser-asyncify-results.json / browser-jspi-results.json.
2. **tier1/accounting-on/**: BGT_CPU_ACCOUNTING=1; full units, WebGPU-only full e2e Asyncify then JSPI,
   all pipeline oracle300 both modes. Same per-step logs/exits/browser report copies.
3. Writes **tier1/done** when queue ends (NOT automatic success; inspect every exit).

**tier1-oracles.mjs** enumerates every pipeline example, stores inventory and each **oracles/<id>-<mode>.log/.exit/.json**
under each configuration, plus parent oracles.log/.exit. No oracle contract/assertions modified; exact existing
x64-gl-scale expected-error contract must be retained. Must audit requested/compared300, identical, null errors,
interp0/stubs[], state+semantic trace hashes within/across modes AND accounting configs, actual availability.

Prepared **tier1-audit.py** (NOT RUN): checks exits, workload/errors/traces/availability/cross-mode+ON/OFF,
browser failure/flaky+mode skip equality; writes tier1/audit.json. Needs inspection and exact expected skip
inventory/backend/scale error audit added; do not infer acceptance solely from this unfinished auditor.

### Root **24093** — attribution-queue.sh

Waits **tier1/done**, then creates private archive **attribution-tree** from **f65d33c** with symlinked installed
packages EXCEPT .cache (no original/live production edits). attribution-prepare.py + attribution-test.ts + private
vitest config; queue log attribution-queue.log; preparation .log/.exit; benchmark **attribution.log/.exit/.json**.
**No archive created or attribution variant measured yet.** The new script has NOT compiled/run/typechecked.

Proposed diagnostic: same full12000-owner CC0, profile0 JSPI-only (avoid Asyncify confound), private variants
OFF / accounting enabled-noop / process-only / thread-only / BOTH / diagnostic-sites. All timed first5 interleave
9 alternating warmed samples, same legacy counters/API/state traces; sites counts retirement commits/zero-sized
flushes without claiming it as timed production throughput. Captures native R/N/F function bytes/local counts and
changes versus OFF, raw hashes/resources. Native names >12000 assertion protects absent-name false evidence.
Archive headers/rt restored in finally; artifacts removed; queue deletes archive ONLY if successful. On failure
retain and inspect/repair; do not delete active outputs. Private incomplete accounting variants must never ship.

Attribution so far is **source localization only**: two u64 additions (process + selected-thread pointer) at existing
AMD64 syncs; no new l64_sync boundaries or changed chain transitions; matched scale has same25044 lifted calls,
generic1/interp0. New local retirement debt and compiler/JIT alias/spill/code-layout effects are NOT causally
separated. Main measurements alone do not prove percentage spent on increments vs spills. Finish ablation/report
honestly, avoid an optimization scope creep; reviewer wants a later lane to use attribution.

### Finished roots / cleanup

14400 overhead2,23570 post-overhead,71026 negative,52676 continue-c,13065 apply-default,35899 repair-c,
48164 guest3 all no longer live. Every relevant result is above. No other K31 heavy root intended.
negative-tree removed; main benchmark removes owned wasm artifacts after each profile pair. Retain small reports,
logs, input/artifact hashes/resources before deleting only completed OWNED temporaries. No shared caches touched.

## External independent validation

Reviewer **launched fresh read-only vK31 at f65d33c** after author request. **Still running/no result known**.
Do not claim independent PASS/CI. Reviewer specifically asks listing all later code deltas for recheck:
**none after f65d33c**; 69041b5 and this checkpoint are documentation-only. Any next-session source/test repair
must be named with its exact commit/diff and revalidation boundary. Independent review and Tier1 are separate.

## Exact next steps for K31d

1. Read this checkpoint first, audit current per-step exits/logs and disk without rerunning completed unchanged
   gates; leave root55593 serial sweep running. Fix genuine failures, never assertions/deadlines/skips. If source
   changes, stop only owned queue safely at a suite boundary/record which already ran on old source, arrange
   honest final-source reruns; no concurrent suites. Record all delta for vK31 reviewer.
2. Audit finished full reports (not merely exit markers), actual WebGL2/WebGPU in default OFF and requiredWebGPU
   ON, exact unchanged intentional skips, every oracle300/error/stub/trace contract and ON/OFF equality. Runtime
   accounting-disabled summaries must unavailable, not zero. No finish-line claim before requested matrix green.
3. Attribution queue follows sweep automatically. Inspect/repair private script real compile/setup problems;
   collect process/thread/noop ablations, local/body changes and diagnostic commit count. Distinguish counter
   increment effects from compiler/JIT code shape and unchanged chaining; unknown residuals stay unknown. No
   game/60fps claims or production optimization to rescue default. Keep default OFF already settled.
4. Incorporate external vK31 findings; exact sensitive regression and delta re-review if needed. No independent
   validation result yet. Keep author gates and independent acceptance separately labeled.
5. Update durable K31 measurements/gate evidence/handoff and pipeline/status only with actual results. Current
   handoff K31.md is accurate WIP; this checkpoint supersedes its queue details. Clean owned large outputs only
   after finished roots and hashes; commit lane/K31, never push. Full gate logs external, compact evidence tracked.

Reviewer #281 explicitly requests ending this session here. No compaction or acceptance claim.
