# Integration I12 — K21 + K22

**Final: merged-tree gates complete**, with explicitly approved combined JSPI browser recovery below.
Branch `integration/p1`, base dev.14 `4bcc068`.
No push, game inputs, installs or test weakening. Asyncify remains default.

## Merge and integration decisions

1. `0fdc7c3`: `--no-ff lane/K21` (`3a8b1bb`).
2. `3be7551`: `--no-ff lane/K22` (`599c059`). Only textual conflict was `docs/v03-status.md`;
   retained both lanes, then corrected K21's stale checkpoint summary from its final handoff.
3. `1c7da8e`/`d7dd09b`: K21 execution summaries/probe console and coverage snapshot metrics now identify
   K22's **active** variant. Normal unsupported Node still verifies JSPI-only rejection/preferred fallback.
4. `ff5e905`: K22 partition assembly uses `wasm-names.mjs`; K18 post-link cache identity now includes it.
   Extracted the complete production key for an isolated input-sensitivity regression. Other parser/runner/
   Binaryen/feature/name/remove inputs remain included; thresholds/local passes live in hashed implementation.
5. `5a7a8ff`: force 64 KiB partitions in the small convergence fixture, without changing production thresholds.
   The first diagnostic attempt's 1 MiB target produced just one shard; its assertion correctly failed.

Evidence inbox files are enumerated/read/identity-validated on **each** pipeline build. Selected owners key both
monolithic/chunked lifts; source/dependencies key objects; linked bytes key Asyncify. No evidence/config-only
shortcut can return a stale selected module. Metadata-only provenance updates need not recompile identical code.
JSPI-only bypasses postprocess; preferred emits dual artifacts; both share the same pipeline selection.

## Review boundary

Inherited external **vK21b PASS /vK22b PASS**. Reviewer explicitly read `3be7551..ff5e905` repair diff and
judged it narrow/correct; requested lane reviews + diff read + integrator merged-tree gates in this handoff.
Reviewer subsequently read/accepted `29b3951` (the writer flag), with strict assembly checks unchanged and the
forced-partition convergence case retained as regression. This does **not** upgrade the review scope:
**no separate independent merged-tree review/PASS or CI run is claimed.**

## Additional integration defect: Binaryen writer type order

The 64 KiB four-mode convergence regression found a real fail-closed partition rejection on K21's
interpreter observation build: shards1..12 matched, shard13 changed type/import/function section indices.
Function maps and all five Asyncify helpers were byte-identical. No unsafe assembly/publication occurred.
Binaryen's writer defaults to usage-frequency type order even without the reorder-types pass; shard-local
body usage differs. `29b3951` pins `--preserve-type-order` on partition children, keeping **all original strict
assembly checks**. Exact isolated CC0 reproduction before fails at shard13; after completes16/16 with equal
sections/maps/helpers and V8 validation. Full multi-shard convergence rerun **16/16 tests /3 files PASS**, real Node JSPI enabled.
All four modes converge70,003→0 interpreted instructions, with identical per-update hashes across modes
and zero recording drops. This fixes a K22 partition-assembly bug its original scale run did not exercise.
This is integration breakage exposed by combining K21's new module shape with K22's partitioner, not a
new optimization or changed global default. Hashed partition implementation automatically invalidates cache.

## Final-source verification — complete (2026-11-04)

The original serial driver **completed**, despite the agent-session disk-guard interruption.
Do not repeat its passing gates. Logs, exits, UTC start/finish times and raw oracle reports are retained
in ignored `reports/i12/final/`. The sweep tested commit `e5be578382447810b87410d0adee509d8509f36c`,
tree `7b6b294ff851842c3cae96cf36a5cbaa6efed9c8`. Production/test source is unchanged since `29b3951`;
subsequent commits changed documentation only. Continuation began at `310eb79`.

| Gate | Result |
|---|---|
| doctor | ready, exit0; Node24.19.0, Zig0.13.0, pinned dependencies/Chromium |
| full lint | exit0, ESLint + real GCC + **36/36** example checks including x64-scale |
| explicit clang | exit0, `checkHostGcc("clang")` |
| typecheck | exit0 |
| full npm test | **2,015 passed /106 files /0 skips**, exit0; real Node JSPI enabled |
| Asyncify full browser | **291 passed /51 existing skips /0 failures /0 flaky**, exit0 |
| JSPI browser | **combined291 passed /51 existing skips /0 unresolved failures**; two full attempts + unchanged focused1/1 recovery, explicitly approved by reviewer |
| full leakcheck | exit0; documentation/evidence rechecked before final commit |
| pipeline oracles | **32 fixtures ×2 modes ×300 =19,200 identical frame pairs**, all64 exits0 |
| reduced bounded Asyncify | **5/5 partitions**, 300 reference/raw/Asyncify/real-JSPI checksums equal |

Commands are in `reports/i12/gates-final.sh`: `BGT_INCLUDE_SCALE=1 npm run lint`;
`BGT_JSPI=1 BGT_TEST_JSPI=1 npm test -- --maxWorkers=1 --testTimeout=600000`;
`BGT_JSPI=1 BGT_REQUIRE_WEBGPU=1 npm run test:e2e`, then additionally
`BGT_E2E_SUSPENSION=jspi`; every pipeline example via `npm run oracle -- examples/<id> 300`
with `BGT_JSPI=1 BGT_ORACLE_SUSPENSION=asyncify|jspi`. Both backends plus auto-selection run on
owned port5260, never developer5173; build jobs2, no light mode, no test exclusions or weakened assertions.

Both modes' original browser inventories have the **same51 skips as I11**: backend-specific predicates,
backend-independent tour, opt-in no-adapter and intentional broken-WebGPU negative-policy cases.
No required-device or new-feature availability skip is hidden. Asyncify project pass counts:
WebGL2 **131**, WebGPU **152**, auto **8**. Both JSPI full attempts: WebGL2 **131**, WebGPU **151**,
auto **8**, and one failed WebGPU case. The final retry inventory is audited against the same51 skips.

### Disk failure and unchanged-source retry

The sole sweep failure is `browserContext.close: ENOSPC: no space left on device, write` at
`x64-glsl` WebGPU teardown. Its guest diagnostic log reports PASS; this is **not** counted as a pass.
Original log/exit/results are preserved under `reports/i12/final/enospc-browser-jspi/`.
The complete JSPI browser suite was rerun serially under `reports/i12/rerun-browser-jspi.sh`, root94159,
on unchanged implementation at310eb79. It passed the ENOSPC-affected exact-pixel case, but the different
`x64-glsl` cross-backend case exceeded its unchanged360000ms timeout. Guest logs report all stress/tiles
PASS, with no page/console errors; full retry ends290 passed/51 existing skips/1 timeout. Load averages
were ~36/38/40; reviewer confirmed ~40 on10 cores with four sessions running suites. This is recorded
as a timeout, not silently relabeled a pass. Original sweep had passed the cross-backend case.
Full retry log/exit/results are preserved under `reports/i12/final/timeout-browser-jspi/`.

Reviewer explicitly accepted a **combined same-source gate** if the single timeout passes unchanged,
without repeating the290 passing cases. Focused recovery root22876 uses direct Playwright on existing
JSPI outputs, normal global setup, required WebGPU, same360000ms test budget/assertions, port5260:
`BGT_JSPI=1 BGT_E2E_SUSPENSION=jspi BGT_REQUIRE_WEBGPU=1 BGT_RESULTS_PREFIX=i12-jspi-recovery npm exec -- playwright test --project=chromium-webgpu tests/e2e/x64-glsl.spec.ts --grep "cross-backend images agree"`.
**Focused recovery1/1 PASS**, exit0: 4.8min test /5.4min including setup. Cross-backend comparison
`different=0.00625, unmatched=0` satisfies the unchanged thresholds. No production or test edits, timeout
relaxation or assertion changes. Full retry’s290 passes + recovered1 = **291**, with51 existing skips and
zero unresolved failures. This is **not an uninterrupted green full JSPI suite**. Final logs/results are
`reports/i12/final/jspi-recovery*`; both prior failures remain preserved and hashed in compact evidence.

### Convergence, cache sensitivity and reduced scale

- Final focused convergence: **16/16 tests /3 files**, real Node JSPI. Default Asyncify, forced64KiB
  partitioned Asyncify, JSPI-only and JSPI-preferred all converge **70,003→0 interpreted instructions**,
  identical per-update trace SHA `f3653fc062eb7266ec9572969beeb058c156bdd27ccbd808f9762364196cf208`,
  zero recording drops. Active modes are Asyncify/Asyncify/JSPI/JSPI respectively. Full units also include
  these regressions. Recordings/summary are in `reports/i12/final/coverage-discovery-*.json` and
  `convergence-summary.json`; final focused log `reports/i12/convergence-final.log`.
- Negative controls **3/3 fail as intended** in a private source archive: removing snapshot active variant
  fails both mode assertions; omitting `wasm-names.mjs` from cache identity fails key sensitivity.
  Logs `reports/i12/mutation-before.{log,exit}`. The forced-partition convergence case separately caught
  the actual writer type-order defect; isolated before/after and full rerun preserved. No production mutation.
- Every oracle requested/compared300; identical, null divergence/failure/errors, lifted interp0,
  empty API/GL stubs, correct active variant. Trace SHA agrees lifted/interpreted **and across variants**.
- Reduced scale uses **1,044 owners /1,800 rounds**, production partition thresholds, raw **41,518,980B**,
  Asyncify **42,175,552B**, **five partitions**. Mathematical reference, raw, Asyncify and real JSPI agree
  on all300 updates and **10,500 yields per variant**. Hashes/sizes/oracle/log retained under
  `reports/i12/final/scale*`; both wasm artifacts removed after hashing. This is not the417MB lane run
  and makes no game-performance claim.

### Preserved diagnostics and cleanup

Earlier fixture diagnostics are not final acceptance: the1MiB force setting made one shard and correctly
failed the >1 assertion; repaired to64KiB. Typecheck caught missing Window typing in the browser assertion,
repaired before the final sweep. The original forced-partition run failed closed on shard13 before
`29b3951`; final16/16 run passes. Early shell-parse/wait-boundary attempts ran no gates. Original logs remain.
Only owned pre-sweep/waiting runner roots were canceled; no shared gate locks, queues or caches were removed.
The private mutation/reproduction archives and reduced-scale wasm outputs are gone. Shared caches and current
browser outputs remain intact. The owned I12 Zig cache (~768MiB) was removed only after browser
build/global setup completed (browser specs do not invoke host builds). Disk headroom is monitored.
Reviewer #216 disclosed an accidental helper kill (pid72066 around13:15 local); no corresponding
killed/aborted-helper failure appears in these gate logs, so no unrelated gate was repeated.

## Finish boundary

Compact checked evidence: [integration-i12-evidence.json](integration-i12-evidence.json). The final auditor
`reports/i12/finalize-evidence.mjs` checks all exit/report contracts, exact skipped-test inventory against I11,
all64 oracle reports/cross-variant hashes, four convergence variants and mathematical scale checksums.
Final documentation/evidence only; no implementation changes during I12b, no push. Owned scale/archive
artifacts removed; shared caches/locks untouched. Inherited external lane reviews and reviewer diff-read
remain the validation boundary: no separate independent merged-tree PASS, CI, game/playability or
physical-device/mobile certification is claimed.
