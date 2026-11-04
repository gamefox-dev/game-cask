# Integration I13 — K23 + K25 + K24

**Complete: merged-tree gates accepted under the stated review/recovery boundary.** Branch
`integration/p1`, base dev.15 `3cbcb25`.
No game inputs, installs, push, assertion/deadline weakening or suspension-default change.
Asyncify remains the default. Finalization after tested implementation is documentation/evidence only.

## Ordered merges and semantic resolution

1. `c363ec0`: `--no-ff lane/K23` (`617e72c`).
   Retain K22's bounded `asyncify.mjs` entrypoint and K23's supervised finite-file transport
   and wasm-opt phase. K21 evidence/selection, monolithic/chunk lifts, compilation and K22
   whole/partition children all use the shared supervised wrapper.
2. `5d55af0`: `--no-ff lane/K25` (`7187af2`).
   Keep scalar-class validation, native (0,0,0,1) component fill, typed compute-feedback fill,
   failed logical pipeline lifetime/E_IO and rejected-bind clearing (decision #207).
3. `2ac82ca`: `--no-ff lane/K24` (`80fa85d`), including K24d hot-path repair.
   Renderer merges add buffer capability advertisement without changing K25 pipeline state handling.
   ABI retains component/lifetime rules and additive §13.14. Full-u32 buffer negotiation, dynamic
   guest/VAO/wire tables and unchanged byte budgets (#199/#200) coexist with the exact
   x64-gl-scale-only expected-error contract (#204). Both lane status histories are retained.

## Integration defect and regression

`cb82808` repairs nested group containment: K22's Asyncify Node helper calls K23's wrapper again.
Previously each partition detached into a new process group, escaping the ancestor deadline/failure.
An internal inherited group marker now keeps nested supervisors/children in the ancestor group;
Python validates membership, every per-helper timer stays bounded, and nested failure is fatal
for that build group. Explicit whole-module/partition phases identify the active child.
Lock readiness deliberately keeps its independent supervised group: an acknowledged guardian must
survive owner death and drain writers before unlocking. Finite anonymous file input, readiness bounds,
lease clearing and original-error/cleanup-error handling remain intact. Reviewer decision #226 accepted it.

Deterministic negative controls temporarily installed only frozen pre-repair exec/writer sources,
then restored exact bytes in finally: **2 expected failures /1 pass** (ancestor deadline and ancestor
output-buffer failure left inner helpers alive; inner deadline was already bounded). Final focused
transport/lock/partition checks: **18/18 in 3 files PASS**; independent-group positive control included.
No mutation remains; cleanup kills observed before-run helpers. Logs/restored hashes:
`reports/i13/focused/`. Initial proof-driver syntax errors ran no tests; initial focused ESLint found
an unsafe throw in test cleanup, repaired before final source/gates. These diagnostic failures remain.

## Review boundary

Inherited external **vK23 FAIL → vK23b PASS**, **vK25 PASS**, **vK24 PASS** (K24d included).
Reviewer bridge **#228** explicitly read `cb82808` and accepted inherited lane reviews + narrow
repair-diff read + integrator merged-tree gates, as in I12.
**No separate independent merged-tree PASS or CI run is claimed.** No game replay/playability,
general performance or physical-device/mobile certification is implied. Porter uncensored GL
peak/byte measurements and unchanged-game replay remain porter-owned.

## Final-source gates

Tested source `cb82808a6d6b0bbb31cd4c21e7e49dee41cad456`, tree
`74792b41a51fea6438f1526e6ce5e95c0699b21b`. All tracked implementation/test/fixture hashes still
match `reports/i13/final/source-sha256.txt`; later commits touch docs only. Serial background driver:
`reports/i13/gates.sh`; raw logs, individual exits, timestamps and reports: `reports/i13/final/`.
Durable audited results/report hashes: [integration-i13-evidence.json](integration-i13-evidence.json).

Node 24.19.0, build jobs 2, real JSPI units/oracles, required desktop WebGPU plus forced WebGL2/auto,
owned port 5262 (developer 5173 untouched), full scale coverage, Playwright `--trace off` only.

| Gate | Final result |
|---|---|
| Doctor / typecheck / leakcheck | exit0 each |
| Full Clang + real GCC14 lint | exit0 each, **37/37 example checks each** |
| Explicit Clang host checks | exit0 |
| Full npm test | **2,065 passed /114 files /0 skips**, exit0 |
| K21 four-mode convergence | **16/16**, exit0; default, partitioned Asyncify, JSPI-only/preferred |
| K23 concurrent real compile/link stress | **128/128**, 8 workers ×16 with locks, **6.921s** |
| Full Asyncify browser + exact timeout recovery | **Combined 300 PASS /51 existing skips**, original exit1 retained |
| Full JSPI browser | **300 PASS /51 existing skips /0 unexpected /0 flaky**, exit0 |
| Explicit K24/K25 native feature replay | **11/11**, WebGL2 5 + WebGPU 6, exit0 |
| Every pipeline oracle | **33 fixtures ×2 modes ×300 =19,800 identical frame pairs**, all66 exit0 |
| Structured evidence audit | exit0; source, exact skips, native identities, all reports/convergence/stress/regression |

Every oracle requested and compared exactly300 updates, with equal lifted/interpreted state and
semantic trace hashes, equal cross-variant state/trace hashes, null errors/failureStage/divergence,
zero lifted interpretation and empty API/GL stubs. Scale uses ONLY the strict #204 contract:
exactly one deliberate BUFFER_CREATE E_LIMIT, one counted GL buffer OOM and successful recovery,
exactly ten named recording-only GPU-dependent failures. Every other fixture retains zero command
errors. Scale metrics in both builds/modes: buffer peak12002/failures1/failed_requests1,
VAO peak12000/failures0/failed_requests0,12009 draws. Recording evidence is not raster evidence.

Four-mode convergence retains **70,003→0** interpreted instructions, identical traces across modes,
zero drops. Stress has64 cold/64 warm builds; all8 digests equal historical reference
`7d1911076a89f5b88d7ee679e8d2968bc6f3bf5de058b1e17d35ef2d30317243`.

### Browser failure and permitted unchanged recovery

The original full Asyncify process is **not green**: **299 passed /51 skips /1 timeout /0 flaky**,
exit1. Only failure: `tests/e2e/x64-glsl.spec.ts`, `x64-glsl: cross-backend images agree @webgpu`,
unchanged **360000ms** limit. Original log/exit/JSON remain in `browser-asyncify*`.
After every other gate finished, the queued recovery ran ONLY that unchanged test, same required
WebGPU/port/global setup, no guessed delays, assertion changes or deadline changes:

`npx playwright test tests/e2e/x64-glsl.spec.ts --project=chromium-webgpu
--grep "cross-backend images agree" --trace off`

Recovery **1/1 PASS**, exit0, **5.8min test /6.2min including setup**, comparison different0.00625,
unmatched0. Evidence: `recovery-asyncify*` (12:03:15–12:09:30 UTC, November4); recorded setup-time
load averages37.81/23.89/25.11. This is the brief's explicitly permitted combined same-source gate,
**not an uninterrupted green full Asyncify run**. No other test was rerun after the checkpoint.
JSPI passed on its first full attempt and needed no recovery. Both modes' full test inventories match;
the exact51 skip identities match I11 and each other. Combined per-mode passes: WebGL2 **135**,
WebGPU **157**, auto **8**; skips24/26/1. Neither required backend was unavailable.

K24 native full-u32 IDs, capacity and12,000-pair scale, plus K25 component-fill/lifetime fixtures
pass on both backends in the full runs and explicit replay. Native WGSL is intentionally WebGPU-only.
Extracted scale PNGs were actually viewed in both sessions: red half, green/blue quarters, black
margins, byte-identical across backends (`scale-chromium-{webgl2,webgpu}.png`). Desktop only.

## Continuation, audit and cleanup

Reviewer #235 requested the fresh-session checkpoint at18:32 +0700. Commits `38235b8`/`5f04dad`
preserve that historical pending state. Continuation left both jobs alone: PID86726 serial sweep
completed at12:03:08 UTC; PID99357 exact recovery completed at12:09:30 UTC. Both roots confirmed
stopped; no suite remains intentionally active. Transient API errors did not cause finished gates
to repeat. The only browser rerun was the permitted exact timeout recovery above.

`reports/i13/audit.mjs` passed, including all66 reports, equal cross-mode state/trace hashes, scale
metrics, exact native identities, four convergence recordings, stress digests and before/after logs.
Source checks pass after cleanup. After writer exit, removed **27 owned temporary fixture/slice
directories,443,210,094 file bytes**; retained payload caches, permanent lock inodes, raw logs,
JSON, PNG and hashes (`cleanup.json`). Browser HTML/artifact copies were removed after retaining JSON.
Two closeout cleanup-script syntax errors performed no deletion; corrected script then completed.
No shared cache was cleared during a build. Final documentation **leakcheck PASS (784 committable files)** and **diff-check PASS**, both exit0,
are recorded under `reports/i13/final/closeout-*`. No implementation or gate work remains under this scope.
