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
Reviewer explicitly read `cb82808` and accepted inherited lane reviews + narrow repair-diff read +
integrator merged-tree gates, as in I12. **No separate independent merged-tree PASS or CI run is claimed.**
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

Pending: complete Asyncify/JSPI browser suites; K24 capacity and K25 component/lifetime native
fixtures on both backends; leakcheck; all33 pipeline fixtures ×2 variants ×300 frames, including
strict #204 scale contract.
Failed browser attempts, if any, will be reported rather than relabeled; only an unchanged timed-out
test may be retried under the task's permission. Temporary outputs will be cleaned after writer exit.
