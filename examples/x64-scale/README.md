# Original CC0 AMD64 scale fixture

`generate.mjs` is original CC0 code, not game-derived. It deterministically generates **12,000** distinct,
non-inlined functions in 60 translation units, plus a driver. Normal Zig/MinGW **-O2** compilation, the normal
CRT startup, and `.pdata` discovery yield **12,078 functions / 1,609,529 lifted instructions**. Each generated
function has an eight-way switch, unsigned integer mixing and double-precision SSE arithmetic. A retained function
pointer table drives indirect calls. The driver uses malloc/free/snprintf and reports the checksum through
OutputDebugStringA; no host execution of a Windows executable is involved.

The **same generated C** is compiled by native `cc -O2` in `tests/unit/build-chunks.test.ts` and its checksum is
compared with the browser-target result: **`scale checksum 31c9ceb2 functions 12000`**. After startup, the guest
continues exercising indirect calls and distinct functions, reporting changing `scale tick` values every 60 frames.
Both browser backends assert the checksum and tick 240 after 300 frames, zero interpreted instructions, no stubs,
no runtime errors. The differential oracle independently compares all 300 frame traces against interpretation.
This is a generated CPU/build stress test, **not a representative engine renderer, game, or compatibility claim**.

```sh
node tools/build/build.mjs examples/x64-scale
npm run oracle -- examples/x64-scale 300
# Full native-reference, cache, loader, and browser regressions are in the normal suites:
npm test
npm run test:e2e
```

## Reproduce measurements

```sh
# Use your own dedicated test port, never the developer's 5173.
BGT_CHUNK_INSNS=0 node tools/build/measure.mjs examples/x64-scale reports/scale-before.json
# Preserve the baseline output under an ignored, separately named directory for browser comparison.
cp -R web/public/games/x64-scale web/public/games/x64-scale-before
node tools/build/measure.mjs examples/x64-scale reports/scale-after.json
node tools/build/measure-browser.mjs reports/scale-browser.json x64-scale-before:buffered x64-scale
rm -rf web/public/games/x64-scale-before
```

`BGT_CHUNK_INSNS=0` preserves monolithic lifting/compilation. Default: 32,768 instructions per chunk, grouping
**whole guest functions** (an oversized function gets its own chunk). Set `pipeline.chunkInstructions` or the
environment override to 256..1,000,000. i386 stays on the existing path. `pipeline.coverage` / strict slices keep
using the existing recorded/static-call-closure selection; unselected code remains interpreted unless a strict
slice stops it. There is no lazy code ABI or change to the guest instruction emitter.

Cold lift jobs each repeat bounded native analysis because x86tool has no analysis-snapshot input. This explicitly
trades cold lift time for bounded compiler memory and parallel, reusable chunk products. Warm builds reuse
analysis, lift chunks, objects and Asyncify output. A changed input binary/base, lifter, selection, overrides or
codegen options invalidates lifting. C source, named headers, compiler identity and flags invalidate objects.
Each chunk's generated registry is checked and merged into one sorted module registry without changing addresses,
function bodies, internal regions, callbacks or interior resumptions.

`BGT_BUILD_JOBS` defaults to 2 (maximum 8); generated Windows fixture compilation is also bounded. Object and
Asyncify caches each default to **512 MiB**, adjustable with `BGT_CACHE_MAX_MB`; LRU collection protects active
builds with leases. Active build sets can temporarily exceed the budget. Per-game kernel locks serialize source
and output writers, including check builds; leases coordinate shared object caches across games. No stale lock
pathname is deleted. Interrupted lift publication invalidates its previous marker before payload replacement.
Obsolete chunk intermediates, prior monolithic C, and obsolete generated-fixture objects are removed.

`measure.mjs` samples logical disk bytes every 250 ms in the kit cache/output and explicitly configured Zig caches.
It includes retained unrelated kit fixtures; it is not block allocation or an exact high-water mark for sub-sample
scratch files. `peak_child_rss_bytes` covers compiler/linker children; `parallel_rss_upper_bound_bytes` is a
conservative jobs × largest-child bound, **not measured aggregate RSS**. The external `/usr/bin/time -l` measurement
also includes fixture compilation and Asyncify. Browser byte compilation/instantiation are measured separately
from first-frame runtime startup, three fresh Chromium processes per phase, loopback WebGL2/SwiftShader.
The buffered baseline uses the current loader's MIME fallback, not a historical runtime checkout. SHA-256 still
needs the whole downloaded buffer; streaming overlaps compilation with fetch but does not eliminate this buffer.
As before, insecure contexts without SubtleCrypto cannot verify hashes. No module is instantiated until the
available verification and manifest-size checks finish. Size limits run upstream of streaming compilation.

See [scale handoff](../../docs/handoff/scale.md) for results, check counts, exclusions and extrapolation.
