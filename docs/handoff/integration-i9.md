# Integration I9 — three-lane checkpoint, final gates still running

## Checkpoint / scope

Branch `integration/p1`, implementation HEAD **`3f42927e97089f8bf50fb9ad2fad9f64648ded9e`**.
This handoff is a reviewer-requested cost/context checkpoint (#122), **not completed Tier 1 acceptance**.
A fresh codemode-only session must inspect the still-running jobs and finish the gates below.
Kit development only; no game files/captured shader text were copied into the repository, no original binaries
were executed, no installs, dependency changes, test weakening or pushes. Leave developer `:5173` alone.

## Ordered merges

All are `--no-ff`, in the requested order over `c2c5a27`:

1. **`db5dc46`**, K14b / **`c09faa7`**: sparse linked fragment-output write masks, approved **counted zero-tail**
   materialization of undersized bound UBO ranges (#107/#108), GPU-only continuation bounded to **64 MiB /
   1,048,576 commands per frame**, additive **0x64 BUFFER_COPY** and `glCopyBufferSubData`.
2. **`5bbe48a`**, K14a / **`fe3b72e`**: opaque sampler helper specialization, existing storage limits (#104),
   typed zero WGSL nonvoid fallthrough (#110).
3. **`f6f8028`**, K15h / **`12efec7`**, added by reviewer #120: context/checkpoint notes, memory-aware FIFO heavy
   admission, quota/reset-aware retries, stale-driver release/leases, `PI_CODEMODE`, harness fixture timeouts.

Read [K14b](K14b.md), [K14a](K14a.md), [K15h](K15h.md). K14b and K15h have their own independent lane reviews;
those are not automatically final-tree gate attribution. K14a deferred final-tree runs to this integration.

Merge conflicts were additive status sections and paired C/TS ABI inventories. The resolved tree retains
K10 slice-policy/first-entry sizes/offsets **and** K14b continuation constants/header and BUFFER_COPY checks.
Resolution was fully completed in `5bbe48a`; the first K14b merge commit itself still contained conflict markers
in those three files and must not be treated as a tested intermediate tree. Final source has no such markers.
K10/K11/K13 execution/build sources (`platforms/x86`, `tools/x86`, `tools/build`) are unchanged from `c2c5a27`;
profiling/coverage/slice host behavior remains alongside the continuation counters. K12 heap/CRT remains intact.

## Integration repairs — separate commits and before/after regressions

All new shader fixtures are original CC0, not copied capture text. Evidence root below is outside Git.

| Commit | Defect / repair | Regression and evidence |
|---|---|---|
| **`9b86642`** | Fresh I9 source reviewer found anonymous struct fields renamed as lexical locals in TS specialization; collect both anonymous and named field ranges. | Four GLSL330/ES300 × ordinary/opaque-helper unit cases fail before, pass after. Two added native pixel cases cover ordinary/helper anonymous members; direct/profile paths. `anonymous-before.log`, `anonymous-after.log` (**114/114**, 3 files), `anonymous-native.log` (**2/2**, both backends). |
| **`323f07f`** | vK14a P2 #1: C profile did not recognize function-local struct types when determining sampler shadowing, including shaders with no sampler helpers. Track bounded lexical local type visibility, inline instances and field ranges in `gs_local_shadow`. | Four ES/desktop × helper/no-helper cases fail before with opaque arithmetic; after, reflected slot remains exactly one, local declarations/accesses are consistently renamed, outer sampler works after scope exit. Added WebGL known-answer no-helper pixel case. `local-struct-before.log`; `local-struct-after.log` (**111/111**, 2 files). |
| **`730c09c`** | vK14a P2 #2: TS declaration scan missed inline named/anonymous struct instance bindings. Start declaration scan after the closing brace, retaining comma declarators and existing field protection. | Four language × named/anonymous cases fail before, pass after; retain lexical renaming and actual sampler identity. Two native direct/profile pixel cases added. `inline-struct-before.log`, `inline-struct-after.log` (**115/115**, 2 files). |
| **`3f42927`** | vK14a P2 #3: name-only reachability activated sampler-type-incompatible overloads, extra reflected resources and false unsupported cube storage. Share opaque argument/signature matching between call validation and reachability; retain native numeric overload selection. | Four unused sampler3D/cube × direct/forwarded call cases fail before (extra slot or unsupported storage). After, exactly one active uniform/slot; a two-selected-overload control still has two slots. `overload-before.log`, `overload-after.log` (**120/120**, 2 files). New browser test runs eight profile variants per backend with exact pixels. |

Reviewer-provided synthetic repros/report are private scratch inputs at `/Users/dev/projects/pi-work/inputs/vK14a/`.
No files from there were copied to Git. Latest combined focused native run on the `3f42927` implementation:
**4/4 browser tests pass**, WebGL2/WebGPU; `reviewer-fixes-native.log`. Main sampler matrix now has **160 WebGL2 /
128 WebGPU** cases, plus eight overload-reflection cases per backend. Local-struct cases intentionally remain
WebGL-only: no expansion of the pre-existing WGSL local-struct boundary.

Intermediate diagnostic failures are not hidden: the initial local-struct repair test expected the original
local spelling although correct canonical output alpha-renames it; assertions now check consistent local
declaration/access and exact reflection. An initial native overload fixture uploaded swizzle integers through
a float array; corrected to an `Int32Array` view, retaining exact expected pixels. No existing tolerances or
assertions were weakened.

## Independent validation — exact scope

Two genuinely fresh sessions were launched here without `--fork`/parent-session reuse:

- Review of **`f6f8028`**, session `01a19cb3-fd71-7322-9135-c405b17e38a0`: **one P2 finding**, the anonymous-field
  issue above; **220/220** focused existing assertions and **24/24** independent boundary assertions. Native
  WebGL reproducer confirmed rejection before the repair. `review.txt`, `reviewer/findings.md`.
- Follow-up of **`9b86642`**: **bounded PASS / no blockers**, **134/134** focused checks, **54/54** positive native
  compile/link controls and **148/148** synthetic known-answer pixels with zero channel error. Exact old repro
  now compiles/links. `recheck.txt`, `recheck/findings.md`. Reviewer states ANGLE/SwiftShader; no physical GPU claim.

Those reviews do **not** certify subsequent `323f07f..3f42927`. Reviewer #121 reports separate vK14a FAIL with
the three P2 findings and will arrange focused re-review of the repairs. **That latest re-review remains pending.**
Neither independent session is attributed with full Tier 1, WebGPU capture audit, oracle sweep or target performance.
Both review drivers have completed exit 0; they are not active workers.

## Final-tree evidence already passed

Machine-local evidence root: **`/Users/dev/projects/pi-work/scratch-I9/`**. Not a permanent retention promise.
Current acceptance runner started on implementation **`3f42927`**; no source changed afterward.

| Gate | Actual current status / evidence |
|---|---|
| doctor | **PASS**, exit 0, 0.57 s; `final/doctor.log`, `final/status.json` (Node 24.19.0, Zig 0.13.0, Chromium installed, original/ empty). |
| lint | **PASS**, exit 0, 573.13 s; `final/lint.log`. ESLint, clang example checks and real GCC `/opt/homebrew/bin/gcc-14` (14.2.0). **33 example check-builds**; default lint excludes the scale check-build (the full unit/build/oracle inventory does include scale). Clang is Apple clang 21. |
| typecheck | **PASS**, exit 0, 1.88 s; `final/typecheck.log`. |
| focused GLSL / native | **120/120** focused units and **4/4** browser tests on latest implementation as above; not substitutes for full suites. |
| scratch capture audit | **PASS on `3f42927`**, counts/details below. Repeat after any further source repair. |
| full unit | **RUNNING; no final count/PASS claim**. `final/unit.log`. Includes `pi-harness.test.ts`, bridge and robustness tests; no exclusions. |
| full browser | **NOT YET RUN in current acceptance run**; queued after units. Both backends required. |
| leakcheck | **NOT YET RUN in current acceptance run**; queued after e2e. Commit hooks passed only staged-file leakchecks, not the full gate. |
| 300-frame default/fast oracles | **NOT YET RUN in current acceptance run**; queued after leakcheck. |

### Scratch-only capture audit

`audit.mjs`, `audit.log`, `audit-results.json`, `glsl-driver`, `rejected-result.json`, `rejected.wgsl` are all
under the external evidence root, never the repository. Driver was compiled from the current original kit
`tests/native/glsl_driver.c` and used to reprocess the previously rejected raw fragment from mm7. The audit uses
the current repository translators and actual browser native stage compilers, not a recording transport.

- mm7: three `capture.json` files, **138 + 138 + 138 = 414 captured submissions**.
- mm6: two `capture.json` files, **79 + 50 = 129 captured submissions**.
- Combined: **543 captured submissions / 104 unique stage-language-source identities**, plus the reprocessed
  previously rejected fragment = **105 audited stages**.
- **105/105 WebGL2 native compiles and 105/105 WebGPU native compiles; zero errors.**
- Own Vite port **5264**, repository translator imports only. This is stage compilation, **not** captured
  pipeline linking/render certification, first draw, title screen or playability.

## Live jobs / continue without duplicating work

At this checkpoint (2026-11-02 about 22:55 local), the owned Python acceptance runner is **PID 2442**, recorded
in `final-runner.pid`; active unit process-group leader is **PID 19997** in **`final/active.json`**. PIDs are
observations, not durable identities; re-read active state/logs before any signal and never kill unrelated work.
Sandbox denies `ps`; do not loosen sandbox to inspect or run suites. **Leave the runner going across this checkpoint.**

- Runner script: **`/Users/dev/projects/pi-work/scratch-I9/run-final.py`**.
- Driver output: **`/Users/dev/projects/pi-work/scratch-I9/final-runner.log`**.
- Completed command exits/durations: **`final/status.json`**.
- Current command/PID: **`final/active.json`**; unit progress **`final/unit.log`**.
- FIFO/memory admission evidence: **`final/heavy.log`**. Default 1024 MiB floor retained; no fake memory data,
  bypass, alternate lock namespace or changed slot count. Runner prepends the **merged workspace shim** to PATH
  and invokes heavy suites via npm/npx.
- On finish: **`final/done`** (`PASS`/`FAIL` is only a summary; inspect actual logs/JSON).

It runs sequentially: doctor → lint → typecheck → `npm test -- --maxWorkers=1` →
`BGT_E2E_PORT=5263 BGT_REQUIRE_WEBGPU=1 npm run test:e2e` → leakcheck → each default pipeline CLI oracle
for 300 frames → `x64-crt`, `x64-cpp`, `x64-scale` fast-preset CLI oracles for 300 frames.
The script **continues after a failed command**; its existence/progress is not acceptance. Inspect every exit.

All **30** pipeline examples must match: `win32-conformance`, `win32-hello`, `x64-audio`, `x64-audio-init`,
`x64-basics`, `x64-contracts`, `x64-cpp`, `x64-cpprt`, `x64-crt`, `x64-gl`, `x64-gl-blit`, `x64-gl-current`,
`x64-gl-fbo`, `x64-gl-feedback`, `x64-gl-integer`, `x64-gl-ranges`, `x64-glsl`, `x64-gui`, `x64-handles`,
`x64-heap`, `x64-input`, `x64-memory`, `x64-scale`, `x64-smoke`, `x64-sysdlls`, `x64-threads`, `x64-tls`,
`x86-handles`, `x86-heap`, `x86-threads`. Expected **9,000 default + 900 fast = 9,900 compared frame pairs**,
not yet achieved. Four native examples have no fabricated interpreter oracle.

Oracle evidence: `final/oracle-<id>.log/json`, `final/oracle-fast-<id>.log/json`,
**`final/oracle-summary.json`**. Check each exit 0, identical=true, 300 pairs, null errors/divergence, lifted
`interp_insns=0` and empty stubs. Do not rely on old `reports/oracle-*.json`; scratch copies isolate this run.

**Fast-mode warning:** the runner temporarily changes each fixture `game.json` to `pipeline.liftPreset: fast`
while running its CLI oracle and restores exact original bytes in `finally`. It saves originals as
`final/<id>-game.original.json`. Do not commit during a fast run. On interruption, verify/restore only those
three tracked configs from their saved originals. The optional fast-manifest copy in the runner points to
`game.json` in built output (normally absent); if policy-manifest evidence is needed, inspect/copy the actual
`manifest.json`/pipeline metadata. It is the configured build and oracle, not that optional copy, that runs fast.

### Interrupted runs — not acceptance

- Root `doctor.log`/`lint.log` came from an initial runner started just before reviewer #120 added K15h. Parent
  was stopped; its lint child was allowed to finish. No final-tree claim from it.
- **`pre-anonymous-repair/`**, runner log `pre-anonymous-runner.log`: on `f6f8028`, doctor/lint/typecheck passed;
  unit interrupted after independent anonymous-field finding.
- **`pre-vK14a-repairs/`**, runner log `pre-vK14a-runner.log`: on `9b86642`, doctor/lint/typecheck passed; unit
  interrupted after reviewer #121 supplied the three additional P2s.
- Those two owned runner parents and recorded active process groups were stopped before source edits; no
  incomplete unit run is counted as passing. Old PID files `runner.pid`, `review-driver.pid`,
  `recheck-driver.pid` are historical, not commands to kill.

## Fresh-session finish checklist

1. Read this handoff, CLAUDE.md and current Git status/HEAD. Inspect current `final/status.json`, active command,
   runner log and suite tails **in one codemode script**; let the live owned run finish rather than duplicate it.
2. Obtain/inspect reviewer-arranged focused re-review of `323f07f`, `730c09c`, `3f42927`. Fix concrete findings
   with before/after regressions if any; any source repair invalidates unfinished/existing final-tree claims.
3. Require full **npm test including sandbox pi-harness**, full **test:e2e both backends**, leakcheck and all
   **30 defaults + three fast oracles ×300**. Record exact counts/project breakdowns and unchanged skips.
4. Capture audit already passed on current source; rerun `BGT_E2E_PORT=5264 node .../audit.mjs` if source changes
   or a final checkpoint needs it, keeping all captures/translations/results outside Git.
5. Restore fast fixture configs, check clean diffs/markers, finish `docs/v03-status.md` and replace this checkpoint
   with accurate final results/remaining boundaries. Run full leakcheck after final documentation edits.
6. Commit final docs. Final response under 150 words; do not claim engine speedup, F-PERF-CRT closure, first
   draw/title/playability, unrestricted GL3.3 or physical iPhone/Safari/Firefox verification.
