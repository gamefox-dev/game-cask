# Integration I13 — K23 + K25 + K24

**Merged; final-tree validation in progress.** Branch `integration/p1`, base dev.15 `3cbcb25`.
No game inputs, installs, push, assertion/deadline weakening or suspension-default change.
Asyncify remains the default. Do not treat this checkpoint as completed finish-line acceptance.

## Ordered merges and semantic resolution

1. `c363ec0`: `--no-ff lane/K23` (`617e72c`).
   Resolve `tools/build/build.mjs` by retaining K22's bounded `asyncify.mjs` entrypoint and K23's
   supervised finite-file transport and wasm-opt phase. K21 evidence/selection, monolithic/chunk lifts,
   compilation and K22 whole/partition children all use the shared supervised wrapper.
2. `5d55af0`: `--no-ff lane/K25` (`7187af2`).
   Keep scalar-class validation, native (0,0,0,1) component fill, typed compute-feedback fill, failed
   logical pipeline lifetime/E_IO and rejected-bind clearing (decision #207).
3. `2ac82ca`: `--no-ff lane/K24` (`80fa85d`), including K24d hot-path repair.
   Retain both status histories; renderer auto-merges add buffer capability advertisement without
   changing K25 pipeline state handling. ABI retains both component/lifetime rules and additive §13.14.
   Explicit full-u32 buffer negotiation, dynamic guest/VAO/wire tables and unchanged byte budgets
   (#199/#200) coexist with the exact x64-gl-scale-only expected-error contract (#204).

## Integration defect and regression

`cb82808` repairs nested group containment: K22's Asyncify Node helper calls K23's wrapper again.
Previously each partition detached into a new process group, escaping the ancestor deadline/failure.
An internal inherited group marker now keeps nested supervisors/children in the ancestor group;
Python validates group membership, every per-helper timer stays bounded, and nested failure is fatal
for that build group. Explicit whole-module/partition phases identify the active child.
Lock readiness deliberately keeps its independent supervised group: an acknowledged guardian must
survive owner death and drain writers before unlocking. Finite anonymous file input, lock readiness
bounds, lease clearing and original-error/cleanup-error handling remain intact.

Deterministic negative controls temporarily installed only frozen pre-repair exec/writer sources,
then restored exact bytes in finally: **2 expected failures /1 pass** (ancestor deadline and ancestor
output-buffer failure left inner helpers alive; inner deadline was already bounded). Final focused
transport/lock/partition checks: **18/18 in3files PASS**; independent-group positive control included.
No mutation remains; test cleanup kills observed before-run helpers. Raw logs and restored hashes:
`reports/i13/focused/`. Initial proof-driver syntax errors ran no tests; initial focused ESLint found
an unsafe throw in test cleanup, repaired before final source/gates. These diagnostic failures remain.

## Review boundary

Inherited external **vK23 FAIL → vK23b PASS**, **vK25 PASS**, **vK24 PASS** (K24d included).
Reviewer bridge **#228** explicitly read `cb82808` and accepted inherited lane reviews + narrow
repair-diff read + integrator merged-tree gates, as in I12. **No separate independent merged-tree PASS or CI run is claimed.**
No game replay/playability, general performance or physical-device/mobile certification is implied.
Porter uncensored GL peak/byte measurements and unchanged-game replay remain porter-owned.

## Final-source gates (pending)

Source `cb82808a6d6b0bbb31cd4c21e7e49dee41cad456`, tree
`74792b41a51fea6438f1526e6ce5e95c0699b21b`. Serial background driver:
`reports/i13/gates.sh`; logs, exits, timestamps, source hashes and reports: `reports/i13/final/`.
Node24.19.0, build jobs2, real JSPI units/oracles, required desktop WebGPU plus forced WebGL2/auto,
owned port5262 (developer5173 untouched), full scale coverage, Playwright `--trace off` only.

Completed so far (all exit0): doctor; full Clang/GCC lint (**37/37** examples each) and explicit
Clang host checks; types; **2,065 units /114 files /0 skips**; **16/16** focused four-mode K21
convergence checks; K23 concurrent real compile/link stress **128/128**, eight workers ×16 builds
with locks, **6.921s**,64 cold/64 warm, all digests equal the historical reference. Four-mode
convergence retains **70,003→0** interpreted instructions, identical traces, zero drops.

### Browser result so far — one unchanged-test timeout recovery queued

Full Asyncify command **exit1**, **299 passed /51 existing skips /1 timeout /0 flaky**.
Only failure: `tests/e2e/x64-glsl.spec.ts: x64-glsl: cross-backend images agree @webgpu`,
unchanged **360000ms** timeout. Original log/exit/JSON remain under
`reports/i13/final/browser-asyncify*`; do not relabel this full process green. Passing counts:
WebGL2 **135**, WebGPU **156**, auto **8**; skips24/26/1. The complete expected inventory is
300 pass identities +51 skips once the missing test passes; verify exact skip identities in audit.
The task explicitly permits retrying only a timed-out browser test unchanged and reporting both.

K24 scale native draws and full-u32 buffer tests passed on both backends in this run; K25
component-fill/lifetime cases also passed both. Extracted scale PNGs were actually viewed:
red half, green/blue quarters, black margins, byte-identical across backends; files
`reports/i13/final/scale-chromium-{webgl2,webgpu}.png`. This is desktop native evidence only.

## Fresh-session checkpoint — reviewer #235 (2026-11-04 18:32 +0700)

**Leave the running serial jobs alone; do not repeat finished gates.** API interruptions did not
stop the background driver. All implementation/test inputs still match the source SHA inventory;
only documentation has changed since the tested implementation. Checkpoint docs commit before this
update: `38235b8`. Sandbox ps cannot enumerate descendants; roots below were confirmed live by
`kill -0` at18:32, not invented compiler/npm PIDs.

| Root PID | Job | State / evidence |
|---|---|---|
| **86726** | `bash reports/i13/gates.sh` | Running **browser-jspi**; driver log `reports/i13/driver.log`; per-step logs/exits in `reports/i13/final/` |
| **99357** | `bash reports/i13/recover-asyncify.sh` | Waiting for `reports/i13/final/done`, then reruns ONLY the unchanged Asyncify WebGPU GLSL cross-backend test; log `reports/i13/recovery-driver.log` |

Exact remaining serial sweep after the currently running full JSPI browser gate:
1. Explicit feature replay: K24 `gpu-buffer-handles`, `x64-gl-scale`, `x64-gl-capacity`;
   K25 `gpu-vertex-components`, `gpu-vertex-wgsl`, `gpu-pipeline-lifetime`, both required backend
   projects, `--trace off`. Native WGSL is intentionally WebGPU-only.
2. Full leakcheck.
3. Enumerate all33 pipeline game.json fixtures and run **each at300 frames**, Asyncify then real
   JSPI (**66 reports /19,800 frame pairs**). Exact #204 x64-gl-scale contract remains enforced by
   production oracle/assertScaleRecording; every other fixture zero command errors. Reports copied
   into `reports/i13/final/oracles/{asyncify,jspi}/`.
4. Sweep writes `current=complete` and `done`. This marks driver completion, **not aggregate PASS**:
   driver intentionally preserves failures and continues. Then PID99357 runs the unchanged timeout
   recovery, same port5262, required WebGPU, ordinary global setup, no guessed timing/timeout changes.

Next operator actions (no new suites while either runner is active):
- Read `current`, all individual `*.exit`, browser JSON and both roots' liveness. If stopped, preserve
  existing evidence and resume only missing/failed gates. Read scripts before executing, never rerun
  the original sweep from the top. If JSPI also times out, queue only that unchanged failing test
  **after** the two existing roots finish; no automatic retry is configured.
- Verify all source inputs: `shasum -a 256 -c reports/i13/final/source-sha256.txt`. Docs-only
  commits are expected. Audit every oracle for requested/compared300, equal state/semantic trace hashes
  including cross-variant equality, null errors/stage/divergence, lifted interp0 and no API/GL stubs.
- `reports/i13/audit.mjs` is a prepared **not-yet-run** compact evidence auditor. It checks full units,
  exact existing skip identities against I11, native feature identities, all66 reports, four convergence
  recordings, stress digests and before/after regression logs. It supports one exact GLSL timeout
  recovery per variant, retaining original failure, and writes
  `docs/handoff/integration-i13-evidence.json`. Validate its assumptions against actual reports;
  an auditor correction is not permission to weaken production tests or acceptance.
- After every writer has exited, delete only owned temporary outputs/caches as necessary, retaining
  raw logs/JSON/PNG/hashes and permanent lock inodes; no shared gate/cache cleanup during builds.
  At checkpoint free disk **6.1GiB**, browser HTML/artifact directories are removed by the script
  after copying JSON (custom PNG attachments remain inline). Trace-off avoids multi-GB trace growth.
- Finish status/handoff with actual gate results and explicit failure/recovery history; final leakcheck
  and diff-check; docs-only commit, version-label commit consistent with integration practice if used.
  Final response under150 words. No new independent merged-tree PASS/CI/game certification claim.

No passing gate was repeated after the API interruption. The only test rerun currently queued is
that exact timed-out Asyncify case under the brief's explicit permission. Temporary fixture/cache
cleanup remains pending writer exit.
