# Deterministic test savestates

This is a **test/harness capability**, not a game save format or a new BGT ABI.
Enable it **before boot** with `?deterministic=1&paused=1` (alias `savestates=1`), in a dev
or `VITE_BGT_TEST=1` build. Without this explicit flag snapshot/restore throw. Plain production
builds do not install `__BGT_TEST__` or enable the deterministic services/module instrumentation.
Port tests may use the same flag without taking any snapshots.

## Contract and boundary

`await __BGT_TEST__.snapshot()` returns an in-memory structured-cloneable checkpoint;
`await __BGT_TEST__.restore(checkpoint)` replaces the instance without running guest initialization
or replaying the input route. Both require a **paused, quiescent, consumed update boundary**:
finish `await step(...)` first. Concurrent steps/renders/checkpoints, unsettled requests,
unconsumed commands, failed/outside-slice instances and lost devices are rejected, not guessed.
Initial resource commands must have been consumed (normally by the first step).

- **Asyncify:** supported while parked at `bgt_yield`. The unwound C stack, Asyncify data and state,
  shadow stack pointer and all other numeric wasm globals are captured. The original suspended
  update resumes at precisely the saved callsite; it is not restarted.
- **JSPI:** supported when `bgt_update` actually **returns**, including returnable Win64 pipeline
  presentations in dual artifacts built with the checkpoint handshake. At such a presentation the
  outer dispatcher records the continuation in wasm, returns to JS, and resumes dispatch on the next
  update. This is the real JSPI artifact, not boot replay or an Asyncify fallback. A live engine-owned
  stack (for example a native callback, scheduler budget wait, or I/O transport yield) is not portable.
  Snapshot and restore refuse it before touching guest state with
  `Unsupported checkpoint state: suspended JSPI continuation (not a returnable frame boundary)`.
  For in-flight steps/I/O, the general quiescence guard can reject first. Continue stepping to a
  returnable presentation, or select Asyncify at boot if arbitrary supported yields are needed.
- Same artifact/manifest, seed/arguments, suspension mode, backend and canvas dimensions are
  required. Same-backend reruns are exact; this does **not** promise bit-identical pixels across
  GPU vendors, browser versions or WebGPU versus WebGL2. Reload on device loss before capturing.
- Checkpoints are versioned private debugging artifacts. Import only files you trust. A checkpoint
  contains the game's memory/assets/uploads/storage; never commit proprietary checkpoints.

## Deterministic environment (explicit opt-in)

Ordinary browser tests previously used real wall time and Web Crypto. They remain unchanged.
Deterministic mode instead uses:

| Service | Test semantics |
| --- | --- |
| Guest `time_us` | Native BGT: completed updates × 16667 µs. Win32 profile: read-only `bgt_guest_time_us()` virtual clock, including nominal instruction-rate progress; render/observation does not advance it |
| Entropy | xorshift32 seeded by `seed` (zero maps to 1), one low byte per advance; **not cryptographic** |
| Audio | no physical playback; 48000 Hz simulated queue, capacity 14400 frames. Drains against the same guest clock at update, queue and push observations (native BGT: 800.016 frames/update); push reports admitted frames, queued rounds to an integer |
| Storage | initially empty isolated memory map; no localStorage writes/reads |
| Input | scripted events only; no physical keyboard, pointer, touch overlay or gamepad polling |

`step(n)` remains n consumed host updates, not a promise of n guest presents. Win32 quanta rotate threads
within an update; presentation/cap/idle/legacy waits end clock frames, while external transport yields need
not advance the clock. The nominal CPU rate, idle deadline jumps, vsync snapping and configured instruction
cap are deterministic model inputs ([THREADS.md](../platforms/win32/THREADS.md)). Artifact/configuration
identity prevents silently using pre-K50 checkpoints/recordings with the new model. The simulated sink
also checkpoints its last-drain guest timestamp, so restore cannot drain against a later branch clock.

Guest scheduler/threads, TLS, file/GL object tables, timers, TSC, guest clock and PRNG already live
in wasm memory and are restored unchanged. Host profiling uses real time and is **not** a restored
physical performance measurement. Host diagnostics/log history are not a game-state oracle.
A route found here is guaranteed only in this deterministic environment. It can become a complete-loop
port regression by replaying from boot with `deterministic=1`. Games that read host wall time,
entropy or audio admission may behave differently in ordinary play; do not claim universal transfer.

## What is saved / how graphics are restored

- Entire wasm linear memory (including grown pages), all numeric globals (including hidden compiler
  globals), function tables with null slots/function-index identities. Test-only load instrumentation
  adds exports and bitwise float-global accessor helpers after artifact integrity verification;
  existing function/global/table indices remain unchanged. With multi-memory and supported opcodes,
  test-only store and bulk-write barriers plus host write tracking capture touched 64 KiB pages relative
  to the fresh module image (including explicit zero overwrites). This is cumulative since instantiate,
  not since the last checkpoint. Without tracking, capture uses the exact sparse zero-page scan.
  Saved length restores growth exactly; a **fresh wasm instance** makes memory/table growth reversible.
- Host lifecycle/suspension/frame/input state, texture and GPU validator object tables, completed request
  data/error/visibility epochs/next IDs, file handles/cursors/next IDs and coverage, input held/latched/
  released/gamepad/pointer/touch/event state, deterministic clock/entropy/audio/storage.
- An opt-in ordered **renderer-input journal from startup**, including uploads, shaders, buffers,
  texture/VAO/pipeline/FBO equivalents, copies, draws, render-to-texture/depth/stencil and deletion.
  Snapshots materialize a compact live-resource base at a proven cut, reading actual GPU
  contents at the residual START (from the live renderer for an end cut, or an isolated
  same-backend replay for an earlier cut). Restore rebuilds that base and bounded residual in a
  fresh renderer, then swaps the host/renderer. Guest updates/initialization are not replayed. Native buffer data and its
  separate CPU validation/repacking shadow are both preserved, as are texture upload/mipmap
  recovery metadata (never replaced by rendered native contents). Physical retained screen and
  (WebGPU) logical screen are transferred separately, along with legacy render targets.
  Completion callbacks are replaced with replay-local plumbing; original request results come from
  the checkpoint, never from replay into the original request table. Settled replay shader callbacks
  are released; the parked renderer's census charges the retained shader descriptors and sources.

Restore work is bounded by **live resources plus at most two updates / 100,000 residual commands**,
not route length. Packed depth-stencil has no portable exact WebGPU readback. Exact per-mip,
per-aspect constants from native initialization (depth 1 / stencil 0) and full clears are tracked
and emitted as native aspect clears in the compact base. Potentially writing draws invalidate
the affected aspects according to immutable depth-write / stencil-enable, masks and operations;
partial clears, uploads and destination blits invalidate conservatively. Constants are never
inferred from shader output, likely coverage, depth-test results or stale upload shadows. Explicit
unknown-aspect metadata survives file transfer and repeated compaction, so fresh native allocation
cannot invent a proof. Every **unknown** pre-cut aspect must be fully cleared or overwritten before
any residual read/draw and before the snapshot end (or deleted without being consumed). Complete PASS_BEGIN load-clears and full-extent,
unmasked CLEAR_BUFFER operations prove resets; scissored/masked/partial clears do not. If no safe
common frame-boundary cut exists in that window, snapshot throws an explicit provenance error,
rather than omitting stencil or keeping unbounded replay work. Resources deleted/reused during the
residual remain in exact order. Handled failed shader compiles are replayed as failed objects;
deleted objects are removed from the base. Other native failed mutations currently fail the
checkpoint explicitly: a backend may have partially changed state before reporting its error.

The opt-in recorder rolls the journal at 128 recorded frames, 128 MiB of estimated journal data or
50,000 commands, or sooner if another frame the size of the last would exceed retained capacity.
This does work during lead-in steps, not normal play. Readback-safe
end cuts use the live renderer. Packed depth/stencil cuts can advance an isolated renderer parked at the
previous cut instead of re-uploading the compact base. Native contents come from readback except where
a full RGBA8 upload plus the subsequent command history proves the upload shadow exact. Rendering to
the level, destination blits and mip generation invalidate that proof.

An unsupported cut is retried after new frames. At **256 frames / 512 MiB / 200,000 commands** or the
**1 GiB retained limit**, the recorder tries a safe cut with the just-consumed frame before dropping history.
If no cut fits, capture fails closed with `Savestate GPU journal exceeded bounded history without a safe cut`;
stepping still works and an earlier valid checkpoint can be restored. If a bounded resource/provenance
recipe survives, capture also recovers at a later, in-budget live cut (for example after a full packed
clear or deletion). Recovery copies current host shadows for static legacy textures and reads GPU-written
legacy targets without presenting another frame. A failed live readback backs off; writes and same-frame
replacement under the same name share an early retry, while actually removing the failed resource can
retry immediately. Explicit `compactJournal()` remains available before reaching the journal limit.
Capture and restore still scale with live resource bytes and touched wasm pages. The **3 GiB capture
workspace limit** also accounts for overlapping history, staged copies and detached replay. Both byte limits
are estimates, not total GPU/process memory or latency guarantees. Stats split wasm/host capture, GPU proof/replay/readback,
and in-memory clone time. Streaming serialization is separate; artifact integrity hashing runs at boot, not capture.
No private-game latency certification is implied.

Unsupported module features fail closed: passive/declarative data/element segment lifetime state,
start functions, imported non-functions/multiple memories/exception tags, nonnumeric globals or
reference-table entries without a module function identity. Float globals use wasm bit reinterpret
helpers (including exact NaN payloads and infinities), not JS Global.value conversion. Non-finite
GPU float/half-float texture contents currently fail closed because native GL readback can
canonicalize NaN payloads. Current C kit fixtures use numeric globals/active segments/function tables.

## Probe searches and files

Probe scripts already run as long-lived sessions: the page stays booted until the script returns.
Capture once with `p.snapshot()` (or import once), then call `p.restore(handle)` / `p.search(handle, ...)`
as many times as needed; these operations never reload the page or run guest initialization.
Probe snapshots are browser-local Playwright `JSHandle`s: do not pass them through JSON or
`page.evaluate` return serialization (which loses Maps, typed arrays and bigint). Dispose handles.

```sh
BGT_E2E_PORT=5294 npm run probe -- --game sample2d --backend webgl2 \
  --params deterministic=1,suspension=asyncify --script ./search.mjs --out reports/probe/search
```

On a host without a GPU (WebGL2 falls back to SwiftShader), add `--software`; otherwise the probe stops
with a software-renderer error (see [performance.md](performance.md)).

A checked-in integration script is `tools/probe/examples/savestate-search.mjs` (also exercises
file import and restore-on-score-failure). Run it with the same command, substituting that path.

```js
// search.mjs: an original CC0 fixture demonstration; replace the lead-in with your route.
export default async function (p) {
  await p.key('Enter');
  await p.step(20);
  const checkpoint = await p.snapshot();
  try {
    await p.exportSnapshot(checkpoint, 'route.bgtstate');
    const results = await p.search(checkpoint, {
      variants: [0, 1, 2, 3], updates: 12,
      // Called once per branch update; events use existing __BGT_TEST__.input semantics.
      input: (delay, frame) => [
        {type: 'key', code: 'ArrowRight', down: frame >= delay},
      ],
      score: async p => (await p.debugState()).player.x,
      prefix: 'timing',
    });
    p.log(results); // scalar score + screenshot path per variant; baseline restored in finally
  } finally { await checkpoint.dispose(); }
}
```

`p.importSnapshot('route.bgtstate')` returns another handle; use `await p.restore(handle)`.
Files resolve relative to the probe output directory. Import into a newly booted deterministic-mode
instance with matching configuration, after consuming its initial frame. Browser equivalents are
`exportSnapshot(snap)` returns a ReadableStream and `importSnapshot(stream)` consumes it asynchronously. The versioned private BGTSTATE binary format has bounded length-prefixed metadata and raw blob records (at most 1 MiB each), with optional per-chunk DEFLATE via `exportSnapshot(snap, {compression: 'deflate'})`. It rejects unknown versions, malformed lengths, duplicate sections, truncation and trailing bytes. Wasm pages, GPU blobs and byte arrays never become one giant JSON string or file buffer.
Raw transport chunks may begin at arbitrary byte offsets; import and GPU replay copy misaligned
byte uploads to an 8-byte-aligned allocation before any typed view is constructed. Aligned
owned uploads remain zero-copy at replay. BGTSTATE v3 additionally emits repeated references to the same byte view once, preserving the alias on import.
The reader still accepts v2 files (without aliases).
Aggregate in-memory clones also copy byte backing buffers individually (preserving aliases/views),
not through Chromium's approximately 2 GiB structured-clone serialization envelope. Restore captures
the caller's checkpoint synchronously before its first await, so subsequent caller mutation cannot race replay.

The tagged JSON representation is debug-only: use `exportSnapshotDebugJson`/`importSnapshotDebugJson` for small diagnostics; it is capped at 8 MiB and retains exact u64 bigint values, float-global bit patterns, infinities, Maps/Sets, byte/key arrays and negative zero. It is not a public network protocol. Probe transfer reads and writes 1 MiB chunks and atomically renames a completed partial file.

The recorder stores only resource mutations and required provenance, not readback observations or completion functions. It does no JSON/base64 accounting; it rolls history at consumed frame boundaries. `compactJournal()` is a test-only quiescent-boundary operation for long lead-ins; `journalStats()` reports journal and retained bytes and their limits. Snapshot-time compaction remains exact and bounded by live resources plus two updates/100,000 residual commands. The GL-heavy CC0 profile in `tests/e2e/savestate-performance.spec.ts` reports deterministic/non-deterministic wall time, overhead and journal growth; these are local engineering measurements, not hardware or real-game certification.

Search always restores before each variant and in `finally`, including score/screenshot failures.
Record the lead-in and winning input variant as an ordinary deterministic-mode full-route test too.
