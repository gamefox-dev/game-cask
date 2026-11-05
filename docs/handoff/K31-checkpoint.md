# K31d checkpoint — reviewer #287 requests fresh session now

**WIP / NOT Tier1 or Q78 acceptance.** lane/K31; base dev.18 211daca.
Latest source **6ca26a5** (after external review f65d33c); this checkpoint is docs-only.
No push/web/installs/game files/compaction. CC0 fixtures only. Port **BGT_E2E_PORT=5276**.
Read original brief /Users/dev/projects/pi-work/briefs/k31-counters.md, CLAUDE.md, pipeline/status,
K10/K26 and read-only perf-mp3 contract. Scratch **/Users/dev/projects/pi-work/scratch-K31**.
Prior detailed K31c checkpoint is retained in **git show e78e53f:docs/handoff/K31-checkpoint.md**;
do not redo its passing overhead/focused/negative controls. Reviewer requests ending NOW.

## Reviewer decisions / implementation inherited

Default OFF is settled (#267/#275): full12000-owner CC0 profile0 JSPI measured **+19.1354%**, above~2%.
Enable BGT_CPU_ACCOUNTING=1 and rebuild; off unavailable/null, never zero. Full12 overhead rows/raw samples,
resources, capture microbench and7 intended assertion-negative controls in K31-measurements.json.
Asyncify favorable differences are code-shape/JIT/shared-machine observations, not robust speedups.
No game/60fps/CPU-time claim. Existing source f3ed073/d4054da/b0a57af/f65d33c implemented separate
process/per-owner retirement, scheduler wall/virtual reason buckets, bounded64 present snapshots,
contained BigInt frame deltas, no TSC subtraction; actual guest-import known counts both widths/modes.

Tier1 required: entire broad matrix shipped default OFF; plus ON full units, EVERY pipeline oracle300
with identical ON/OFF traces, WebGPU full e2e both suspension modes. No assertion/deadline/skip weakening.

## External vK31 FAIL / repair commit boundary

Fresh external **vK31 FAIL at f65d33c**, reviewer #282; read-only evidence:
**/Users/dev/projects/pi-work/inputs/vK31/{review-summary.json,reviewer-repro.test.ts,final-result.txt}**.
20 focused pass independently, but two P2 defects found. No vK31b yet.

**6ca26a5** implements (NOT yet validated; repair2 focused currently running):
1. x86_sched.c installs accounting abort hook when an identity/span is created, rather than scheduler init.
   Main identity precedes i386 process TLS callbacks and AMD64 TLS/DllMain, so host exceptions cannot leave
   startup running open. No callback/guest scheduler reorder. New **accounting-startup.test.ts** original CC0
   runs real pipeline process TLS and real DLL entry exceptions, both widths, lifted/interpreted and Asyncify/JSPI,
   expects exact10us before abort and frozen after+1s/profileReset, original error and main not reached.
2. w32_core.c all new accounting counter/timestamp values now **unsigned decimal strings**: thread switches,
   requested finite waits/infinite waits, parked_host_us, wall_us and virtual_ms buckets; ring dropped and snapshot
   present/wall_us/lifted_calls/generic_insn_execs. Bounded id/start_address/enabled/timing_enabled/capacity numeric.
   Wall strings preserve integer observation of a double, not hardware precision. instruction-accounting.ts subtracts
   scheduler/snapshot strings via BigInt before safe conversion; rejects unsafe legacy Number inputs, handles exact
   presentation adjacency, guards summed active integer budget. Raw strings retained; schema in docs/pipeline.md.
   New **accounting-precision.{c,test.ts}** real serializer tests UINT64_MAX and2^53+1 lifetime counters/snapshots,
   exact small deltas and unsafe legacy-number unavailability. Existing timing/drop/guest count assertions only change
   JSON representation types, not expected values. Summary compatibility tests with old safe numbers unchanged.
3. Broad sweep found two additional genuine failures (below). Fixed native scheduler header requirement by including
   bgt.h only for enabled timing. Split retirement definitions/inlines UNCHANGED into **x86_retire.h**, included by
   x86_lift.h/x86_lift64.h and profile.h; sampled runtime profile header no longer infects lifted dependency keys.
   No increment/emitted body/guest semantics change. Existing exact incremental-build test unchanged.

Exact post-f65d33c source/test list in6ca26a5 (for **vK31b re-review**):
- bgt/runtime/instruction-accounting.ts
- platforms/win32/w32_core.c
- platforms/x86/{x86_sched.c,x86_retire.h,x86_profile.h,x86_lift.h,x86_lift64.h}
- tests/fixtures/c/accounting-precision.c
- tests/unit/{accounting-startup,accounting-precision,guest-accounting,scheduler-accounting}.test.ts
- docs/pipeline.md schema only. Other later commits through e78e53f were documentation-only.

## Actual completed gates / failures (do not hide/relabel)

Pre-repair source f65d33c original sweep **tier1/default-off/**:
- doctor0, full lint0 (**38** example check-builds, ESLint+real GCC helper), explicit clang0, typecheck0.
- Full unit actually finished **2321 pass /2 fail /134 files**,4099.60s, original deadlines/maxWorkers1.
  FAIL incremental-build.test.ts header boundary: lifted now depended on sampled profile; FAIL sysdlls-host.test.ts
  native scheduler compile missing bgt.h include path. Both production repairs above; no tests weakened.
- No browser/leak/oracle step launched in old sweep. Parent55593 stopped/terminated as described below while
  active unit child completed; no unit.exit because parent exited before writing. Tail contains complete failed summary,
  retained unit-summary-after-parent-stop.txt. Do not fabricate exit0.

Private **review-before-tree** from clean f65d33c with new unchanged tests:
- before-prepare.exit0; **review-before.exit1**,6tests/65.61s: i386 TLS precise assertion **10->1000010us**;
  serializer shows UINT64_MAX **18446744073709552000** instead of18446744073709551615; unsafe legacy Number
  summary returns18014398509481984 not null. These3 failures ARE intended real assertions.
- AMD64 TLS control PASS. DLL2 failed **setup** (missing Windows SDK include path), NOT sensitivity evidence.
  Corrected DLL test now uses installed Zig env lib_dir/libc/include/any-windows-any. Need rerun corrected pre-fix DLL
  controls (should pass on old source), and consider collecting all8 TLS combinations before fix (initial i386 stops
  first failure; reviewer independently already ran all4 combinations). Private tree retained; no live root using it.

Initial **repair-focus.exit1**,11failed/15passed/8files176.35s is NOT valid source validation:
- Author mistake: writing w32_core.c from truncated read accidentally included read-tool truncation marker and lost
  final28 lines; compile fails. Repaired by restoring exact original tail from git; final committed diff has NO tail
  deletion. Never committed truncation. Full diff--check and commit hook pass. Logs retained honestly.
- Same DLL missing SDK setup; fixed above. One child SIGKILL in failed run, not waived performance evidence.
- repair-typecheck0 and repair-eslint0, but predate final header split/DLL SDK/tail fixes; not final certification.
- **repair2** is the corrected focused run; no result yet. Last git diff--check and precommit leakcheck13files pass.

## LIVE owned jobs at 2026-11-05 10:16:41 UTC — suites SERIAL, leave running

Disk~8.9GiB free. ps forbidden; use exit markers, kill-0 OWNED roots, lsof known logs and pgrep -P known descendants.
No shared locks/tickets/caches cleaned or generic kills. This continuation briefly displayed broad env (included
harness keys) internally; do not copy it into docs/reports. No secret file or network use.

### Root **24554** repair2-run.sh — CURRENT ACTIVE SUITE

Logs/exits at scratch root: **repair2-focus.log/.exit**, then repair2-typecheck.log/.exit then repair2-eslint.log/.exit.
At checkpoint no exit, log reached building actual startup fixture. Runs10files26+ existing incremental/sysdll tests:
accounting-startup, accounting-precision, retirement, guest-accounting, scheduler-accounting, instruction-accounting,
metrics-capacity, interpreter-import-spans, incremental-build, sysdlls-host. maxWorkers1, original test deadlines,
real JSPI. Source final6ca26a5 unchanged while running. DO NOT edit source before completion.

### Root **9794** tier1-final-run.sh — WAITING, NOT RELEASED

Waits **scratch-K31/repair-final-ready**, **ABSENT**. Do not touch marker until focused/static green and source final.
Upon release moves old tier1 -> **tier1-f65d33c** (must not exist first), creates new tier1 and captures commit/clean diff.
Full serial order:
1. default-off: doctor, full lint38examples/realGCC, explicit clang, typecheck, full units, FULL browsers Asyncify and
   JSPI (requiredWebGPU=1, both real backends+auto), leakcheck, EVERY pipeline oracle300 both modes.
2. accounting-on BGT_CPU_ACCOUNTING=1: full units, full **WebGPU-only** browser Asyncify and JSPI, EVERY oracle300
   both modes. Browser report copies and each step .start/.end/.exit/.log.
3. Runs **tier1-audit.py** into audit.log/.exit and writes tier1/done even on failures (audit result must be inspected).
Old passing gates are retained but source repair requires fresh gate matrix; none certified final6ca26a5 yet.

**tier1-audit.py** substantially expanded, py_compile0, **NOT yet run** against actual reports. Checks exact inherited
I14 skips/backend counts, every inventory, workload/errors/hash/cross-mode+ON/OFF, enabled/unavailable and string schema,
per-owner/process equality, bounded ring, actual suspension, GL scale metrics, unchanged strict production expected-error
contract. Needs audit/test when reports exist; don't infer acceptance from unexecuted script.
**tier1-oracles.mjs** unchanged enumerates34 examples x2 modes x300 per config, preserves logs/exits/reports.

### Root **24093** attribution-queue.sh — WAITING tier1/done

No attribution archive created or variant measured. Private script uses **f65d33c** original measured source, profile0
JSPI full12000-owner OFF/noop/process-only/thread-only/BOTH/sites. Timed first5,9 alternating warmed300-update samples,
semantic/API/legacy equality, native body/local/family changes; sites diagnostic only. Source-level unchanged chaining,
no quantitative attribution yet. Don't claim where19% goes until measured. See prior checkpoint for exact design.
Attribution scripts currently not typechecked/run. Updated prepare to exclude .cache/.vite/.vite-temp symlink sharing;
independent private Vite scratch. benchmark asserts replacement sites exist and diagnostic equality. Raw/save/resources,
private incomplete variants must never ship. Queue deletes private archive only on success; retain failure to diagnose.

### Finished roots / operational boundary

55593 old sweep parent was SIGSTOP'd to prevent next suite after unit; active unit left untouched; parent then TERM+CONT
exited. Actual unit npm child64486 and descendants were verified by lsof(log), still progressed and finished normally.
No child signalled. Root31799 before-run waited unit summary then private before tests; root69669 after-before-run applied
repair and focused/static; both DONE. root24554 is sole intended active heavy suite. root9794/24093 only wait.
review-before-tree retained OWNED temporary, safe delete only after collecting hashes/sensitivity controls; no live root there.

## Exact next steps for K31e

1. Poll repair2 exits/logs. Diagnose real failures; no assertions/deadlines/skip weakening. In particular real DLL test may
   need actual linker entry decoration repairs before it executes; it has not run with SDK path yet. Precision/hook/header
   repairs are implemented not validated. Keep negative setup failures separately labeled. Request vK31b only when fix
   regressions actually pass; provide exact6ca26a5 and any later code delta.
2. Corrected pre-fix controls: copy final unchanged startup test into retained review-before-tree; run serially AFTER
   repair2 done. TLS i386 must fail idle freeze; AMD64 TLS/DLL controls pass, precision must fail exactness. If per-case
   loop short-circuit matters, aggregate all combinations without weakening final assertion. Read external evidence too.
3. Update handoff/reviewer with actual focused/header unit outcome. If green/source final release **repair-final-ready**
   for new full sweep. Source changes require honest reruns; no heavy suites in parallel. Follow reviewer #275 matrix.
4. Inspect full reports (not just exits), exact inherited intentional skip inventory and both native backends, all136
   oracle results300/hash/errors/stubs/availability/ON/OFF equality. Preserve exact x64-gl-scale single expected-error
   contract (production oracle unchanged); fix auditor if schema assumptions wrong, not tests.
5. Attribution queue follows final sweep; inspect compile/setup and actual ablation/body/local/site measurements; report
   code shape versus additions honestly, residuals unknown. Default OFF unchanged. No optimization scope creep.
6. Durable gate/repair sensitivity evidence and handoff K31.md/status, list source deltas precisely for vK31b. Independent
   review FAIL remains until actual fresh re-review; no CI/acceptance claims. Clean completed OWNED large outputs after
   hashes; commit lane/K31, never push. Final<200words. End this session now per reviewer #287, no compaction.
