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
