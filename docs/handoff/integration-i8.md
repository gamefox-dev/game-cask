# Integration I8 — K11 speed policies + K10 instrumentation

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

## Validation

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
