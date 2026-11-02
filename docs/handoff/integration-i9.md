# Integration I9 — final three-lane acceptance

## Final / scope

Branch `integration/p1`, final implementation **`3f42927e97089f8bf50fb9ad2fad9f64648ded9e`**;
`ada103d` and this finalization are documentation-only. **Tier 1 gates completed on the final source**,
including the reviewer’s successful extended-timeout fast-scale oracle rerun described below.
Kit development only; no game files/captured shader text were copied into the repository, no original binaries
were executed, no installs, dependency changes, test weakening or pushes. Developer `:5173` was left alone.

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

Those two sessions do **not** certify subsequent `323f07f..3f42927` or the full Tier 1 matrix.
Final independent lane review outcomes, supplied by the coordinating reviewer:

- **vK14b PASS** on `c09faa7`.
- **vK14a FAIL → fixes → vK14a2 PASS** on final implementation `3f42927`, including
  **105/105 captured stages per backend**. The three P2 findings are repaired as recorded above.
- **K15h’s own independent review: no blockers.**

These are independent review results, not reviews performed by this documentation-finalization session.
No physical GPU, target-performance or game-playability certification is implied.

## Final-tree gate results

Machine-local evidence root: **`/Users/dev/projects/pi-work/scratch-I9/`**. Not a permanent retention promise.
The acceptance runner used implementation **`3f42927`**; no source changed afterward.
**39 steps: 38 exit 0, one timeout exit 1** (`oracle-fast-x64-scale`); the same-tree reviewer rerun passed.
The original runner failure remains recorded, not relabeled as an exit-0 run.

| Gate | Final result / evidence |
|---|---|
| doctor | **PASS**, exit 0, 0.57 s; `final/doctor.log` (Node 24.19.0, Zig 0.13.0, Chromium installed, original/ empty). |
| lint | **PASS**, exit 0, 573.13 s; `final/lint.log`. ESLint, Apple clang 21 and real GCC `/opt/homebrew/bin/gcc-14` (14.2.0). **33 example check-builds**; default lint excludes the scale check-build (the full unit/build/oracle inventory includes scale). |
| typecheck | **PASS**, exit 0, 1.88 s; `final/typecheck.log`. |
| full unit | **1,183/1,183 tests, 86/86 files PASS**, exit 0, 1,531.39 s; `final/unit.log`. Includes sandbox pi-harness, bridge and robustness tests; no exclusions. |
| full browser | **245 passed / 51 unchanged intentional skips**, exit 0, 301.48 s; `final/e2e.log`. WebGL2 **110/24**, WebGPU **127/26**, auto **8/1** (pass/skip). Both required backends exercised. |
| leakcheck | **PASS, 646 committable files**, exit 0; `final/leakcheck.log`. Full `npm run leakcheck` also rerun after final documentation edits. |
| default oracles | **30 × 300 = 9,000 identical frame pairs**, exit 0 for every fixture; `final/oracle-<id>.log/json`. Null errors/divergence, zero lifted interpreted instructions, empty stubs. |
| fast oracles | **3 × 300 = 900 identical frame pairs**, CRT/C++ exit 0 in runner; scale passed reviewer rerun with `--testTimeout 3600000`. Original 600 s cold-build timeout retained below. **9,900 total compared frame pairs** including rerun. |
| focused GLSL / native | **120/120** focused units and **4/4** browser tests on final implementation; additional evidence, not substitutes for full suites. |
| scratch capture audit | **105/105 WebGL2 and 105/105 WebGPU native stage compiles**, zero errors on `3f42927`; exact scope below. |

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

## Completed runner / oracle evidence

- Runner: `/Users/dev/projects/pi-work/scratch-I9/run-final.py`.
- All 39 exits/durations: `final-runner.log` and `final/status.json`; suite evidence: `final/*.log`.
- `final/done` records the original runner **FAIL** because of the fast-scale timeout, not the later rerun.
  Old PID/active files are historical, not live-job instructions.
- FIFO/memory admission: `final/heavy.log`. Default 1024 MiB floor retained; no fake memory data,
  bypass, alternate lock namespace or changed slot count. Runner used the merged workspace shim via npm/npx.
- Commands: doctor → lint → typecheck → `npm test -- --maxWorkers=1` →
  `BGT_E2E_PORT=5263 BGT_REQUIRE_WEBGPU=1 npm run test:e2e` → leakcheck → 30 default CLI oracles →
  three fast CLI oracles, each requesting 300 frames.

All **30 default** pipeline examples match: `win32-conformance`, `win32-hello`, `x64-audio`,
`x64-audio-init`, `x64-basics`, `x64-contracts`, `x64-cpp`, `x64-cpprt`, `x64-crt`, `x64-gl`,
`x64-gl-blit`, `x64-gl-current`, `x64-gl-fbo`, `x64-gl-feedback`, `x64-gl-integer`, `x64-gl-ranges`,
`x64-glsl`, `x64-gui`, `x64-handles`, `x64-heap`, `x64-input`, `x64-memory`, `x64-scale`,
`x64-smoke`, `x64-sysdlls`, `x64-threads`, `x64-tls`, `x86-handles`, `x86-heap`, `x86-threads`.
Fast fixtures are `x64-crt`, `x64-cpp` and `x64-scale`. Four native examples have no fabricated interpreter oracle.

The **32 successful runner oracle reports** independently verify **9,600 frame pairs**, `identical=true`,
300 pairs each, null errors/divergence, lifted `interp_insns=0` and empty stubs. Evidence:
`final/oracle-<id>.log/json`, `final/oracle-fast-<id>.log/json`, `final/oracle-summary.json`.
These scratch reports preserve the original fast-scale failure rather than incorporating the later rerun.

### Fast-scale timeout and successful reviewer rerun

`oracle-fast-x64-scale` hit Vitest’s **600,000 ms (600 s)** test timeout during a cold build of the
**1,609,529-instruction** scale fixture; the runner step exited 1 after 947.70 s, before comparing any frames.
This was a test-budget/build issue, not an observed frame divergence. The coordinating reviewer reran the test
on the same tree with **`--testTimeout 3600000`** and reports **300/300 identical frames, errors null**.
The rerun log shows **1/1 test PASS** and a cached fast build; it is not a cold-build timing claim.
Rerun log (outside Git):
`/private/tmp/claude-501/-Users-dev-projects-game-cask/0bae9a29-a345-4e40-af8e-dce4c0597b6a/scratchpad/oracle-fast-scale.log`.
Together: **9,000 default + 900 fast = 9,900 identical compared frame pairs**.

Fast fixture `game.json` files were restored byte-for-byte against `final/<id>-game.original.json` for
CRT/C++/scale; no preset/config changes are part of this documentation finalization.

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

## Backlog / remaining boundaries

- **Oracle cold-build timeout (test infrastructure):** allow cold builds of large fixtures in the oracle test
  timeout budget (or separate build and frame-comparison budgets). The 600 s default rejected fast-scale’s cold
  build; a 3,600 s reviewer override passed. Follow-up must verify the cold 1.6M-instruction fixture and retain
  strict frame/error assertions. No timeout or code changes are made in this documentation-only finalization.
- Final acceptance is bounded to these kit gates and independent review scopes. No engine speedup,
  F-PERF-CRT closure, first draw/title/playability, unrestricted GL3.3, physical iPhone, Safari or Firefox
  verification is claimed. Capture-stage compilation is not pipeline linking/render certification.
