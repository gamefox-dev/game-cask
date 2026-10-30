# Game Cask Browser Target (BGT) — ABI v0.3 (partial GPU extension)

Status: **v0.3** (`0x000300`, additive; §12 adds requests/readback to the frozen v0.1/v0.2 interfaces).
This branch does **not** yet provide the full v0.3 GPU-layer brief (buffers/shaders/pipelines/OpenGL). The C header is [`bgt/include/bgt.h`](../include/bgt.h) and
[`bgt_cmd.h`](../include/bgt_cmd.h). The TypeScript mirror is
[`bgt/runtime/abi.ts`](../runtime/abi.ts). `tests/unit/abi-layout.test.ts` compiles a C
probe against the headers and fails if the mirror drifts.

A BGT game is a single `wasm32` module compiled from C/C++. It imports functions from
the module `"bgt"` and exports `bgt_*` lifecycle functions. The browser runtime owns
the GPU, event loop, audio device, persistence and asset fetching. The game never
sees a JS, DOM or WebGPU object.

## 1. Conventions

- Little-endian everywhere. One linear memory (exported as `memory`). Pointers are
  `uint32` offsets into it.
- Strings are UTF-8 with an explicit byte length. No NUL terminator is required,
  except for the optional `bgt_debug_state` string.
- Structs use natural alignment with explicit padding. Sizes are asserted with `_Static_assert`.
- Integer handles only (textures, assets). Handle `0` is reserved.
- Every runtime import validates every pointer/length against the current memory size
  and returns a negative error code instead of touching out-of-range memory.
- Errors are `int32` codes:

  | code | name | meaning |
  |---:|---|---|
  | 0 | `BGT_OK` | success |
  | -1 | `BGT_E_INVALID` | malformed argument or payload |
  | -2 | `BGT_E_BOUNDS` | pointer/length outside linear memory |
  | -3 | `BGT_E_LIMIT` | a documented limit was exceeded |
  | -4 | `BGT_E_UNSUPPORTED` | opcode/capability not supported (never a silent no-op) |
  | -5 | `BGT_E_NOT_FOUND` | unknown asset, key or handle |
  | -6 | `BGT_E_IO` | storage backend failure |
  | -7 | `BGT_E_STATE` | call not valid in the current lifecycle state |

- Versioning: `BGT_ABI_VERSION = (major << 16) | (minor << 8) | patch`, currently `0x000300` (v0.3).
  The runtime refuses a module whose major differs, or whose minor is newer than the runtime's.
  Minor versions only add functionality.

## 2. Lifecycle

```
fetch manifest ─► preload wasm + all assets (async, hashed, progress UI)
             ─► instantiate (imports checked; unknown imports are a load error)
             ─► bgt_abi_version() check ─► bgt_io() address check
             ─► runtime fills io (config) ─► bgt_init(io_ptr)
loop:        ─► runtime fills io (input) ─► bgt_update(16667)   × N (fixed timestep)
             ─► bgt_render()            once per displayed frame
             ─► bgt_shutdown()          (best effort; pages may close without it)
```

| export | signature | rules |
|---|---|---|
| `bgt_abi_version` | `uint32_t (void)` | must return the `BGT_ABI_VERSION` the game was compiled with |
| `bgt_io` | `uint32_t (void)` | address of a static, 4-byte aligned `bgt_io_t` (use `BGT_DEFINE_IO`) |
| `bgt_init` | `int32_t (uint32_t io_ptr)` | must set `logical_width/height` (1..4096); may create textures; nonzero return aborts the load |
| `bgt_update` | `void (uint32_t dt_us)` | one simulation step; `dt_us` is always `BGT_DT_US` (16667). Simulation must depend on update count, not wall clock |
| `bgt_render` | `void (void)` | record and submit draw commands for the current state. **Must not advance simulation** (the runtime may call it extra times, e.g. for screenshots or after resize) |
| `bgt_shutdown` | `void (void)` | flush saves |
| `bgt_state_hash` *(optional)* | `uint32_t (void)` | stable hash of deterministic simulation state; enables `stateHash()` in tests |
| `bgt_debug_state` *(optional)* | `uint32_t (void)` | address of a game-owned NUL-terminated UTF-8 JSON string describing observable state. Debug/test only |
| `bgt_debug_peek` *(optional, v0.2.1)* | `uint32_t (uint32_t addr, uint32_t len)` | **debug/test only, read-only**: copy `len` (1..65536) bytes of the game's *guest* memory at `addr` (e.g. the emulated address space of a pipeline game) into a game-owned buffer and return its address, or 0 if any byte is unmapped. Must not change game state. Reached only through the test API's `peek` |

Timing: the runtime accumulates real time and runs up to 4 updates per displayed frame
(`LIMITS.maxCatchUpUpdates`), then drops any backlog. Under the test API, updates run only
through `step(n)`.

Traps: a wasm trap or `bgt_abort` stops the loop and shows an accessible error panel.
The error is recorded in diagnostics. The runtime never resumes a trapped instance.

CPU limit: v0.1 runs the game on the main thread, so a non-terminating `bgt_update`
cannot be pre-empted. The runtime measures update/render time and exposes it in
diagnostics. Moving the game to a Worker is the planned v0.2 fix (see §10).

## 3. `bgt_io_t` (224 bytes)

| offset | field | writer | when |
|---:|---|---|---|
| 0 | `abi_version` | runtime | before init |
| 4 | `backend` (`BGT_BACKEND_*`) | runtime | before init |
| 8 | `caps` (`BGT_CAP_*`) | runtime | before init |
| 12 | `audio_sample_rate` (Hz, 0 = none) | runtime | before init |
| 16 | `seed` (default 1, `?seed=`) | runtime | before init |
| 20/24 | `display_width/height` (canvas device px) | runtime | before init, on resize |
| 28 | `arg0` (`?arg0=`) | runtime | before init |
| 32/36 | `logical_width/height` | **game** | in `bgt_init` |
| 40 | `flags` (`BGT_FLAG_INTEGER_SCALE`) | **game** | in `bgt_init` |
| 44 | `arg1` (`?arg1=`) | runtime | before init |
| 48 | `frame` (index of the update about to run) | runtime | before each update |
| 52/56/60 | `buttons`, `buttons_pressed`, `buttons_released` | runtime | before each update |
| 64 | `keys[8]` held, bit *k* = USB HID usage *k* | runtime | before each update |
| 96 | `keys_pressed[8]` | runtime | before each update |
| 128/132 | `pointer_x/y` (logical px, may be outside) | runtime | before each update |
| 136 | `pointer_buttons` (bit0 primary) | runtime | before each update |
| 140 | `pointer_inside` | runtime | before each update |
| 144 | `axes[4]` int16 (gamepad LX, LY, RX, RY) | runtime | before each update |
| 152 | `touch_count` | runtime | before each update |
| 156 | `events` (`BGT_EVENT_*` since last update) | runtime | before each update |
| 160 | `touches[4]` (`id, x, y, active`) | runtime | before each update |

Input snapshot rules:
- Inputs are sampled once per update. A press shorter than one update is latched: it
  appears as held for one update and in `*_pressed`.
- Virtual buttons merge keyboard (default map: arrows/WASD, Z/Space=A, X=B, Enter=START,
  Backspace/RShift=SELECT, Q/E=L/R; overridable via `game.json` `input.keys`, where `null` removes a
  default binding), the
  standard-mapping gamepad, the touch overlay and test input.
- `events`: `RESIZED`, `DEVICE_RESET` (GPU lost and restored; textures were already
  re-uploaded), `AUDIO_UNLOCKED`, `FOCUS_LOST` (keys were released).

## 4. Runtime imports (module `"bgt"`)

| import | C name | returns |
|---|---|---|
| `log(level, ptr, len)` | `bgt_log` | — (len capped at 4096) |
| `abort(code, ptr, len)` | `bgt_abort` | never returns |
| `submit_commands(ptr, len)` | `bgt_submit_commands` | `BGT_OK` / first error (see §6) |
| `asset_open(path, len)` | `bgt_asset_open` | handle > 0 or error |
| `asset_size(h)` / `asset_read(h, dst, size)` / `asset_seek(h, off)` / `asset_close(h)` | `bgt_asset_*` | size / bytes read (0 at EOF) / 0 / 0, or error |
| `audio_push(samples, frames)` | `bgt_audio_push` | frames accepted |
| `audio_queued()` | `bgt_audio_queued` | frames scheduled, not yet played |
| `storage_read(key, klen, dst, cap)` | `bgt_storage_read` | full value length, or `BGT_E_NOT_FOUND` |
| `storage_write(key, klen, src, len)` | `bgt_storage_write` | 0 or error |
| `time_us()` | `bgt_time_us` | `f64` wall-clock µs. **Profiling only** |
| `debug_draw_sprite(...)` | `bgt_debug_draw_sprite` | — ; only with `BGT_CAP_DIRECT_DRAW` (`?bench=1`) |

### Assets (virtual file system)

`game.json` names an asset directory, plus optional `originals` (files copied from the user's `original/`
at build time into the private build output, hash-checked). The build hashes every file (SHA-256) into
`manifest.json`, and URLs carry the hash prefix as a cache key. The runtime preloads
**all** assets asynchronously before `bgt_init`, with bounded concurrency, a progress bar and
integrity checks. Reads are then **synchronous** from memory. Paths are relative,
`/`-separated, with no `.`/`..` or empty segments. A missing asset returns `BGT_E_NOT_FOUND`
and is listed in `diagnostics().assets.missing`. At most 256 open handles.

### Audio

Signed 16-bit mono at `audio_sample_rate` (48000 in v0.1). Audio starts **locked**. The
first user gesture (pointer/key/touch) unlocks it (iOS Safari requirement; no autoplay).
Until then `audio_push` accepts 0 frames and diagnostics count them as dropped. The queue
holds at most 300 ms; anything beyond is rejected (return value < frames). An AudioWorklet
is not required.

### Storage

Keys are 1..64 bytes of `[A-Za-z0-9_.-]`, values ≤ 64 KiB, stored under
`localStorage["bgt:<game-id>:<key>"]`. If storage is blocked or `?ephemeral=1`, a memory map
is used and `BGT_CAP_STORAGE` is **not** set. Writes are synchronous.

## 5. Capabilities and sizing

`caps` reports `AUDIO`, `STORAGE` (persistent), `TOUCH`, `GAMEPAD`, `LINEAR_FILTER`,
`SCISSOR`, `TRIANGLES` and `DIRECT_DRAW` (bench only). Using a missing capability returns
`BGT_E_UNSUPPORTED`.

The game picks a logical resolution. The runtime sizes the canvas backing store to
CSS size × DPR (DPR capped at 3, backing capped at min(4096, GPU max)). It letterboxes
the logical surface with preserved aspect ratio, using an integer scale when
`BGT_FLAG_INTEGER_SCALE` is set and the scale is ≥ 1. Pointer coordinates arrive in logical pixels.

## 6. Command stream v1

```
header  (16 B): u32 magic 'BGTC' (0x43544742) | u16 version (1) | u16 flags (0) | u32 byte_len | u32 cmd_count
command  (8 B): u16 opcode | u16 flags (0) | u32 payload_len (multiple of 4) | payload
```

The buffer must be 4-byte aligned, ≤ 8 MiB, and `byte_len` must equal the submitted length.

| op | name | payload | semantics |
|---:|---|---|---|
| 0x01 | `CLEAR` | `u32 rgba` | fill the current clip rect, ignoring blend |
| 0x02 | `VIEWPORT` | `i32 x,y,w,h` | offset subsequent coordinates by (x,y) and clip to the rect. Unit scale |
| 0x03 | `SCISSOR` | `u32 enable, i32 x,y,w,h` | absolute logical clip rect, intersected with the viewport |
| 0x04 | `TRANSFORM` | `f32 a,b,c,d,tx,ty` | `x' = a·x + c·y + tx`, `y' = b·x + d·y + ty`; finite values only |
| 0x05 | `BLEND` | `u32 mode` | 0 opaque, 1 alpha (default), 2 additive, 3 premultiplied |
| 0x06 | `TEXTURE` | `u32 handle, u32 filter` | bind texture (0 = built-in white). Filter 0 nearest, 1 linear |
| 0x10 | `TEX_CREATE` | `u32 handle, w, h, format` | handle 1..1023, w/h 1..4096, format 0 = RGBA8 |
| 0x11 | `TEX_UPDATE` | `u32 handle, x, y, w, h, data_ptr, data_len` | `data_len == w·h·4`, tight rows. Data is **copied at submit** |
| 0x12 | `TEX_DELETE` | `u32 handle` | if bound, binding falls back to 0 |
| 0x20 | `SPRITES` | `u32 n` + n × `{f32 x,y,w,h,u0,v0,u1,v1; u32 rgba}` (36 B) | textured quads, tint multiplies texel |
| 0x21 | `TRIANGLES` | `u32 n` (multiple of 3) + n × `{f32 x,y,u,v; u32 rgba}` (20 B) | raw triangles |

Colors are RGBA8 packed as `r | g<<8 | b<<16 | a<<24` (byte order R,G,B,A in memory).
Coordinates are logical pixels with the origin at the top-left and +y down. Texture row 0
is at v = 0.

Decoding (`bgt/runtime/commands.ts`), shared by both renderers:
1. **Framing pass**, with no side effects: header, every prefix, alignment and bounds. Any
   failure rejects the entire submission (`executed = 0`).
2. **Execution pass**, in order: a semantic error (unknown opcode, bad handle, limit) skips
   only that command, is recorded in diagnostics, and makes the call return the first error.
3. Draw state (viewport, scissor, transform, blend, texture) resets at the start of every
   `bgt_render`. Texture objects persist until deleted.
4. Consecutive draws with identical state merge into one GPU draw. Draw order and blending
   are never reordered.
5. Texture operations submitted in `bgt_init`/`bgt_update` are applied before the next
   frame's draws. Operations inside a frame are applied in stream order relative to draws.

### Limits (v0.1)

| limit | value |
|---|---|
| bytes per submit | 8 MiB |
| commands per submit | 65 536 |
| submits per frame | 256 |
| vertices per frame | 1 572 864 (262 144 sprites) |
| textures | 1023 live handles, ≤ 4096², ≤ 256 MiB total |
| logical size | ≤ 4096² |

## 7. Resource lifetime and device loss

The runtime keeps a CPU **shadow copy** of every texture. On WebGPU `device.lost` or
WebGL `webglcontextlost`, frames are skipped. On restore, the runtime recreates GPU
objects from the shadows and sets `BGT_EVENT_DEVICE_RESET`. The game needs no action;
handles stay valid.

If a WebGPU device cannot be recovered, the runtime switches to WebGL 2 **mid-game**. This happens when
recovery fails, or when there is no recovery within 5 s; headless Linux Chromium, for example, loses
software WebGPU devices and cannot request new ones. A canvas that produced a WebGPU context cannot
be reused for WebGL, so the runtime swaps in a fresh canvas. It re-uploads all textures from the
shadows, updates `io.backend` and sets `BGT_EVENT_DEVICE_RESET`, and records the reason in
`backendNotes`. The simulation is not interrupted. If WebGL 2 itself is lost for good, the runtime
stops with an accessible error instead of hanging.

## 8. Backend selection

`?backend=auto` (default) tries WebGPU (adapter + device + context configure), then
WebGL 2. Overrides: `webgpu` (required, else error), `webgl2`, `webgpu-fail` (deliberately
skip WebGPU, to test the fallback) and `none` (shows the no-graphics error UI). The reasons are
in `diagnostics().backendNotes`.

## 9. Test API (`window.__BGT_TEST__`, dev / `VITE_BGT_TEST=1` builds only)

```ts
interface BGTTestAPI {
  ready(): boolean; pause(): void; step(frames: number): Promise<void>;
  input(events: BGTTestInputEvent[]): void; screenshot(): Promise<Blob>;
  diagnostics(): BGTDiagnostics; stateHash(): string | null;
  backend(): 'webgpu' | 'webgl2' | 'unavailable';
  // extensions
  resume(): void; failed(): boolean; readPixels(): Promise<{width,height,base64}|null>;
  debugState(): unknown; injectCommands(base64: string): DecodeResult | null;
  simulateDeviceLoss(): Promise<void>;
  peek(addr: number, len: number): Uint8Array | null;   // v0.2.1, test-only, read-only (bgt_debug_peek)
}
type BGTTestInputEvent =
  | { type: 'key'; code: string /* KeyboardEvent.code */; down: boolean }
  | { type: 'button'; button: 'UP'|'DOWN'|'LEFT'|'RIGHT'|'A'|'B'|'X'|'Y'|'START'|'SELECT'|'L'|'R'; down: boolean }
  | { type: 'pointer'; x: number; y: number /* logical px */; down?: boolean; buttons?: number };
```

`pointer.buttons` uses the DOM `MouseEvent.buttons` bitmask: 1 = primary, 2 = secondary (right), 4 = middle.
It reaches the game unchanged as `bgt_io_t.pointer_buttons`. When `buttons` is given it overrides `down`
(`down: true` is shorthand for `buttons: 1`). A press is latched like the virtual buttons, so a right-click is
`input([{ type: 'pointer', x, y, buttons: 2 }])`, then `step(1)`, then `input([{ type: 'pointer', x, y, buttons: 0 }])`.

- `step(n)` pauses free-running, then for each of n steps: applies input, runs one
  `bgt_update`, renders and draws. It resolves after `onSubmittedWorkDone` (WebGPU) or
  `gl.finish` (WebGL), so a following `readPixels`/`screenshot` sees the result.
- `?paused=1` starts paused at frame 0, so a test owns every simulation step.
- `peek(addr, len)` (v0.2.1) returns a copy of `len` (1..65536) bytes of guest memory through the optional
  `bgt_debug_peek` export, or `null` (no export, unmapped, bad length). It exists only where the test API exists
  (dev / `VITE_BGT_TEST=1` builds) and has deliberately **no write counterpart**: tests may observe game state, never
  change it. Calling it does not alter `stateHash()`.
- **Determinism:** simulation state is deterministic for identical input/seed (the e2e
  suite checks the browser against the Node host). GPU output is not bit-exact across GPU
  stacks: linear filtering, rasterization edges and blending rounding may differ by a few
  LSBs. Tests compare cross-backend images with tolerances; same-backend reruns are compared exactly.

## 10. Known v0.1 limitations

- The game runs on the main thread (no pre-emption of runaway loops). Planned fix: a Worker plus `SharedArrayBuffer`.
- Mono int16 audio only, no streaming decode. No custom shaders, render targets or 3D.
- Pointer lock, multi-touch gestures and gamepad rumble are not exposed.
- Storage is localStorage (≈5 MiB per origin).
- No hardware iPhone Safari verification has been performed by the kit's own tests. See `docs/verification.md`.

## 11. v0.2 additions

All additions are opt-in; v0.1 games are unaffected.

### Render targets (`BGT_CAP_RENDER_TARGETS`)
- `TEX_CREATE` with `format = BGT_FORMAT_RGBA8 | BGT_TEX_RENDER_TARGET` (bit 8) creates a texture that can be drawn
  into. It starts transparent black and **keeps its contents across frames**. Platforms that draw incrementally
  (GDI windows, VGA framebuffers, off-screen bitmaps) map onto this without CPU pixel work.
- `TARGET {u32 handle}` (op `0x07`): subsequent draws go into that render target (`0` = the screen). Coordinates are the
  target's pixels. Viewport and scissor reset to the full target; transform, blend and texture are kept. At the start
  of every `bgt_render` the target is the screen.
- Errors:
  - `TARGET` on a non-render-target texture → `BGT_E_INVALID`; on an unknown handle → `BGT_E_NOT_FOUND`
  - sampling the texture currently being drawn into → `BGT_E_STATE`
  - deleting it → `BGT_E_STATE`
- Render-target contents live only on the GPU. After a device/context reset the runtime recreates them (from the last
  `TEX_UPDATE` data, if any) and sets `BGT_EVENT_TARGETS_LOST`: redraw them. There is no GPU→CPU readback in v0.2.
- Both backends render targets with texture row 0 at the top. The conformance scene checks this orientation.

### Blend modes
| mode | value | result |
|---|---:|---|
| `BGT_BLEND_INVERT` | 4 | `dst = src × (1 − dst) + dst × (1 − src)`: an exact XOR for 0/255 channels (GDI `SRCINVERT`/`PATINVERT` with black-and-white sources), an exact invert under a white source (`DSTINVERT`), and black leaves the destination unchanged; a smooth blend for other colours |
| `BGT_BLEND_MULTIPLY` | 5 | `dst = src × dst`; equals a bitwise AND for 0/255 mask colours (GDI `SRCAND` masks) |

Alpha is kept for both. General bitwise raster ops (XOR of arbitrary colours) have no GPU equivalent in WebGPU or
WebGL 2. Platforms must emulate those on the CPU and report them as exceptions.

### Yield: blocking loops (`BGT_CAP_YIELD`)
`void bgt_yield(void)` suspends the game until the next frame **from anywhere on the call stack**. A legacy loop that
"owns the machine" (a message pump in `GetMessage`, a vsync wait, a polling loop) can then run unchanged.
- Build with `"asyncify": true` in `game.json`. The build runs binaryen's asyncify pass, with `bgt.yield` as the only
  suspending import.
- The game exports `bgt_async_buffer()` and `bgt_async_buffer_size()`: a static, 8-byte aligned buffer of at least
  64 KiB for the saved stack.
- Resuming continues **at the yield point**: code in `bgt_update` before the call that eventually yields is *not* re-run
  on later frames. Read per-frame input (`io`) after `bgt_yield` returns, inside the loop.
- Valid only inside `bgt_update`. The runtime unwinds, returns from `bgt_update`, may call `bgt_render`, and on the next
  update rewinds into `bgt_yield`, which returns. Input for that frame is already in `io`.
- Cost: instrumented functions are larger and slower. Only functions that can reach `bgt.yield` (directly or through
  indirect calls) are instrumented.
- Diagnostics report `yields` (frames that ended suspended) and `suspended`.

### Runtime-changeable logical size
The game may change `io.logical_width/height` in any `bgt_update`; the runtime relayouts (letterbox, pointer mapping).
Useful when a platform only learns its window size after start-up.

### Metrics export
Optional `uint32_t bgt_metrics(void)` returns NUL-terminated JSON with kit metrics the game or platform layer counts
(e.g. lifted vs. interpreted instructions, stubbed APIs hit, GPU vs. CPU drawing operations). It appears in
`diagnostics().metrics` and in trial reports.

## 12. v0.3 additions (implemented subset)

Version is `0x000300`. Lifecycle, `bgt_io_t` (224 B), command header v1 and every v0.2 opcode/layout are unchanged.
Old modules exporting `0x000200` are tested against the v0.3 host. New functionality is additive and capability-gated.
The full shader/buffer/pipeline/OpenGL layer is **not implemented**; no shader-language support is advertised.

### GPU limits

`gpu_limits(dst, cap)` / `bgt_gpu_limits` writes four u32s (16 bytes, alignment 4): `byte_size=16`,
`max_texture_dimension`, `max_texture_handles=1023`, `texture_budget_bytes=268435456`. cap<16 → E_LIMIT;
misaligned/out-of-range pointer → E_BOUNDS. v0.3 TEX_CREATE accepts dimensions up to the selected backend's limit,
within the unchanged byte/handle budgets. v0.2 modules retain their frozen 4096 dimension limit. Logical surface
size remains 4096. The runtime may have to fail recovery if a replacement device cannot recreate an existing texture.
Only RGBA8 and the v0.2 render-target format bit are currently supported.

### Asynchronous request results

Imports (all i32 returns): `request_status(u32 id)`, `request_read(u32 id,u32 dst,u32 cap)`,
`request_close(u32 id)` (C: `bgt_request_*`). IDs 1..0x7fffffff, at most 32 outstanding requests. At most 8 MiB of
completed results live at once; each result is at most 8 MiB. Handles are reusable only after close. A late completion
of a closed handle cannot overwrite a new request reusing that ID.
- status: 0 pending, 1 ready, or negative error; unknown/closed ID → E_NOT_FOUND.
- read: copies the **whole** ready result, returns byte count. Pending → E_STATE; insufficient cap → E_LIMIT;
  invalid memory → E_BOUNDS; no partial copy. Does not consume the result; close releases it or cancels a pending one.
- Completion never becomes visible during the update/render that issued it: it is exposed only on a subsequent
  `bgt_update` boundary. A blocking caller issues, `bgt_yield`s, then polls. Actual asynchronous I/O/GPU latency may
  require more yields. No callbacks or memory writes occur from promise callbacks into guest memory.

### Batched GPU readback (`BGT_CAP_READBACK`, bit 10)

Command `READBACK` opcode 0x30, payload 24 B: `u32 request_id,target,x,y,width,height`.
Target 0 = screen, otherwise an RGBA8 render target. Captures in stream order (later draws do not affect the result).
The request ID is caller-chosen; duplicate → E_STATE, zero/out-of-range ID → E_INVALID. Invalid target → E_NOT_FOUND
(or E_INVALID for a non-render-target texture), rectangle outside target → E_BOUNDS, zero size → E_INVALID,
result >8 MiB → E_LIMIT. Unsupported capability → E_UNSUPPORTED. Framing validation precedes request allocation.

Result is tightly packed top-down RGBA8, preserving target alpha; screen reads sample logical pixel centres from
the letterboxed framebuffer. On downscaled canvases this is a resampled display read, not an independent logical
resolution render. WebGPU copies at the command point and asynchronously maps a staging buffer. WebGL 2 currently
uses synchronous glReadPixels internally, but **ABI completion is still deferred** to an update boundary. GPU errors
complete with E_IO. No query-result readback is implemented yet.

Conformance: `examples/gpu-readback` draws two colours, captures, overwrites the target, yields and checks all bytes;
a separate screen request checks orientation/colour. Browser tests run on both backends. `requests.test.ts` tests
lifetime, cancellation, bounds/caps and the old-version host contract.

### Streamed immutable files (`BGT_CAP_STREAM_FILES`, bit 11)

`asset_open` names either an eager asset or a streamed file. Eager v0.2 asset_read/seek semantics are unchanged.
New `asset_size64(handle,dst)` writes an LE u64 file size (8 writable bytes required); unknown handle → E_NOT_FOUND.
`asset_range_request(handle,offset_lo,offset_hi,bytes)` returns a positive request ID for an immutable read of up to
8 MiB, or an error. Offset is unsigned u64, restricted to JS-exact integers (≤2^53−1); unsafe offset → E_INVALID.
The result is truncated at EOF (including zero bytes). Reads never move the legacy handle position. Eager files
can use this API too. Poll/read/close with §12 request functions after yielding. No delayed writes into guest memory.
Legacy asset_read on a streamed handle returns E_STATE: it never loads the whole file implicitly. Legacy asset_size
is i32, so use size64 for large files.

Manifest `streams` entries: `{path,size,chunkSize,chunks:[{offset,size,url,sha256}]}`. Paths use the existing safe VFS
rules; chunks must exactly cover the file in order (zero-size file has no chunks), each 4 KiB–1 MiB maximum configured
chunk size, final chunk may be short. Fetches are **chunked ranges**, not HTTP Range headers. The runtime fetches only
chunks touched by requests, validates response lengths and SHA-256 in a secure context, coalesces in-flight chunk
fetches and keeps a 16 MiB LRU. No whole-file preload. Network/integrity failure → request E_IO + a diagnostic log.

`game.json` `streams:[{from:"./file",path:"data/file",chunkSize:262144}]` writes chunks at build time using bounded
reads. `from` must be game-local or within original/. Pipeline `streamModules:true` packages each original executable
as a streamed `modules/<name>` file and makes a separate compact loader image containing headers and only the
virtually mapped bytes. This keeps overlays out of the eager loader asset; original file offsets are retained by
the streamed self-open view. `GetModuleFileNameW` → `CreateFileW` resolves that original view, not the compact image.
The Win32 profile implements read-only OPEN_EXISTING, ReadFile, GetFileSize(Ex), SetFilePointer(Ex), CloseHandle,
EOF, negative-seek errors and missing files. Overlapped reads, writes and CRT FILE APIs are not implemented yet.

While a range promise is outstanding, browser simulation updates are held; rendering/input delivery resume when
settled. Deterministic test stepping awaits pending I/O before advancing a frame, as does the oracle. Wall-clock
network latency is not virtual guest time. This is not a cooperative thread scheduler; a future worker must avoid
blocking all guest threads on an unrelated read.

### Coverage and slice boundaries

`coverage_entry(u32 address,u32 kind)` / `bgt_coverage_entry` records an executed profile function entry (`kind=1`
lifted, `2` interpreted). This is profile instrumentation, never a game-dependent branch. Host stores up to 65,536
unique entries with ORed kind bits. Function entry coverage does not claim instruction/block coverage.
`slice_missing(u32 kind,u32 address)` / `bgt_slice_missing` stops at an explicitly missing dependency (1 code, 2 data).
The runtime pauses and reports `outsideSlice` rather than a wasm trap; resumption requires a broader package/reload.
No IO layout changes. These functions are present only for v0.3 modules; older modules do not import them.

Debug/test API `coverage()` returns schema `game-cask/coverage/1`: game id, module names/bases/SHA-256, executed entries,
file ranges at chunk granularity, errors/outside-slice count and measured render completion timings. The probe and
browser fixture save snapshots. Strict slice manifests carry `slice.code` (allowed entries) and per-chunk `missing`
flags. An executed entry outside the set or a read of a missing chunk pauses visibly and records the dependency,
without fetching absent bytes. A strict slice never silently enables the interpreter to bypass the allowed set.

Coverage-guided nonslice builds keep all data and interpret unselected functions, recording kind=2 for the next build.
The current loader image retains conservative virtual section bytes (including unlifted machine code/data), so this
is **not** yet a minimum-image slice. Unknown indirect entry targets, self-modifying code and fine-grained basic block
coverage remain unsupported; see docs/v03-status.md.
