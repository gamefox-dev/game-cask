# Historical K32b checkpoint — superseded

The live jobs below subsequently completed. Final implementation Tier1 green, external focused vK32
PASS at6297545, accepted test-only SEH delta54c40eb: see [final handoff](K32.md). Large measurement
archives were moved to scratch by coordinator request; [compact summary](K32-measurements.json)
retains paths/hashes. This checkpoint records the earlier pending state, not current acceptance.

Reviewer #283 directed checkpoint/end; **leave detached Tier1 jobs running**. Branch lane/K32, source
**6297545** over dev.18 **211daca**; following checkpoint commit is DOCS/EVIDENCE ONLY. External fresh
read-only **vK32 is running at6297545**. No production/test/benchmark code change after that revision.
No compaction/push/game input/web/install. Fresh session reads this FIRST, then original brief.
Detailed implementation, safety, final paired timing and mutation boundaries: [K32.md](K32.md).

## Live owned jobs (do NOT restart suites)

Scratch **/Users/dev/projects/pi-work/scratch-K32/work** (D). Root **33968**, detached bash,
launcher **D/follow-b.sh**, log **D/follow-b.log**. Its live serial child **36237** runs **D/tier.sh**.
Verified with libproc at checkpoint:33968→36237→54507(e2e shell)→64218(lockf)→64219(Node npm)→64252→64253→64292,
Python9655 descendant. PIDs are observations, not identity/permission to signal later reused processes.
No signals needed; leave them running. All benchmark/mutation/base roots have completed. The owned
baseline worktree was removed normally; **val-K32 belongs to external review, never touch it**.

Each gate writes **D/NAME.log**, **D/NAME.start**, **D/NAME.exit**, **D/NAME.end**. Completion sentinel
**D/tier.complete**. Runner continues after failures; sentinel is NOT proof of green. Exact pending order:

1. **e2e-asyncify** currently running (npm build:examples then all Playwright projects).
2. **oracle-asyncify-<id>**, all34 pipeline fixtures,300 updates each.
3. **e2e-jspi**, actual JSPI; then **oracle-jspi-<id>** all34×300.
4. **scale-check** explicit omitted-by-default scale check-build.
5. **counted-final-jspi** (current source, stats opt-in,100000 iterations,300-update oracles).
6. **leak-final**, **diff-final**, sentinel.

Mode browser snapshots: **D/e2e-asyncify.json**, **D/e2e-jspi.json** copied from reports/e2e-results.json.
Raw browser artifacts remain reports/e2e-artifacts; HTML copies removed only after snapshot. Oracle reports
copied as **D/oracle-MODE-ID.json**, logs/exits same stem. Default generated reports are overwritten by later
mode, so use the per-mode copies. Runner environment BGT_BUILD_JOBS2, BGT_E2E_PORT5277, BGT_TEST_JSPI1,
BGT_SUSPENSION_BUILDdual, BGT_REQUIRE_WEBGPU1, BGT_E2E_SUSPENSION actual per-mode, BGT_CI_LIGHT unset.
No skip/assertion/deadline changes. Suites serial/background. Disk **6.6GiB free** at16:41 local;
watch it, clean only OWN finished temporary outputs, never active shared caches/reviewer worktree.

## Gates actually completed on6297545 source

All exit0: **doctor-final**, **lint-clang** (CCclang,37 default example check-builds), **host-clang**
explicit checkHostGcc(clang), **lint-gcc** (CC/opt/homebrew/bin/gcc-14,37 default check-builds), **types-final**.
Scale omitted by existing check policy, not waived; queued explicit scale-check above.
**units-final** exit0: **2335 tests /131 files /0 skips**, original deadlines,2546.45s; includes scale/chunks,
four-mode coverage convergence, exact runtime/SEH/import/suspension tests. No light exclusions.
**focused-final3** exit0:34 tests, real Asyncify+JSPI, separate object files with exact linked-name N removelist.
No browser/all-fixture oracle/leak/final external acceptance claim yet. Do not routinely repeat green gates.

## Reviewer decisions (actual IDs; avoid earlier draft misnumbering)

- **#266** bounded non-suspending N calls, cap32, guarded exact continuation/RSP/outer-stop/pending checks;
  same-owner region loops and exact-PC indirect sites; unwind before suspendable/generic work; measure pieces.
- **#268** weak cross-chunk N declarations need nonnull AND registry equality; absent selection/override/
  cross-chunk actual counts/both-mode/cache freshness regressions; benchmark-only internal globals permitted;
  recursion may not regress, fix or gate.
- **#270** original checkpoint directive. Its alleged region60 baseline60.34ns was a transcription/unit error;
  retained raw value **6034.250ns** vs76.733ns at5000iterations. Verified, not waived. New longer numbers below.
- **#271** separate general decoder fix for REX.B opcode90 (41 90/49 90/66 41 90); independent expected-value
  interpreter+lifted tests,48 90 andF3 90 remain no-op; full CPU/RAM oracle identical. Implemented and mutated.
- **#272** stats compile-time opt-in, default off; prove all counters untouched default and counting opted-in;
  time uninstrumented and count separately. Both configs build/oracle; further recursion regression must gate.
- **#274** no quiet slot available (other lanes active). At least five same-process interleaved A/B pairs per
  fixture in both modes; report medians/spread/load. Count a regression only beyond paired spread. Quiet I15
  integration rerun remains external. Self-recursive body flat gating approved.
- **#276** coordinator started fresh vK32 at6297545. Precisely list subsequent code deltas (currently NONE).
No additional design decision #277 was delivered to this lane. **#283** current checkpoint/end directive.

## K32b code changes (all in6297545)

Cross-chunk tests compile genuinely separate translation units, prove direct calls/resumes, weak missing
selection fallback and registry-only override exclusion in actual Asyncify+JSPI. Cache freshness tests vary
selection/skip/chunk budget. Generated call chains unwind before real callback/suspension/nonlocal transfers;
full CPU/RAM matches interpretation, service executes once and observes zero native frames. Warm strict-site,
NX AFTER a warm cache, force-interpreter, registry replacement/null, patched live qword tables/high target faults.

Stats default-off macro removes hot increments; CC0 snapshots/count runs alone enable it. Default counters
stay byte-for-byte0, opt-in counts. Tiny one-region N wrappers omit owner-loop checks. Direct self-recursive
owners, calls into them, and their new owner-exit path stay entirely flat; mutual recursion cap32 retained.
Conservative qword-table analysis now refuses implicit/multi-destination clobbers. Test exposed pre-existing
49 90 decoded NOP; general REX.B accumulator XCHG correction added under#271, with32/64/16/no-op controls.

## Final matched A/B (uninstrumented,100000 iterations, shared machine)

Five alternating A/B pairs + discarded warmup pair, fresh instances, same process,300 updates. Load and all
samples retained **D/paired.json** and [compact K32-measurements.json](K32-measurements.json). Prepared baseline/
current300-update lifted/interpreted state+semantic hashes equal; no errors/interp/stubs/drops. Not quiet
machine/game/isolated-wasm-call measurements. Delta=median of paired differences; range=min..max delta.

| Mode | Pattern | Before ns | After ns | Paired delta ns | Delta range ns |
|---|---|---:|---:|---:|---:|
| Asyncify |direct|36.06|26.52|-10.23|-10.56..-7.33|
| Asyncify |deep|34.91|35.58|+0.82|-0.55..+3.57|
| Asyncify |indirect|48.34|43.53|-0.21|-42.40..+19.72|
| Asyncify |tail|56.59|44.96|-11.63|-30.56..-5.95|
| Asyncify |regions(iteration)|6452.09|44.68|-6416.81|-6725.50..-6301.32|
| JSPI |direct|33.23|26.81|-6.56|-6.74..-6.12|
| JSPI |deep|33.75|33.58|+0.10|-1.84..+0.23|
| JSPI |indirect|29.84|29.97|-0.82|-1.12..+0.62|
| JSPI |tail|50.90|38.95|-11.95|-20.51..-2.90|
| JSPI |regions(iteration)|5426.03|54.67|-5380.10|-6307.78..-5094.04|

Consistent direct/tail/region gains. Deep/indirect within paired spread: **NO speedup claim**, no supported
regression beyond spread per#274. Older batch comparisons had real/noisy deep regressions; retained, not hidden.
Region gain largely eliminates generic/interior resumptions, not isolated loop-only saving.

Separate **counted** baseline actual driver steps→final Asyncify counts (do not time instrumented as production):

| Pattern | Before driver steps | After | Fast | Local resumes | Region chains |
|---|---:|---:|---:|---:|---:|
|direct|3200006|19|1600001|1599986|0|
|deep|19200028|19200027|1|0|0|
|indirect|200006|4|100001|100001|0|
|tail|300006|4|200001|100001|0|
|regions|11700004|27|1|0|299977|

Table patterns99996hits/4misses. These are native step driver counts, NOT newly measured total dispatcher
exits. Existing reason5/6 census separately retained; original CALL/RET doesn't necessarily emit census.
Baseline-only diagnostic patch incremented driver_steps (no fast mechanism), recorded counted-before files.
Missing original counters remain null, not0. Final counted JSPI current-source run queued, update table after it.

Piece experiments no-direct/no-cache/no-region-loop/no-block-entries/all16-sync each both modes, identical
300-update oracle hashes, raw samples/resources retained in evidence. They precede final recursive-target gating;
not pristine isolated latency proofs. Native block entries dominate region gain; loop-only benefit smaller.
All16 spill/reload regresses call-heavy cases. Remaining sync cost stays included in ns/call; not physically
isolated. K32.md labels these limits and rejected experiments; no later register-promotion performance claim.

## Mutations and retained failures

**D/mutations4.exit0**, final **D/mutations.json** seven behavioural failures, original sources restored:
registry equality(oldbody), warm strict(hit accepts forbidden code), direct-disabled(count0), capremoved(peak201),
high-call operand truncated(full fault snapshot mismatch), REX.B decode reverted(known values fail), implicit
clobber guard removed(false table resolution). Compile-only initial registry mutant corrected; all seven final
fail on assertions. Initial full-width selector ambiguous and didn't run, corrected. Logs D/mutation-NAME.log.
Old pieces runner initially failed header redefinition (diagnostic typedef outside guard), corrected and second
run succeeds. Wrong-mode/short-noisy first-session samples remain in scratch-K32/work/K32-a-measurements.raw.json
(original K32-measurements.json) and checkpoint history.

## Fresh-session remaining work

1. Read this + K32.md + original brief. **Do not launch new suites while33968/36237 runs**. Inspect fresh exit
   markers/logs; wait for serial browser/oracle/scale/count/leak completion. Resolve real failures without
   weakening gates. Preserve skip/failure inventory. Every oracle exactly300, same-state/semantic hashes,
   lifted interp0/stubs0, exact existing scale-only expected-error contract.
2. Audit both renderer backends/actual suspension modes, all68 oracle reports and cross-mode hashes. Verify
   measured interpreter times fit host update budgets if retaining I14 certificate expectations. Coverage
   convergence is in full units; extract exact pass evidence, don't invent event equality from trace equality.
3. Collect final counted JSPI stats, update evidence/table. **D/evidence.py** regenerates compact measurements
   (currently reads counted-final Asyncify only; add counted-final-jspi). Preserve all logs/samples; no quiet
   claim. Quiet I15 rerun belongs coordinator. Finish documenting synchronization/isolated-piece limits honestly.
4. Obtain vK32 external review result via coordinator and repair findings, with precise code delta after6297545.
   No in-lane independent claim. Current external reviewer worktree is not ours to delete.
5. Final structured gate audit, leakcheck after docs, update docs/pipeline.md/status only with earned acceptance,
   finish docs/handoff/K32.md (currently WIP), commit on lane/K32, never push; final under200words.
6. Cleanup only OWN finished temp outputs. Root tier remains detached across this session end by instruction.
