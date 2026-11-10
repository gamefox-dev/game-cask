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
- **JSPI:** supported only when `bgt_update` actually **returned**. Suspended JSPI throws
  `Unsupported checkpoint state: suspended JSPI continuation; use Asyncify`. The browser does not
  expose a way to clone/rewind its engine-owned continuation. Pipeline loops commonly stay
  suspended forever: use their Asyncify fallback for searching, then replay the discovered full
  route from boot under JSPI. There is no silent fallback or fake JSPI checkpoint.
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
| Guest `time_us` | completed updates × 16667 µs; constant during an update/render |
| Entropy | xorshift32 seeded by `seed` (zero maps to 1), one low byte per advance; **not cryptographic** |
| Audio | no physical playback; 48000 Hz simulated queue, capacity 14400 frames, drains 800.016 frames per completed update; push reports admitted frames, queued rounds to an integer |
| Storage | initially empty isolated memory map; no localStorage writes/reads |
| Input | scripted events only; no physical keyboard, pointer, touch overlay or gamepad polling |

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
  existing code/function/global/table indices remain unchanged. Sparse zero-page memory encoding
  avoids copying reserved zero GiB heaps; explicit saved length still restores growth exactly. A **fresh wasm
  instance** makes memory/table growth reversible without trying to shrink an existing wasm memory.
- Host lifecycle/suspension/frame/input state, texture and GPU validator object tables, completed request
  data/error/visibility epochs/next IDs, file handles/cursors/next IDs and coverage, input held/latched/
  released/gamepad/pointer/touch/event state, deterministic clock/entropy/audio/storage.
- An opt-in ordered **renderer-input journal from startup**, including uploads, shaders, buffers,
  texture/VAO/pipeline/FBO equivalents, copies, draws, render-to-texture/depth/stencil and deletion.
  Snapshots materialize a compact live-resource base in a temporary same-backend renderer,
  reading actual safe GPU contents at the residual START, not stale upload shadows or the
  suffix end. Restore rebuilds that base and bounded residual in a fresh renderer, then swaps
  the host/renderer. Guest updates/initialization are not replayed. Native buffer data and its
  separate CPU validation/repacking shadow are both preserved. Physical retained screen and
  (WebGPU) logical screen are transferred separately, along with legacy render targets.
  Completion callbacks are replaced with replay-local plumbing; original request results come from
  the checkpoint, never from replay into the original request table.

Restore work is bounded by **live resources plus at most two updates / 100,000 residual commands**,
not route length. Packed depth-stencil has no portable exact WebGPU readback. Every unavailable
pre-cut aspect must be fully cleared or overwritten before any residual read/draw and before the
snapshot end (or deleted without being consumed). Complete PASS_BEGIN load-clears and full-extent,
unmasked CLEAR_BUFFER operations prove resets; scissored/masked/partial clears do not. If no safe
common frame-boundary cut exists in that window, snapshot throws an explicit provenance error,
rather than omitting stencil or keeping unbounded replay work. Resources deleted/reused during the
residual remain in exact order. Handled failed shader compiles are replayed as failed objects;
deleted objects are removed from the base.

The recorder attempts the same materialization every 120 updates or 32 MiB, keeping long clear-per-frame
routes bounded before the first explicit snapshot. Snapshot work can replay the uncompacted prefix;
failed materialization preserves the recorder. A 256 MiB estimated journal limit fails closed if
repeated compaction is unsupported. An earlier valid checkpoint can still be restored. Saved
stats report native content bytes, residual command/update counts and snapshot ms. File size scales
with nonzero guest pages and live GPU state. No nine-minute real-game latency certification is implied.

Unsupported module features fail closed: passive/declarative data/element segment lifetime state,
start functions, imported non-functions/multiple memories/exception tags, nonnumeric globals or
reference-table entries without a module function identity. Float globals use wasm bit reinterpret
helpers (including exact NaN payloads and infinities), not JS Global.value conversion. Non-finite
GPU float/half-float texture contents currently fail closed because native GL readback can
canonicalize NaN payloads. Current C kit fixtures use numeric globals/active segments/function tables.

## Probe searches and files

Probe snapshots are browser-local Playwright `JSHandle`s: do not pass them through JSON or
`page.evaluate` return serialization (which loses Maps, typed arrays and bigint). Dispose handles.

```sh
BGT_E2E_PORT=5294 npm run probe -- --game sample2d --backend webgl2 \
  --params deterministic=1,suspension=asyncify --script ./search.mjs --out reports/probe/search
```

A checked-in integration script is `tools/probe/examples/savestate-search.mjs` (also exercises
file import and restore-on-score-failure). Run it with the same command, substituting that path.

```js
// search.mjs: an original CC0 fixture demonstration; replace the lead-in with your route.
export default async function (p) {
  await p.key('Enter');
  await p.step(20);
  const checkpoint = await p.snapshot();
  try {
    await p.exportSnapshot(checkpoint, 'route.bgtstate.json');
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

`p.importSnapshot('route.bgtstate.json')` returns another handle; use `await p.restore(handle)`.
Files resolve relative to the probe output directory. Import into a newly booted deterministic-mode
instance with matching configuration, after consuming its initial frame. Browser equivalents are
`exportSnapshot(snap): string` and `importSnapshot(text): Savestate`. The file codec retains exact
u64 bigint values, float-global bit patterns, infinities, Maps/Sets, byte/key arrays and negative zero; it is not a public network protocol.

Search always restores before each variant and in `finally`, including score/screenshot failures.
Record the lead-in and winning input variant as an ordinary deterministic-mode full-route test too.
