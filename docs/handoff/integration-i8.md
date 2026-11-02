# Integration I8 — K11 speed policies + K10 instrumentation + K13 native chaining

## Reviewer scope extension: K13

Reviewer live instruction #113 extends I8 to include **`lane/K13` / `9f5c191`**, based on K11 `2124b13`, after
the two original ordered merges. **`fb1ce3d`** is its `--no-ff` merge over the already-validated K11+K10 tree.
K13's lane review was vK13 FAIL followed by vK13b PASS at `59ddafd`; these historical reviews are not substituted
for validation of this three-lane merge. The original K11+K10 evidence below remains explicitly pre-K13.

Semantic integration keeps K13's scalar SSE/decoder and read/write permission repairs, bounded native suffixes,
flat foreign-owner/thunk driver, callback stop scopes, checked native-step cache and four-field chunk registry.
K9 GL/renderers and K12 heap implementation remain untouched. Additional adaptations:

- K10 local strict membership is checked on both registry cache hits and misses, before a foreign native step.
- K13's native suffix dispatch uses `x86_coverage_lifted`, not direct host crossings; guard and both counting-policy
  quantum fallbacks retain census reasons, and accepted suffixes reset a stale indirect exit reason.
- Overridden registry entries have NULL native steps, retaining K10's all-overridden and suspending override path.
- **Asyncify exclusions now select only exact generated `N_*` native-step definitions** intersected with linked
  names. K13 `F_*` wrappers run the flat driver and may suspend inside API thunks, so they are never excluded.
  Empty/all-inlined step sets and oversized lists retain conservative instrumentation. The benchmark follows the
  same policy. New `N_*` profiling names map to guest addresses in the CDP sidecar.
- Both presets exercise real native-suffix coverage/strict stops and quantum/guard reasons. Real-runtime tests
  warm foreign-owner caches before installing a narrower host policy and prove the forbidden owner's first
  side effect does not run; cold lookups are checked too. The existing real import-yield/handwritten override
  fixture retains all assertions and now executes the unmodified native import path before adding overrides.
  The prior interior-fallback regression uses a >8-instruction non-SSE body to retain the intended K13 boundary,
  not an outdated assumption that every interior entry still executes shared semantics.
- K13's two new standalone test files explicitly declare `@bgt-examples: none`; owned CC0 fixture compilation
  remains local and K7i lazy selection is intact.

Focused merged evidence: **105/105 tests / 5 files**, plus **2/2** both-preset Asyncify/import/override tests.
Three-lane full Tier 1 is in progress, not yet claimed.

### K13 merge review and precise suffix mutation

A real fresh read-only source session reviewed `fb1ce3d`: **no production semantic conflict found** in the requested
scope, including strict cache checks, native driver, four-field registries, override NULL steps and Asyncify safety.
It found one P2 regression blind spot: an indirect jump's immediate successor was a block start, so the fixture did
not test the new native suffix hook. **`7e31051` / `0f64339`** insert a skipped NOP at +7 and target the MOV at +8,
assert emitted `entry_index=3u`, and split buffered coverage from strict-before-write checks in both presets.
An initial formatting assertion omitted the generated unsigned suffix `u`; this test-only mistake was corrected.

A second fresh follow-up was launched without `--fork` but failed with provider **429 `usage_limit_reached`**, before
producing a review verdict. Reviewer explicitly accepted the existing bounded production review plus author-run
mutation evidence for this test-only correction, requiring disclosure rather than another quota-consuming session.
**No final-independent-PASS claim is made for the corrected test change.**

Exact author mutation procedure, in a scratch-only original-kit checkout (never the integrated source tree): remove
only `x86_coverage_lifted(pc,1)` from the emitted native-suffix landing case; then run:

```sh
npx --no-install vitest run tests/unit/codegen.test.ts --maxWorkers=1 -t 'K13 native interior suffix'
```

Mutant: **4 failed** (both presets: missing +8 coverage, or missing strict stop); restore the original `lift64.h`
and run the identical command: **4 passed**. The remaining 58 tests are selection skips in this diagnostic,
not acceptance skips. Logs: `/tmp/integration-i8/k13/suffix-{mutant,restored}.log`. An earlier mutant attempt failed
only the unsigned-literal formatting assertion and is explicitly not the claimed dynamic mutation evidence.
The scratch checkout is removed after checks. **`6f5eeae`** separately maps K13 `N_*` CDP names, with a known-answer
unit assertion, and documents inclusive timing; it does not broaden Asyncify exclusions.

## Final three-lane validation checkpoint

The sequential validation script started on **`fb1ce3d`** and finished on code commit
**`0f643392a6c1415335b17b1374d2ed7d7ede5edc`** (short `0f64339`), before this documentation-only checkpoint.
Doctor completed on `fb1ce3d`. Lint started on `fb1ce3d` and ended after the small profiling/test follow-ups;
its early ESLint phase is **not claimed as an exact-`0f64339` rerun**. Typecheck, full units, e2e, leakcheck,
all default and fast oracles, and output restoration ran after `0f64339` was committed with no further code changes.
Exact logs are under `/tmp/integration-i8/k13/`:

| Gate | Result | Log |
|---|---|---|
| doctor | pass, original/ empty | `doctor.log` |
| lint | pass, ESLint + clang + real GCC, **33/33 check-builds** incl. scale | `lint.log` |
| typecheck | pass | `typecheck.log` |
| unit | **1,057 passed / 81 files / 0 failures** | `units.log` |
| e2e | **232 passed / 51 unchanged skips / 0 unexpected / 0 flaky**; WebGL2 104/24, WebGPU 120/26, auto 8/1 | `e2e.log` |
| leakcheck | pass, **619 committable files** | `leakcheck.log` |
| default oracles | **29 × 300 = 8,700 identical pairs**, null errors, lifted interp=0, stubs=[] | `oracle-*.log`, `default-oracles/` |
| fast matrix | **x64-crt/x64-cpp/x64-scale × size+fast ×300 = 1,800 pairs**, identical hashes per fixture | `policy-oracles.log`, `policy-oracles.json` |
| restored outputs | default example builds restored after matrix | `restore-defaults.log` |

The combined oracle total is **10,500 compared frame pairs**. Fast matrix final rows: x64-crt size/fast wasm
**1,386,056 / 1,459,211 B**, hash `bae2920f`; x64-cpp **3,051,226 / 3,655,290 B**, hash `eadc23f1`;
x64-scale **44,998,182 / 77,339,758 B**, hash `f674cbe2`. All six rows are identical and have zero lifted
interpretation/empty stubs.

### Remaining work for fresh codemode (reviewer-requested stop)

- Rerun **doctor and lint** (include `BGT_INCLUDE_SCALE=1`) on the final checkpoint: their prior runs began before
  the profiling/test-only follow-ups. All 33 compile checks passed, but exact-final-code ESLint is not assumed.
- Rerun **leakcheck** after this documentation checkpoint; optionally rerun typecheck and full suites/oracles on
  the exact final documentation commit for a single-commit acceptance record. Code at `0f64339` already has the
  complete unit/browser/default+fast oracle evidence above, and no test/code edits follow it.
- Update the handoff/status with any new final-commit counts and deliver I8. Nothing is failing; no active gate
  remains running. The latest validation marker `/tmp/integration-i8/k13/done` contains `0f64339`'s full hash.

The provider-blocked review follow-up remains disclosed, not a claim of final independent PASS; reviewer explicitly
accepted existing bounded production-source review plus author mutation evidence instead. No ENOSPC occurred;
free space was approximately 7.3 GiB at this checkpoint. Stopping here is **reviewer instruction #117**, not a
self-estimated context boundary.

## Historical pre-K13 K11+K10 checkpoint

## Merge and scope

On `integration/p1`, starting at **`3548213`** (K9a/K9b and K12 already integrated):

1. **`140b96c`**, `--no-ff` merge of `lane/K11` / `2124b13`.
2. **`aa0f739`**, `--no-ff` merge of `lane/K10` / `f1fd1d9`.
3. **`f305490`**, original CC0 merged-path regressions and explicit lazy-test declarations.
4. **`b3d275b`**, independent-review repair for standalone empty-cache fixture setup.

K11 remains opt-in: `pipeline.liftPreset` defaults to `size`; `fast` enables inline memory, inline ALU/cold flag
replay, tiny-region optimization and affine counting, with individual boolean overrides. K10's sampled timing,
resettable census, buffered coverage, strict local membership and exact generated Asyncify exclusions apply to
both presets. Named profiling still emits final-index names after Asyncify, without Binaryen `-g`.

No renderer or GL-profile source changed from `3548213`; K9's GLSL, transform feedback and blit work is retained
byte-for-byte. K12's heap header, CRT allocation family, kernel heap entry points and x64 bridges are also
unchanged. The auto-merged core changes add profiling/coverage and JSON capacity without replacing K12's heap.
No target/game files, captured shaders, web access, installs, dependencies, success stubs or pushes.

## Conflict resolution and regression strength

- Kept K11's affine debt, all flush points, cold flag reconstruction and configurable tiny-region attributes.
  Added K10's `exit_reason` alongside debt, guard reason after affine settlement, and quantum reason on **both**
  the original block-count path and K11's region reservation path. Kept indirect/interior classification,
  accepted-entry coverage and the actual dispatcher-exit census hook. Kept replay allocation cleanup.
- Kept K10's override-skip registry, generated-symbol definition scan, strict-entry metadata, coverage modes and
  profiling exports alongside K11's monolithic/chunked option forwarding, cache keys and manifest policy.
- Combined test harness fault-address/hash and quantum controls with K10's strict policy and reason hooks.
  All codegen regressions run under **both size and fast**, including strict in-region indirect stops and
  clearing a stale indirect reason before a later direct exit. New tests execute emitted native entry hooks,
  verify exact buffered entry addresses/kinds/crossing/hit counts, and distinguish guard/quantum/interior exits.
  The real handwritten override yielding twice and the entirely overridden selection now run in both presets.
- Combined K11's repeatable preset/throughput benchmark with K10's richer resource snapshots and build-mode labels;
  neither lane's report fields or independent oracle assertions were dropped.
- Every new standalone K10 unit file and the codegen test explicitly declares `@bgt-examples: none` because it
  compiles its own CC0 fixtures. Owned benchmark fixtures are explicit too. Existing `build-chunks` declares
  `x64-scale`; the probe regression declares `win32-hello`. No build-all fallback or test weakening was added.

## Pre-K13 validation

Full sandbox gates on the merged implementation, including the standalone setup repair:

| Gate | Actual result |
|---|---|
| doctor | ready; `original/` empty |
| lint | ESLint + clang 21 + real GCC 14.2; **33/33 example check-builds**, including scale |
| typecheck | pass |
| `npm test -- --maxWorkers=1` | **1,020 passed / 79 files / 0 failures / 0 skips**, 1,560.90 s |
| required-WebGPU `npm run test:e2e` | **232 passed / 51 unchanged intentional skips / 0 failures / 0 flaky** |
| browser project breakdown | WebGL 2 **104/24 skipped**, WebGPU **120/26**, auto **8/1** |
| leakcheck | pass; **607** committable files at initial final-gate run; rerun for final docs |
| default pipeline CLI oracles | **29/29 × 300 = 8,700 identical pairs**, null errors, lifted interp=0, stubs=[] |
| preset matrix | **3 fixtures × 2 presets × 300 = 1,800 identical pairs**, equal cross-preset hashes |

All examples were built before the CLI oracles. The full default inventory is the **29** `pipeline`-containing
`examples/{win32-,x64-,x86-}*/game.json` files. Native BGT examples retain normal builds/browser checks, not fabricated
interpreter oracles. Tests own **`BGT_E2E_PORT=5232`**, never developer `:5173`. A static lazy-build audit confirms
**all 33 examples** are declared by the unit suite; there are no missing fixture declarations.

Local scratch logs: `/tmp/integration-i8/` (`gates-status.log`, `*-final.log`, `oracle-<id>.log`,
`default-oracles/`, `policy-oracles.log/json`). These are machine-local diagnostics, not durable evidence promises.

### Independent review and mutation evidence

Two actual fresh pi sessions, no `--fork`, ran read-only source reviews. The first reviewed the semantic merge
at `f305490`, found no concrete semantic defect, but identified an empty-cache test precondition: the standalone
Asyncify test did not create its cache parent. **`b3d275b`** creates exactly that parent recursively before
`mkdtempSync`, retaining every existing assertion. The fresh follow-up returned **PASS within bounded source-review
scope** and independently checked both this repair and the emitted-hook regressions. Neither review is attributed
with Tier 1, target performance or playability evidence.

A separate scratch-only original-kit checkout reproduced **2/2 ENOENT failures before** the repair and **2/2 passes
after**, starting without a BGT cache. Scratch-only mutations remove (1) the affine quantum reason, causing the fast
boundary test to fail `0 != 3`, and (2) emitted entry hooks, causing both buffering tests to fail `0 != 4` events.
Restoring the implementation passes all **4** selected assertions. Selection skips in these mutation experiments
are not acceptance skips; the full unit run above has none. No mutation touched the integrated working tree.

### Interrupted diagnostic attempts (not passing evidence)

An initial scratch empty-cache check was tool-timeout terminated while queued behind the heavy gate; a later attempt
failed to find `vitest` because the scratch node_modules links omitted `.bin`. The corrected isolated setup is the
before/after result above. After the full green gates, the first oracle prebuild stalled **before compilation**:
a verified owned Python helper was blocked reading stdin (native process sample), with no compiler child. Only that
verified descendant was terminated; the resulting scale build was failed, not counted as success. A fresh prebuild
and all 29 CLI oracles then passed. No shared gate files or unrelated processes were modified. No ENOSPC occurred; temporary scratch checkout was removed after its checks.

### Required preset matrix

All six builds/oracles pass, with zero lifted interpreted instructions and empty stubs. Counts include a repeated
explicit size control, so the **29 defaults + 3 additional fast** acceptance inventory is **9,600 frame pairs**;
including the three repeated size controls, this run compared **10,500 pairs**.

| Fixture | size wasm bytes | fast wasm bytes | identical final API hash, both presets/modes |
|---|---:|---:|---|
| `x64-crt` | 1,338,461 | 1,417,418 | `bae2920f` |
| `x64-cpp` | 2,896,026 | 3,496,604 | `eadc23f1` |
| `x64-scale` (1,609,529 insns) | 40,849,144 | 75,114,746 | `f674cbe2` |

These are correctness/size results, not new timing measurements or a universal speedup. The large fast scale growth
reinforces the opt-in boundary. Example outputs are rebuilt with default configuration after the matrix.

## Acceptance boundaries

This integration does not close historical F-PERF-CRT, establish an engine speedup, or claim a title, first draw,
representative game loop, unrestricted Windows/GLSL compatibility or physical mobile/browser certification.
K11's abort-only memory-fault contract and K10's sampled-inclusive timing, finite census/drop policy, raw
active-context instruction clock and whole-module Binaryen limits remain as documented in their lane handoffs.
No test tolerances, assertions, skip policies or deadlines were weakened.
