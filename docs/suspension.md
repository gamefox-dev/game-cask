# Suspension artifacts and large modules

The guest ABI is unchanged: only `bgt.yield` suspends, only inside update, resuming at the exact call site.
This policy is backend-independent (WebGL2 and WebGPU), not a coverage/selection optimization.

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
indirect-call signatures. Non-batch bodies are analysis-only yield-then-trap placeholders, **never shipped
or executed**. They conservatively overapproximate original cross-batch/indirect suspension edges.
No `asyncify-ignore-indirect` shortcut is used.

Only fixed function-local optimization passes run before/after Asyncify. Interprocedural O2, inlining, DCE
and propagation across placeholders are forbidden. Exact generated non-suspending native-step exclusions
are preserved through short canonical per-index identities; duplicate/absent names cannot silently change
index mapping. Profile sidecars restore original names. Overrides and suspending wrappers stay conservative.
The output may be larger/slower than whole-module O2: an explicit resource/optimization tradeoff.

Before publication: every original body must be transformed exactly once; all non-code sections and final
function maps must agree; helper bodies must agree; original definition indices must be unchanged; and V8
must validate the assembled wasm. Checks fail closed. One state pair/helper set serves the entire result.
Cache identity includes Binaryen, wrapper/partition code, features, names policy and exact removelist.
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
