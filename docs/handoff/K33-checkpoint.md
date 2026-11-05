# K33 checkpoint — reviewer #310 (K33f)

Branch lane/K33; base dev.19 958d5f0. **WIP, NOT final Tier 1/CI PASS.**
Current source commits: b47190a, be80b3b, 2063596 (details below). No pushes.
This checkpoint was requested explicitly; end this session after committing it.
Read this section first; the K33e record below is historical and its ACTIVE jobs are no longer active.
No new CI run requested yet: candidate needs the pending local checks/mutation evidence below.

## Reviewer results received this session

- ci/k33d =40d44b7, run42067318101 FINAL: lint_js, lint_native, lint_examples,
  scale, e2e, unit_2 PASS. unit_1 CANCELLED at60minutes. Partitioned convergence failed
  at196246ms under unchanged180s deadline before cancellation; local earlier174s.
  Gate correctly FAIL. Only targeted log reads, not full CI dumps.
- Read-only logs: /Users/dev/projects/pi-work/inputs/ci/k33d-unit_1.log,
  k33d-unit_2.log, k33d-lint_examples.log. Earlier b/c superseded.
- External fresh read-only vK33 review of40d44b7 FAIL, report
  /Users/dev/projects/pi-work/inputs/vK33/REVIEW.md. Source portability/C edits and gate
  coverage were accepted structurally:71focused tests,21aggregate failure/cancel/skip mutations.
  Three compiler-transport findings required fixes; no final independent PASS.

## Decisions #307 / #309

- #307 approves EARLY ACTIONABLE REJECTION of compiler options with no file equivalent
  (e.g.140KiB -fdebug-prefix-map), never forwarding them to E2BIG, provided all kit build
  plans plus a port-sized plan pass. Must regress every vK33 reproducer. Move all macros
  once conservative postquote GCC option budget requires it; strip only the transport
  header prerequisite, retain original semantic flags in keys; preserve macro tokenization.
- #309 approves internal validated buildGame asyncifyPartitionBytes, included in cache
  identity, to avoid whole-module Asyncify before manual forced partitioning. All test
  assertions/workload/180s deadline stay. No new CI job or deadline approved here.
- Existing #289 job fan-out, #295 exact shard+scale inventory, #298 GCC scope A remain.

## New committed repairs / remaining proof

**b47190a — compiler descendant transport, dependency cleanup, macro tokenization.**
- vK33 P1 descendant env: old262KiB activation missed6000short definitions (~142KiB argv)
  whose COLLECT_GCC_OPTIONS alone exceeded128KiB. New conservative postquote option-size
  limit64KiB activates transport early; all -D/-U move off driver argv into anonymous macro
  file (first -imacros, so macros precede user-imacros/forced includes). Residual untransportable
  options fail before compiler exec. Input object paths are not falsely counted as options.
- Explicit GNU response expansion (quote/backslash/nested cwd grammar) checks compiler
  @file contents too. Otherwise response files reintroduce cc1/env E2BIG. Driver response
  construction and immediate portable128KiB/string+1MiB aggregate checks remain.
- vK33 P1 depfiles: strip exactly transport fd prerequisite/phony target from -MF file,
  default depfile, or -M/-MM stdout before descriptor closes. Real header dependencies stay;
  original flags remain cache semantic inputs. No parent /dev/fd hashing.
- vK33 P2: newline tail truncated like command-line -D; all -U/-D preserve relative order.
  Terminal backslash guarded by trailing comment to prevent phase-two source splice.
  Unsupported macro spellings, unterminated comments/trigraphs fail closed.
- New tests/unit/compiler-transport.test.ts: real GCC -wrapper enforces argv+env budgets
  and EXECUTES real cc1/as/collect2 (not success stub),6000direct and response definitions,
  clang/GCC trailing slash/newline/-imacros order, huge newline definition, residual debug
  flag direct/response rejection, real prepareObjects14000definitions stable cache hit and
  real-header invalidation, -M/-MP sanitation, all38example flags plus4096-object/6000macro plan.
- Review reproducer failures are documented independently in vK33. **New committed tests
  have NOT yet been run against old source**; do isolated-copy mutation before final claim.

**be80b3b — avoid redundant whole Asyncify in convergence.**
- validated1024..16MiB/null internal option passes existing --bgt-partition-bytes CLI and
  participates in Asyncify key. Regression covers key distinction for65536/131072/default.
- Partitioned coverage variant now builds forced partition output directly. First successful
  build additionally transforms the same raw module independently and asserts >1partitions
  AND byte-identical builder output. Subsequent builds do not first do useless whole pass.
  All prior convergence assertions, workload, selections, modes and180s deadline unchanged.
- **New heavy convergence path has NOT yet been run locally or on CI.** Need all4variants.
  Check for any semantic mismatch from native removelist (first interpreted build has none).

**2063596 — setup-aware measured CI shards.**
- ci/k33d shard1 had31.5min GLOBAL SETUP vs shard2~8min, despite balancing test-only weights.
  Update test weights from final d logs, retain older weights where d cut before reporting.
  Add per-example cold build costs. Deterministic LPT now includes unique declared prebuilds
  per shard, penalizing new expensive prebuild duplication2x for placement (actual cost once).
- Current133 CI files ->64+69, plus unchanged required scale file. Measured estimate
  ~50.9min/shard incl setup (before expected convergence saving), vs unit1 previously>60min.
  Same Vitest globs and fail-closed union preserved. No exclusions/coverage/deadline change.
- Fixture now copies test-examples/toolchain/.zig-version and actual synthetic files.
  Added expensive-shared-prebuild co-location regression; prior deterministic/drift tests stay.

## Local evidence this session — do not label final green

- doctor/typecheck/native/eslint/negative evidence from K33e remains as historical below.
- typecheck ran after initial repair edits and passed; rerun final typecheck/lint after commits.
- fix-focused2:12/12 in3files, exit0,6.65s (intermediate repair; no later response-file changes).
- fix-focused3:26pass/1fail in4files, exit1,28.67s. Only failure: new GCC -M/-MP dependency
  probe timed out under its8000ms subprocess bound (status null). No semantic assertion failed.
  Focused transport, shard and cache-key tests passed at this revision.
- compiler-review-after-final:7pass/1fail, exit1,16.27s; same8000ms GCC deps timeout.
- compiler-after2:8/8, exit0,9.19s, BUT temporarily used30000ms subprocess bound. It was
  restored to8000ms BEFORE b47190a because no deadline change approved. **Not green evidence
  for committed8000ms timeout.** Need localize real GCC -M/-MP stall vs loaded subprocess.
  Clang standalone dep-probe.py completed0.2s. Do not silently raise any deadline.
- The earlier full units-dual-final completed1failed/132passed files,2344passed/1failed,
  5674.16s. Single fail is newly edited cache-key assertion for asyncifyPartitionBytes while
  full run had already loaded old build.mjs. This was a MIXED SOURCE run, not clean final
  evidence. All old tests including corrected dual SEH passed. Preserve raw log unchanged.
- No full e2e/oracles/final lint ran in K33f; queues were paused to avoid wasted gates while
  fixes changed Asyncify identity. All34x2x300 remain required, not inherited as green.
- Ignored audit helper reports/k33/audit-final.mjs exists; its source field40d44b7 is stale,
  update before final use. It audits markers,351browser cases,300pass51skips per mode,
  oracle300/hash/stub checks. No reports have been fabricated.

## Detached jobs / space at checkpoint2026-11-05T18:22Z

**NO K33 suite intentionally left running.**
- Queue root38125 was paused (root only) while units continued; full unit child finished,
  but paused shell never wrote units-dual-final.exit. Do not invent marker; raw summary above.
- After completion, killed owned idle roots38125,95763(waiting tail lint),90532(space watcher).
  Their old pid files remain historical; DO NOT signal these PIDs again without verifying.
- Pending before-regression watcher42362 was terminated before it started testing.
- Focused roots56520,69736,38789,49936 completed. npm timed-out attempt had empty
  compiler-after.log; no surviving K33 suite seen via pgrep -fl. No after2 runner remains.
- pgrep also found63370/63383/63384 npm unit invocation with PI_LANE=I15: **another lane**,
  leave it alone. ps is sandbox denied; pgrep -fl works. Never blanket-kill npm/node.
- Disk~8.9GiB available. Old caches/products still retained; no active K33 build. Clean ONLY
  completed-owned temps if needed, not shared payloads/lock inodes/other lanes. Stop on ENOSPC.
- Local focused suites accidentally overlapped tail of full units during this continuation;
  next session must restore serial background scheduling. No perf claim from these runs.

## Exact next steps

1. Read current source and this checkpoint; do NOT resume obsolete queue scripts blindly.
2. Audit/fix the new compiler test's GCC -M/-MP8000ms timeout without deadline changes;
   inspect descriptor reuse/lifetime and real compiler execution, not only shared load.
   Run all compiler/transport/cache/host/shard tests at clean committed source serially in
   background. No source edits during active suites (mixed full run is explicitly discarded).
3. Run new regressions against an isolated OLD helper tree40d44b7, no production mutation;
   prove all three vK33 defects fail and restored implementation passes. No success stubs.
   Review response grammar/depfile/capture_output edges and forced-macro order critically.
4. Run all four convergence cases including actual JSPI, unchanged180s. Confirm partition
   output equivalence assertion and cache-key regression; optimize actual work if needed.
5. Final ESLint/typecheck/doctor/native clang+realGCC; new source full units clean. Then full
   both-mode required WebGL2/WebGPU/auto browsers and all34x2x300oracles, final lint/leakcheck.
   Use BGT_E2E_PORT=5278, BGT_JSPI=1+BGT_TEST_JSPI=1 for dual units, background serial queue.
6. Ask reviewer for vK33b re-review against b47190a/be80b3b/2063596 (latest source2063596)
   after focused repairs are stable; include docs commits separately. Ask reviewer to push
   next ci/k33* candidate, never push locally. No new CI-ready claim yet; deadline/job changes
   still require ask_reviewer. Iterate until required gate passes and external review accepts.
7. Replace interim K33.md with final audited evidence only after all gates pass. Preserve GCC
   scope A and37guest-source follow-ups there. Commit docs and finish final reply<200words.

---

# Historical K33e checkpoint (superseded active-job state)

# K33 checkpoint — reviewer #304 (K33e)

Branch `lane/K33`, base dev.19 `958d5f0`. **WIP, not final Tier 1/CI PASS.**
Read this first, then `K33.md` and the original brief. No game files, installs/web access, pushes,
test deadline changes or weakened assertions. Reviewer pushes CI branches. All local suites serial,
background, `BGT_E2E_PORT=5278`. Finish without compaction; this checkpoint was explicitly requested.

## Source commits and CI

- `ccbd838` initial portable transport/GCC checkpoint.
- `9dba9cb` initial portable argv and approved CI fan-out: reviewer pushed `ci/k33a`, run42039181319.
  Scale **PASS** (first since dev.8), e2e/native lint/example lint PASS. JS lint failed doctor (Chromium
  absent); unit1 failed compiler cc1 E2BIG and copied-tree command.py omission; unit2 canceled at60min.
- `4a00dce` closes lift transport, adds checked real Vitest shard inventory, fixes copied-tree fixture,
  installs Chromium in blocking doctor job.
- `ff329d6` compiler macros move into forced header (GCC expands response files before cc1), plus
  measured-duration LPT shards. `ci/k33b` run42062351670; reviewer last reports native lint PASS,
  JS lint FAIL; complete result not received.
- `313bc7d` redundant initialization cleanup, `ci/k33c` run42064436673; result pending.
- **`40d44b7`** current source candidate, `ci/k33d` **run42067318101 is running**. Fixes local ESLint's
  useless quote escapes (likely k33b/c JS-lint failure), bare -DNAME must mean1, anonymous/rewound macro fd,
  tests real installed GCC as well as Apple clang, budget rejection regression, and fail-closed CI inventory
  discovery (process substitution had swallowed Node failures). New shard tests cover deterministic exact
  union and workflow exit handling on inventory drift. No tests omitted or deadlines altered.
- Docs-only `8ea8920`, `14d9efa` precede this checkpoint commit.

## Mechanism and decisions

`exec.mjs` passes argv JSON over anonymous fd3 to writer.py, independently of finite regular-file stdin.
`command.py` bounds every supervised Python spawn (131072bytes/string including NUL, <=1MiB aggregate
with pointer allowance); large Node .mjs argv reconstructs only after spawn via node-args.mjs. Compiler
plans use GNU response files plus forced headers for large macro sets. Writer/compile/lift share it.
Asyncify retains the complete native removelist; partitions translate all symbols. Owner/override lists
use --select/--skip-file. Transport implementations participate in Asyncify cache identity.
Existing lock inheritance, supervision groups, cleanup, deadlines and cache recovery remain tested.

Decision #289 approves separate lint_js/lint_native/lint_examples, two unit shards, e2e, unchanged scale,
and required aggregate rejecting failure OR skip. #295: same Vitest inventory as npm test; shard union
plus scale's build-chunks.test.ts must equal full set. Shards now use observed Linux duration, not counts.
Lint's30min is serial cold pipeline Zig+Asyncify work (not clang+gcc): no transform coverage dropped.

**Decision #298 scope A:** GCC acceptance is every *actual GCC compilation in CI*. Do not broaden into
x87/core/kernel guest-only sources owned by other lanes; GCC cannot build target-only wasm/WASI/Windows
code as host code. K33.md records37 unique remaining misleading-indentation locations (duplicate widths
and two fixed x64 sites excluded), plus other target-boundary diagnostics. Real installed GCC14 was used;
unversioned macOS gcc is Apple clang. Actual native GL adapter, heap widths, GLSL and x86tool checks pass.

## Completed local evidence (do NOT repeat these blindly)

Ignored `reports/k33/`:

| Gate | Evidence/result |
|---|---|
| non-JSPI new weighted shard1 | `unit1-local` **66files/836tests**, exit0,2198.8s incl setup |
| final focused transport/cache/host | `focused-portable-final` **24/24**, exit0,11.83s; real GCC large macros included |
| corrected dual native SEH | `seh-dual-final` **2/2**, exit0,69.47s; BGT_JSPI=1+BGT_TEST_JSPI=1 |
| doctor/typecheck/clang native | `doctor-final/typecheck-final/clang-host-final` all exit0 |
| post-fix full ESLint | `eslint-repair` exit0 |
| synthetic staged-original negative | `leakcheck-negative-temp` wrapper exit0; real CLI exit1 with both original-path/EXE rejection |

Earlier `units-jspi-final` **2339pass/2fail/132files**, exit1: only native-seh failed because old run set
BGT_TEST_JSPI without BGT_JSPI to generate artifacts. Focused corrected SEH passes; not relabeled green.
Initial `lint-final` exit1 at two quote-escape ESLint errors; native/example checks never ran there.
Fixed40d44b7 + explicit ESLint pass. Post-queue full lint below completes the missing gate.

Clone `original/` is sandbox read-only. An attempted synthetic canary write was denied before a file
existed (`leakcheck-negative-final` exit128 retained). No permissions changed. Successful negative uses
real `leakcheck.mjs --root <temporary-git-repo> --staged`; temporary repo removed. CI keeps its original
in-checkout negative control unchanged. No real game material accessed.

## ACTIVE detached roots — leave them running, verify before signalling

At checkpoint2026-11-06 00:11+07:

1. **38125**: `bash reports/k33/queue-final.sh`. It is **RUNNING/resumed**, not paused now.
   Earlier SIGSTOP affected only the queue Bash root, not its unit child; that maintenance pause is removed.
   Current full dual units started23:40:39; log `reports/k33/units-dual-final.log` is still producing
   native codegen probes. No final summary/exit marker yet. Command: `BGT_JSPI=1 BGT_TEST_JSPI=1 npm test -- --maxWorkers=1`.
   On return queue writes `units-dual-final.exit`, then serially runs full required-WebGPU/WebGL2/auto
   browsers, Asyncify and JSPI, plus every pipeline oracle at exactly300frames in both modes; final leakcheck.
   Stage log `queue-final.progress`, driver `queue-final-driver.log`; terminal `queue-final.done`.
   Per-stage files `<name>.log/.exit`; browser JSON copied to `e2e-<mode>-final-results.json`;
   oracle JSON copied to `oracle-<example>-<mode>-final.json`. npm script forces browser prefix e2e;
   copied JSON is authoritative archive, original artifact dirs are `reports/e2e-*`.
2. **95763**: `bash reports/k33/queue-after-final.sh`. WAITING for `queue-final.done`, so no concurrent
   heavy suite. Then runs repaired full `npm run lint` to `lint-repaired-final.log/.exit` and final
   leakcheck to `leakcheck-closeout-final.log/.exit`; terminal `queue-after-final.done`.
3. **90532**: low-cost `python3 -I reports/k33/watch-space.py`. Watches final logs for ENOSPC;
   if hit, stops queue group38125 and writes `queue-final.enospc`. Stops naturally at `queue-final.done`.

Do not start another suite while these are active. `.done` is completion, not aggregate success: audit
**each exit marker**, unit summary, browser unexpected/flaky/skips, and oracle completeness/state+trace hashes.
Queue deliberately preserves failures and continues other evidence unless ENOSPC/focused prerequisite fails.

## Disk / cleanup

Reviewer #302 says one heavy build at a time, reclaim unused trees between builds, stop/report on ENOSPC.
Free space recovered from3–4GiB to **~10GiB** through shared-machine cleanup; no K33 active caches deleted.
This lane's scratch is1.2GiB, mostly `/Users/dev/projects/pi-work/scratch-K33/zig-cache/local/o` (~1.1GiB).
BGT cache~1.4GiB; caches/outputs are currently live or reused by remaining gates, so do not delete them mid-build.
After queues complete, remove stale lane-owned temp trees/Zig entries and retain raw evidence. Do not touch
other sessions, cache lock inodes or source inputs. On ENOSPC stop and report immediately, never retry blindly.

## Exact next steps

1. Read `queue-final.progress`, both .done/.exit sets, latest units tail and disk. **Do not restart active work.**
2. Collect reviewer result for ci/k33d40d44b7 (and older b/c diagnostics). Grep new read-only CI logs;
   no full log dumps. Fix only owned failures; ask before changing deadlines, job structure or coverage.
3. Audit full local units (all tests/no skips), full browsers (both native backends and suspension modes),
   and all34pipeline examples ×2modes ×300frame oracles. Exact expected scale-only GL error contract remains.
   Every oracle requires300compared, identical state+semantic trace hashes, null errors/stages/divergence,
   lifted interpretation0/stubs0. Preserve older failed evidence.
4. Audit final lint includes all38example checks plus real GCC, explicit clang already green; leakcheck
   final and negative. New shard regression is scheduled by the active full units (file created before start).
5. Repair any actual failure with sensitive regressions, commit, ask reviewer to push next CI candidate;
   never push locally. Obtain fresh independent validation or explicitly report unavailable; none ran here.
6. Replace interim K33.md with final audited evidence/commit list only after all gates/CI pass. Commit docs,
   cleanup completed-owned artifacts, final reply under200words. No completion claim now.
