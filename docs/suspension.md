# Suspension artifacts and large modules

The guest ABI is unchanged: only `bgt.yield` suspends, only inside update, resuming at the exact call site.
This policy is backend-independent (WebGL2 and WebGPU), not a coverage/selection optimization.

## Win32 update boundaries (K50)

Both suspension artifacts use the same [guest time model](../platforms/win32/THREADS.md#guest-time-model-k50-version-1).
A 2M-unit quantum rotates guest contexts without automatically yielding a host update. Present, process-cap,
idle/legacy wait and transport boundaries still suspend only through bgt.yield, at the exact call site.
`step(n)` counts n consumed host updates, not instruction quanta or guaranteed guest presents. Nominal
instruction-rate clock progress, positive swap-interval snapping and idle deadlines are deterministic;
no host wall-time-dependent scheduling is added. Clock/budget state is wasm checkpoint state. Test builds
can opt in to returnable Win64 JSPI presentations: the outer wasm dispatch really returns and re-enters
from explicit guest/ABI state on the next update. A callback, transport wait or other live JSPI stack is
still rejected; no restart, alternate artifact or fake snapshot is used. See [savestates](savestates.md).

## Build/package policy

| Build setting | Artifacts | Runtime requirement |
| --- | --- | --- |
| `suspensionBuild: "asyncify"` (default) | `game.wasm` | Asyncify; no JSPI required |
| `suspensionBuild: "dual"` | `game.wasm` + `game.jspi.wasm` | Asyncify fallback, optional JSPI |
| `suspensionBuild: "jspi"` | raw linked `game.wasm` only | JSPI mandatory; **no Asyncify pass** |

Use `pipeline.suspensionBuild` for pipeline games or top-level `suspensionBuild` for native BGT games.
`BGT_SUSPENSION_BUILD=asyncify|dual|jspi` supplies a build-wide default. Explicit config wins.
Existing `pipeline.jspi: true`, `jspi: true` and `BGT_JSPI=1` still request dual output unless the new
setting is explicit. Invalid settings fail before compilation. JSPI-only manifests mark `suspension: "jspi"`;
they never advertise a nonexistent fallback or silently run raw wasm as Asyncify.

The global default remains Asyncify (reviewer decision: mixed fixture speed/load evidence does not justify
a universal JSPI default). A measured port may put **`"suspension": "jspi-preferred"`** in `game.json`: this
automatically emits dual artifacts and sets manifest `preferredSuspension: "jspi"`. The preference is
backend-independent; an explicit runtime/query choice wins. Unsupported APIs still select Asyncify.
Active selection is reported as `diagnostics.suspension` and `metrics.runtime_profile.suspension`.

Dual packages otherwise retain default Asyncify and explicit `?suspension=jspi` opt-in with both
`WebAssembly.Suspending` and `WebAssembly.promising` and the artifact present. Missing API/artifact selects
Asyncify. A selected artifact integrity/compile failure still fails, not a hidden retry. In JSPI-only
packages, missing API or an explicit Asyncify request is a clear load error. Both backends verify the
selected artifact size/hash before instantiation.

## Test-mode capability policy

Runtime fallback is user-facing policy, not proof of JSPI test coverage. Browser tests using
`tests/e2e/fixtures.ts`’s `openGame` with `suspension: 'jspi'` (including `BGT_E2E_SUSPENSION=jspi`)
inspect the browser APIs and the routed manifest before boot. Both must be present: a dual
`manifest.variants.jspi` or a JSPI-only `manifest.suspension: 'jspi'` counts as an artifact.
Missing capabilities skip with a reason naming the browser API and/or artifact. With
`BGT_TEST_JSPI=1`, either missing prerequisite fails instead. Build with
`BGT_SUSPENSION_BUILD=dual` to require both artifact modes. Once admitted, the test asserts
that the runtime actually selected JSPI. Only tests deliberately checking loader fallback/errors
may opt out with `{allowSuspensionFallback:true}`; those tests assert the fallback explicitly.

`diagnostics.suspensionSelection` reports the effective `requested` mode (explicit choice,
manifest preference or default), browser `supported` flag and `variantPresent` flag even when
selection fails. Together with `diagnostics.suspension` these distinguish missing browser
support from missing artifacts without changing the runtime's fallback policy.

## Why Node heap flags do not fix the scale failure

The pinned npm Binaryen 132 CLI is an Emscripten **wasm32 program**, not native Binaryen. Its linear-memory
ceiling is **4,294,901,760 bytes** (4 GiB minus one page), separate from Node and guest wasm memory.
A CC0 fixture with 10,438 distinct arithmetic owners, 32 live locals per owner, an indirect call and three
deeper calls at each suspension exhausts that heap during parsing, **even without O2 or Asyncify**.
The same function/local counts with shorter bodies parse successfully. Neither a function-count cap nor
a particular O2 pass bug is necessary to reproduce this class. The raw-byte threshold depends on IR shape,
not a universal 204 MB limit. Original MP2 CppException evidence was supplied, not re-executed game code.

`tools/build/binaryen-runner.mjs` executes the pinned CLI in its own CommonJS scope with diagnostic-only
exception/heap reporting: failed growth requests, actual ceiling, and C++ exception type when available
(including `std::bad_alloc`). No dependency/tool asset is edited. Unsupported wrapper internals fail clearly.
Raising `--max-old-space-size` cannot raise the Binaryen linear-memory ceiling.

## Bounded post-link transform

`tools/build/asyncify.mjs` retains whole-module O2/Asyncify for code sections up to 32 MiB. Above that it
batches original function bodies into 8 MiB targets (whole functions; one function may exceed the target).
Each batch retains all declarations/imports/tables/globals/elements/data, preserving index spaces and
indirect-call signatures. Non-batch bodies are analysis-only placeholders, **never shipped or executed**:
yield-then-trap for a function in the suspension set, trap otherwise (K65, below).
No `asyncify-ignore-indirect` shortcut is used.

### Exact suspension set (K65, default)

Before K65 every placeholder yielded, so every caller of a function in another batch, and every function
with any `call_indirect`, was instrumented: on a CC0 exact-emitter fixture the partitioned artifact
instrumented 4,768 functions instead of 2,393 (all generated `R_` regions) and ran **3.63x** slower than
JSPI. Now `tools/build/wasm-callgraph.mjs` scans the whole linked module once (no IR, no instantiation;
MVP + bulk-memory/sign-ext/sat-conv opcodes, anything else fails closed) and computes the functions that
can reach `bgt.yield`:

- direct `call`s, propagated backwards to a fixed point;
- every `call_indirect` whose signature equals that of any suspending function that can be in a table
  (all element segments, every `ref.func`, and, if a table is imported/exported, every exported and
  imported function);
- removelisted generated native steps (`N_*`) are cut points, exactly as before (they neither suspend nor
  propagate). The runtime now checks that invariant at the single `bgt_yield` site (`wait_host`):
  `x86_check_suspendable()` counts a yield with a native step frame live (`native_step_suspensions`) and,
  in the Asyncify artifact only, faults instead of unwinding through it. JSPI suspends any stack
  correctly, so there the event is only counted: an analysis miss still shows up when testing a dual
  build under JSPI. The artifact is identified by a 16-byte marker in `x86_rt.c` data that
  `asyncify.mjs` rewrites (`...JSPI` -> `...ASYN`) in the Asyncify output only (`asyncify_artifact` metric).

The set goes to every Binaryen run as an exact `asyncify-onlylist` response file (canonical per-index
identities; Binaryen forbids combining it with a removelist). Whole-module mode runs `-O2` first and
computes the set on the optimized module, then runs Asyncify at `--optimize-level=2` without repeating
O2 (planning before O2 is unsound: inlining a cut native step moves its calls into its caller). Partitions
plan once on the raw module (unchanged index space, local passes only). All name lists (onlylist and
removelist) travel as Binaryen response files (`asyncify-onlylist@@FILE`), never as one argv string
(Linux limits each to 128 KiB; x64-scale's 12,078 step names are ~133 KB).

A table that can receive values the scan cannot enumerate (`table.set`/`table.grow`/`table.fill`, an
element expression reading a global such as an imported funcref, or an imported/exported table) is
**opaque**: every `call_indirect` site is then treated as suspending, as Binaryen does. Tables with an
initializer expression or a typed reference element type (GC/function-references) are refused outright.

The published artifact is re-analysed (`verifyAsyncify`) twice: (1) every function in the model's set
must reference the Asyncify state global; (2) an independent local closure check on Binaryen's actual
instrumentation: no uninstrumented, non-cut function calls the yield import or an instrumented function,
or `call_indirect`s a signature carried by an instrumented/suspending table entry (any signature if the
table is opaque). (2) does not use the propagation model; by induction no uninstrumented frame can be
live at the yield except below a cut point (runtime-guarded). Residual shared trust: the opcode decoder,
the table-target enumeration, and that a state-global reference means Binaryen instrumented the
function's call sites. Either failure stops the build with a call chain; nothing is published.

Re-entrancy: a host import whose JS calls back into a wasm export that yields would suspend across a
JS frame (Asyncify cannot unwind it, JSPI cannot suspend it). The runtime counts every host-to-wasm
entry through `host.exports` (including `bgt_update` and `bgt_profile_abort`) and allows the yield only
from the outermost update (one entry under Asyncify, none under JSPI, whose `bgt_update` is the raw
promising export); otherwise it refuses with a clear error (`GameAbort`). Dev/test `rawExports` are used
only for the generated checkpoint accessors (no calls), so they cannot re-enter.
`BGT_ASYNCIFY_ANALYSIS=binaryen` keeps the previous analysis for A/B. Every Asyncify artifact now carries
the standard function-name section (profiles show names, not `wasm-function[N]`).
`manifest.pipeline.metrics` records `asyncify_analysis`, `asyncify_functions`, `asyncify_suspending`,
`asyncify_instrumented` and `asyncify_partitions`. Measurements: [K65 handoff](handoff/K65.md).

Only fixed function-local optimization passes run before/after Asyncify. Interprocedural O2, inlining, DCE
and propagation across placeholders are forbidden. Exact generated non-suspending native-step exclusions
are preserved through short canonical per-index identities; duplicate/absent names cannot silently change
index mapping. Original names are restored in the shipped name section. Overrides and suspending wrappers stay instrumented.
The output may be larger/slower than whole-module O2: an explicit resource/optimization tradeoff.

Before publication: every original body must be transformed exactly once; all non-code sections and final
function maps must agree; helper bodies must agree; original definition indices must be unchanged; and V8
must validate the assembled wasm. Binaryen's writer must use `--preserve-type-order`: even without a
reorder pass, its default usage-frequency type ordering can otherwise differ between shards (caught by the
I12 convergence fixture). Type/import/function section equality remains mandatory; no mismatch is waived.
Checks fail closed. One state pair/helper set serves the entire result.
Cache identity includes Binaryen, wrapper/partition/call-graph code, features, names policy, analysis mode and exact removelist.
Existing atomic per-key publication and writer leases protect the entire job and child tools.

This bounds body IR per child, not all build memory: metadata/data/tables, output assembly and the largest
individual function remain costs. A >16 MiB body fails preflight with split-function/JSPI-only guidance.
Unsupported options/index layouts fail explicitly; no unverified fallback is published. Native/wasm64
Binaryen is an alternative toolchain direction, not a dependency installed by this lane.

## Reproduction

Original CC0 post-link stress input: real executable code, no padding/custom-section size inflation.

```sh
node tools/build/suspension-fixture.mjs reports/scale.wasm 10438 1800
node tools/build/binaryen-runner.mjs reports/scale.wasm -O2 --asyncify --pass-arg=asyncify-imports@bgt.yield -o reports/old.wasm
node tools/build/asyncify.mjs reports/scale.wasm -O2 --asyncify --pass-arg=asyncify-imports@bgt.yield -o reports/scale.asyncify.wasm
node --experimental-wasm-jspi tools/build/suspension-oracle.mjs reports/scale.wasm reports/scale.asyncify.wasm reports/scale-oracle.json 10438 1800
```

The mathematical oracle checks all 10,438 owners in 300 driver frames, 35 real deep suspensions/frame,
live-local results, and raw/JSPI/Asyncify checksum equality. Driver frames are not game display frames.
Regressions cover duplicate/absent names, exact native exclusions, real C++ pipeline behavior, rejected
assembly mismatches/options/oversized functions, and both Chromium backends with JSPI-only success and
missing API/fallback errors. Full Tier 1 and measurements: [K22 handoff](handoff/K22.md).

Final CC0 scale result: **417,126,367 B input →423,672,537 B Asyncify**,50 partitions in1445.22 s,
1.50 GB max RSS /1.87 GB peak physical footprint; all300 mathematical/raw/Asyncify/real-JSPI frames match.
The final bounded x64-scale pipeline artifact is68,776,752 B versus53,507,356 B JSPI; median300-frame
batches43.910/30.290 ms and verified loopback loads156.755/121.150 ms. Other fixtures have mixed load/speed
results; these shared-machine/no-rasterization measurements do not establish a universal JSPI benefit.
[All timing samples and hashes](handoff/K22-variant-measurements.json),
[full gate/oracle/browser audit](handoff/K22-gate-evidence.json).
