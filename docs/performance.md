# Measuring performance (K51)

Before K51, three things made game performance numbers unreliable: every WebGL2 measurement ran on
SwiftShader, all frame times came from back-to-back `step(1)` probes instead of the page's own loop, and perf
builds still recorded coverage. This page says how to get numbers you can trust.

## 1. Real-GPU WebGL2

Chromium on Apple silicon (ANGLE Metal) reports `MAX_UNIFORM_BLOCK_SIZE = 16384`. That is the WebGL2 /
GL ES 3.0 / desktop GL 3.3 minimum. The WebGL2 CAP_GPU gate used to require 65536, so it refused the real
GPU, and GL games only ran on the SwiftShader software rasterizer. The gate now requires 16384. The limit
above that is reported honestly:

- §13.6 `gpu_limits` offset 52 (`max_uniform_range`) is min(65536, the native limit rounded down to 16).
  WebGL2 takes it from `MAX_UNIFORM_BLOCK_SIZE` and WebGPU from `maxUniformBufferBindingSize`, which is 65536
  by default. `UNIFORM_BUFFER` ranges above it are `E_LIMIT`. A backend never binds a larger native range.
  A restored device that reports less than the advertised value is unrecoverable.
- The WGL profile returns that value for `GL_MAX_UNIFORM_BLOCK_SIZE`. A user std140 block above it fails
  compile/link with a `GL_MAX_UNIFORM_BLOCK_SIZE` info log. Ordinary (default-block) uniforms get up to
  min(16384, limit) bytes. That is 4096 components, which is what ANGLE Metal accepts. When the profile's own
  meta and sampler-swizzle words would not fit beside them, those words move to a separate internal block in the
  next free slot, so they are not charged to the guest. A program with 7 user blocks has no free slot left: if its
  default block does not fit inline, the link fails with a `GL_MAX_UNIFORM_BLOCK_SIZE` info log. An oversized `glBindBufferRange` is legal GL and draws with the linked block size.
- A WebGPU→WebGL2 fallback is allowed only without live GPU resources. It creates a new GPU namespace with the
  WebGL2 value, which can be lower. Programs linked after the fallback use the new value. Nothing is relinked:
  a `GL_MAX_UNIFORM_BLOCK_SIZE` the guest queried before the fallback is stale, and a later link of a block above the
  new value fails with an explicit info log. A device restored below the advertised value is unrecoverable.
- `diagnostics().gpuDevice` = `{renderer, software, nativeMaxUniformRange, maxUniformRange, languages}`.
  It is captured once at init. `software: true` means SwiftShader, llvmpipe or WARP.

`npm run probe` fails, and `npm run bench:page` marks the run skipped, if a native-GPU WebGL2 run lands on a
software renderer without `--software`. probe.json records `device` and `software`. The page-loop log is
allocated only while `measurePage` runs, so production pages pay a null check per tick.

Launch flags: Playwright's default headless shell renders WebGL2 with **SwiftShader**. Use `--use-angle=metal`
(macOS) or a headed browser to get the GPU. `BGT_WEBGL2_GPU=1` runs the `chromium-webgl2` e2e project on the
native GPU (K66: and the `port-webgl2` port project, with the same launch); without it, those projects stay the
software CI gate. `npm run probe` and `npm run bench:page` use
the native GPU for both backends. Their `--software` flag forces SwiftShader for an A/B comparison.

## 2. Real-page frame rate: `npm run bench:page`

```sh
npm run bench:page -- --game x64-smoke [--backends webgl2,webgpu] [--modes asyncify,jspi] \
    [--window-ms 5000] [--warmup-ms 1500] [--headed] [--software] [--out reports/page-fps]
```

The page's own `requestAnimationFrame` loop drives the game. There are no `step()` calls. The runtime keeps a
bounded log with one entry per rAF tick, one per busy tick (an update or render was still running), and one
per completed canvas present. Each entry is a few typed-array writes. `__BGT_TEST__.measurePage(windowMs,
warmupMs)` does the run: it resumes the loop, warms up, measures one fixed wall window, and pauses again.
`bgt/runtime/page-fps.ts` reduces that window to the `game-cask/page-fps/1` summary:

| field | meaning |
|---|---|
| `presents_per_second` | completed canvas presents in the window / window seconds |
| `frame_ms.{mean,p50,p95,max}` | intervals between consecutive canvas presents |
| `updates_per_present` | host updates per canvas present (pipeline games: at most 1) |
| `guest_presents_per_second`, `guest_presents_per_page_present` | native SwapBuffers/GDI presents over the same window |
| `raf_per_second`, `busy_ticks` | the loop's ceiling, and ticks skipped because work was still running |
| `transport_updates`, `max_updates_per_tick` | K66: updates a tick ran after a time-neutral transport yield, and the most updates in one tick |
| `burst_renders` | vK66: intermediate renders inside such bursts; never counted as presents (a burst tick has one present carrying all its updates) |

The tool writes `<out>/<game>.json`. Each run row holds the summary, the renderer/adapter string, the actual
backend and suspension mode, and errors. It also records the machine's resources at start and end. A run that
falls back to another backend or mode is reported as skipped (exit 1), never silently counted. Headless rAF
is not a display vsync, so read `raf_per_second` next to `presents_per_second`. Use `--headed` for numbers
paced by the display.

**Loop pacing fix (found by this tool).** The K50 pipeline loop ran at most one update per rAF tick. It then
reset the accumulator to zero after every update. A 60 Hz rAF delivers ticks of about 16.66 ms, just under the
16.667 ms step, so updates happened only on every other tick. x64-smoke reached 34 presents/s on both
backends. `retainedAccumulator` (`bgt/runtime/page-pacing.ts`, shared with K50) now keeps up to one step of remainder, so a stall still drops
its backlog, and the result is 60 presents/s. Native BGT catch-up is unchanged.

**Transport bursts (K66).** A blocking load (Win32 ReadFile in <= 64 KiB range requests, GL readbacks, shader
results) yields to the host once per request, without presenting or advancing guest time. One update per rAF tick
capped such a load at 60 requests/s (Mega Man X8's stage load: 108 s on the page, 14 s back-to-back). The page loop
now renders such an update and runs the next one in the same tick, up to a 12 ms wall budget (`?ioburst=N` sets it,
`?ioburst=0` restores one update per tick for A/B), stopping at the first update that presents or crosses a
guest-time boundary. The guest sees exactly the update sequence of back-to-back `step()`; normal frames keep one
update per tick. `__BGT_TEST__.pageLoop()` returns `{ticks, updates, transportUpdates, maxUpdatesPerTick}` since load.
Fixture: `examples/x64-file-load` (768 small reads of a streamed 4 MiB file), spec `tests/e2e/file-load.spec.ts`.

**Burst waits for renderer results (K70, Q126).** On WebGPU, shader compile status, stage modules and readbacks
resolve asynchronously in the renderer, not in host file I/O. A burst used to re-run the polling update at once:
~1000 updates per tick (32k/s), each with its own render and submit, which also flooded the GPU process and delayed
the result itself (~190 ms per program). The burst now waits, within the tick budget, for the request the last update
polled unresolved (`Requests.awaited()`); `pageLoop()` adds `requestWaits`, `requestWaitMs`, `requestWaitTimeouts`;
`?iowait=0` is the A/B switch. Fixture `examples/x64-gl-programs` (24 programs: 2 compiles, 2 link stage modules and
one glReadPixels each), spec `tests/e2e/gl-programs.spec.ts`.

**JSPI artifact optimization (K70, Q127).** The JSPI artifact (dual `game.jspi.wasm`, JSPI-only `game.wasm`) gets
the same bounded Binaryen pass as the Asyncify artifact without `--asyncify` (`tools/build/asyncify.mjs`: whole-module
-O2 up to 32 MiB of code, function-local passes over 8 MiB partitions above), the name section kept and no Asyncify
marker. Content-keyed cache `jspi-opt` (key: `asyncifyCacheKey(..., {variant: 'jspi-O2'})`); manifest metric
`pipeline.metrics.jspi_opt` = `{linked_bytes, ms, cached, mode, partitions}`. `BGT_JSPI_WASM_OPT=0` ships the raw
link output (A/B). Dual builds run the Asyncify and JSPI passes sequentially (peak Binaryen memory of one pass, up
to 4 GiB each for 273 MB modules on 16 GB machines); cache keys hash the exact transform arguments.

## 3. Performance builds without coverage

`BGT_COVERAGE=off npm run build:port`, or `node tools/build/build.mjs <dir> --no-coverage`, compiles coverage
recording out (`X86_COVERAGE_MODE=3`):

- every generated `x86_coverage_lifted` hook and the runtime interpreter-entry hook preprocess away;
- interpreter coverage rows are not recorded;
- the wasm no longer imports `coverage_entry`.

Metrics report `coverage_mode: 3` with `null` coverage counters. The manifest records
`pipeline.instrumentation.coverage: "off"`. Coverage snapshots carry `recording: "off"`, and slice
packaging rejects them. You cannot combine this flag with `--slice`: strict builds already record nothing and
keep their membership checks. You also cannot combine it with `BGT_COVERAGE_DIRECT=1`.
`tests/unit/coverage-off.test.ts` checks these artifacts on i386 and AMD64 in both suspension modes. It
checks the missing import, the flags and the manifest. It also checks that the API trace matches the normal
build and the interpreted oracle.

`pipeline.instrumentation` also records `cpuProfile`, `accounting`, `dispatchCounters` and `ownerCensus`.
Use it to tell which build a measurement came from.

## 4. Owner census: `BGT_OWNER_CENSUS=1`

This is an opt-in census of retired guest instructions per lifted-function owner. It is off by default.
It implies exact accounting (`BGT_CPU_ACCOUNTING=1`) and is refused with `BGT_CPU_ACCOUNTING=0`.

Both lifters name a static owner once per function or region (`XR_OWNER`). They commit lifted retirement
through `XR_LIFT`. In a default build, `XR_OWNER` is empty and `XR_LIFT` is exactly `x86_retire`, so the
generated wasm does not change. Generic and interpreted retirement is attributed to the analyzed owner whose
range holds the instruction address. Interpreted code outside every owner range goes to owner `0xffffffff`
(`unowned`). The table has 16384 slots (`capacity`) and uses at most 3/4 of them, so it can attribute
**12288 owners**. Instructions of later owners are counted as `unattributed`; they are never lost silently.

`metrics.owner_census`:

- `enabled`, `capacity`, `top_n` (32), `rows`, `unattributed`;
- `cumulative.{total, rows}`;
- `frames` (an 8-entry ring of native-present snapshots): each has `present`, `total`, `unattributed`,
  `active_owners` and its top-32 `rows`.

Each row has `owner` and exact decimal-string `total/lifted/generic/interpreted`. Rows are ordered by total,
then by lower owner address. A frame covers the work between two consecutive native guest presents, on all
guest threads. `metrics.execution_summary.owner_census` is the numeric view: owner as a hex address, a share
of the table total, and a `last_frame` table. OFF builds report `{enabled: 0, cumulative: null, frames: null}`.

`tests/unit/owner-census.test.ts` checks hand-counted owners. It covers i386 and AMD64, lifted and
interpreted, and both suspension modes. It also covers a generic CPUID charged to its lifted owner, and checks
that per-present frame totals equal the exact accounting deltas. Measured overhead is in
[K51](handoff/K51.md).

## 5. Memory and load (K64)

**Memory attribution.** `diagnostics().memory` (also `__BGT_TEST__.memory()`) splits what the runtime owns:

| field | what it is |
|---|---|
| `wasm.linearBytes` / `peakLinearBytes` / `initialBytes` | linear memory now, its high-water mark, and the module's declared initial size |
| `wasm.moduleBytes` | the selected game.wasm artifact; `compiledBytes` is `null` (engine machine code is not observable) |
| `guest` | Win32 profile only: `committedBytes` (highest flat-guest address mapped), `heapBytes`, `virtualLiveBytes`/`virtualPeakBytes` (VirtualAlloc; reserve = commit in this profile), `host*` (runtime/GL/CRT/file host arena), `glFrontendBytes` (guest-side GL data copies). All of it lives **inside** linear memory |
| `gpu.reserved` | the §13 decoder's reservation by kind (buffers/textures/shaders); sums to `reservedBytes` (the budget accounting) |
| `gpu.native` | what the backend executor allocated, from its own tables: buffers (guest and padded sizes), textures (allocated levels; depth/stencil part), renderbuffers (always 0: attachments are textures), internal (logical screen, WebGPU rename pool, scratch) |
| `gpu.canvasBytesEstimate` | canvas drawing buffer + one swap buffer, RGBA8 |
| `js` | JS-heap copies: preloaded assets, stream chunk cache, decoder buffer shadows (`gpuDecoderShadowBytes`), executor recovery shadows (`gpuRecoveryShadowBytes`), v0.2 texture-table shadows, queued audio, and Chromium's `usedJSHeapSize` when present |
| `estimate` | `totalBytes` = wasm linear + module bytes + GPU native + JS held (disjoint), the budget and `status`. `peakTotalBytes` is a **sampled** high-water mark (`peakSampling`): the maximum over samples at load milestones (game.wasm compiled, counting its still-held download buffer as `js.loadBuffersBytes`; instantiated; initialized; ready; first frame), every 30 presents and every read. Spikes between samples, and engine-internal compile buffers, are not seen |

The **budget** defaults to 1.5 GiB (iPhone-class tab). Override with game.json `"memoryBudget": {"bytes": N}` (copied to
the manifest), `?memorybudget=1536m|1.5g|BYTES` or `RuntimeOptions.memoryBudgetBytes`. `status: "over-budget"` is a
warning, never a failure. The estimate is not process RSS: compiled code, browser/driver overhead and the JS engine are
excluded. **Real-device memory (iPhone Safari WebContent + GPU process) is a hardware gate**: report it separately, e.g.
from Xcode Instruments / Safari Web Inspector Timelines, next to this estimate; the difference is mostly compiled code.

**Load metrics.** `diagnostics().load` (also `__BGT_TEST__.loadMetrics()`) has the phase marks since load start
(`manifestMs`, `wasmMs`, `assetsMs`, `readyMs`, `firstFrameMs`, `firstUpdateMs`), spans (`instantiateMs`, `initMs`),
and for game.wasm: streaming compilation and why not (`streamingReason`: `wrong-content-type`, `no-body`,
`no-compileStreaming`), Content-Type/Encoding, resource-timing transfer sizes and the compression ratio.
`timeToFirstInteractiveUpdateMs` is the first completed update once ready (input is live from there); measure without
`?paused=1`.

**Packaging tool.** `npm run package:metrics -- --game ID [--serve] [--browser] [--url BASE] [--brotli 11]` writes
`reports/package-metrics-ID.json`: raw/gzip/brotli sizes per artifact kind (wasm, js, data, meta), how the server sends
game.wasm (MIME → streaming compile, Content-Encoding) and, with `--browser`, a free-running Chromium load with the
load phases and memory breakdown. The Vite dev server sends `application/wasm` (streaming compile) **uncompressed**.
`npm run bundle -- --game ID --precompress` writes `.br`/`.gz` next to compressible bundle files for hosts with
precompressed serving; verify a deployment with `--url`.
