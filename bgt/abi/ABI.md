# Game Cask Browser Target (BGT) — ABI v0.3

Status: **v0.3** (`0x000300`, additive; §12 adds requests/readback to the frozen v0.1/v0.2 interfaces).
§13 defines and validates the GPU command interface; current browser renderers do not advertise `CAP_GPU`.
GPU execution and the OpenGL profile are separate implementations. The C header is [`bgt/include/bgt.h`](../include/bgt.h) and
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
The shader/buffer/pipeline interface is defined in §13; no current browser backend advertises its capability.

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

Additive FILE buffering imports (existing requests are unchanged):
- `asset_read_ahead(handle,offset_lo,offset_hi,bytes)` has the same deferred request lifetime, but clamps the
  result to the current 64 KiB boundary and, for streamed files, the current manifest chunk boundary. Even cached
  or eager data is invisible until the next update. Speculation never crosses into a subsequent omitted chunk.
  The starting chunk must exist; an omitted starting chunk still stops outside the slice. Returned bytes are
  recorded in `readAhead` / `crtReadAheadBytes`, **not** consumed `files` coverage.
- `asset_consumed(handle,offset_lo,offset_hi,bytes)` records delivered source bytes without I/O or a yield.
  It returns OK, E_NOT_FOUND for a closed/unknown handle, or E_INVALID for an unsafe offset. EOF truncates the
  recorded length. `crtConsumedBytes` counts source bytes (CRLF consumes two; re-reading a source range counts
  again; returning `ungetc` data does not). Packaging `files` coverage expands consumption only to its actual
  manifest chunks (64 KiB for eager assets); read-ahead alone never adds adjacent packaging chunks. Zero-byte
  records, including reads at/beyond EOF, add no coverage.
- `asset_observed(handle,offset_lo,offset_hi,bytes)` has the same validation/coverage rules as `asset_consumed`,
  but increments `crtObservedBytes` rather than the consumed-byte count. Use it for actual inspected dependencies
  not delivered to the caller, e.g. a non-LF byte inspected after CR. Such a byte is necessary for deterministic
  replay and packaging, unlike untouched speculative bytes. The CRT records this dependency even across chunks.

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
EOF, negative-seek errors and missing files. Overlapped reads and kernel file writes remain unavailable.
The Win64 CRT FILE layer adds bounded read-ahead and process-local writable files; see `platforms/win32/CONTRACTS.md`.

While a range promise is outstanding, browser simulation updates are held; rendering/input delivery resume when
settled. Deterministic test stepping awaits pending I/O before advancing a frame, as does the oracle. Wall-clock
network latency is not virtual guest time. This is not a cooperative thread scheduler; a future worker must avoid
blocking all guest threads on an unrelated read.

### Stereo audio and independent gamepads (Lane E, additive v0.3)

The 224-byte IO layout, merged buttons/axes, and mono `audio_push` remain unchanged. New imports use module `bgt`:

| import | contract |
|---|---|
| `audio_push_stereo(ptr,frames)` | Interleaved signed int16 **L,R**, at `io.audio_sample_rate`; returns accepted **frames**, not samples. |
| `input_gamepad(index,ptr,bytes)` | Writes a 20-byte LE snapshot for slot 0..3; `bytes >= 20`; returns 0. |
| `input_gamepad_rumble(index,left,right)` | Best-effort actuator magnitudes 0..65535; returns 0 for a connected pad. |

Stereo pushes are capped at 48,000 frames/call; oversized counts or invalid memory return E_BOUNDS without calling
an audio sink. Audio unlock, 300ms queue, partial acceptance and Web Audio resampling follow the mono contract.
A host without stereo output accepts zero frames (there is no implicit downmix). Browser output preserves channels.

Gamepad structure: u32 `connected` at 0, u32 standard Gamepad API button-index bits at 4, four int16 axes at 8
(LX, LY, RX, RY, −32767..32767; browser **Y-down**), two u16 triggers at 16 (0..65535). Disconnected slots are zero.
Invalid index/short structure → E_INVALID; invalid destination → E_BOUNDS. Snapshots are copied at each update;
keyboard/touch/merged virtual buttons never masquerade as a connected pad. Existing IO axes still aggregate pads.
Rumble invalid index → E_INVALID; disconnected → E_NOT_FOUND. Browser actuator absence/rejection is not an error;
physical vibration is not simulation state. Magnitudes saturate; duration is best-effort 100ms, refresh to sustain.

Test API adds `{type:'gamepad',index,connected,buttons?,axes?,triggers?}` with normalized float axes −1..1 and triggers
0..1, and standard button-index bits. An injected slot overrides its physical slot until reload, including disconnect.

The Win32 profile maps standard buttons to XInput, flips stick Y, preserves trigger range, increments packet numbers
only when pad state changes, and returns ERROR_DEVICE_NOT_CONNECTED for absent slots. Raw Input registrations cover
usage-page 1 keyboard (6) and mouse (2); WM_INPUT carries bounded generation-checked handles (last 256 records).
GetRawInputData supports RID_INPUT/RID_HEADER, size queries and insufficient buffers, with native x86/x64 layouts.
Records derive from per-update HID edges and relative pointer deltas; this is **not** unaccelerated hardware input.
Only remove/foreground/INPUTSINK flags are supported; unsupported registrations fail rather than fabricate devices.
Known letter scan codes are supplied; unknown hardware scan codes are zero. No HID enumeration or raw wheel yet.
GetKeyboardState/GetAsyncKeyState/GetKeyState share held keyboard and mouse-button state, including sided/aggregate
modifiers. Async's historical low-bit latch and keyboard toggle states are not emulated.

COM provides a GUID class registry (currently MMDeviceEnumerator), apartment init nesting/mode checks, identity,
QueryInterface/AddRef/Release and task-memory ownership; unsupported classes/interfaces return HRESULT failures.
PropVariantClear/Copy handle scalar, LPSTR/LPWSTR, CLSID and profile IUnknown ownership (BSTR/arrays unsupported);
InitPropVariantFromString creates an owned LPWSTR variant.
No COM marshaling, aggregation or cross-apartment threads. WASAPI exposes default render endpoint/device/IAudioClient/
IAudioRenderClient with shared-mode PCM 8/16/24/32-bit and float32, mono/stereo, 8–192kHz. K6c validates non-mix
formats with AUTOCONVERTPCM; a float32 stereo format at another rate needs RATEADJUST or AUTOCONVERTPCM. Periodicity
must be 0; negative durations and loopback/exclusive/unknown flags return HRESULT failures. GetService adds
IAudioClock, IAudioClockAdjustment (RATEADJUST), IAudioStreamVolume and ISimpleAudioVolume. Exact HRESULTs and
INFERRED choices without native-Windows evidence are listed in docs/handoff/K6c.md.
GetMixFormat allocates float32 stereo at the sink rate (48kHz). Initialize accepts non-negative durations (minimum one
10ms period; zero selects 100ms), limited by checked UINT32 byte sizes and available guest heap, not an arbitrary
time ceiling. Unrepresentable sizes or failed allocation return E_OUTOFMEMORY. EXTENSIBLE validates valid bits,
sub-format and channel masks (zero, center mono or front stereo; other well-formed layouts unsupported). Buffering,
GetCurrentPadding, Start/Stop/Reset and GetBuffer/ReleaseBuffer use an owned ring. Conversion clips float to int16
and uses deterministic phase-accumulator rate conversion (sample repetition/decimation; linear interpolation for
RATEADJUST or AUTOCONVERTPCM|SRC_DEFAULT_QUALITY streams; neither is a bandlimited filter). Standalone
SRC_DEFAULT_QUALITY is accepted as a no-op (INFERRED).
SILENT buffers produce zeroes. The virtual clock drains source frames; locked/full BGT output may drop audio but does
not stall the simulated endpoint. Event streams signal every 10 virtual ms, coalesced at frame/poll boundaries.
CreateEvent/SetEvent/ResetEvent/WaitForSingleObject use scheduler-owned handles and wakeups; the scheduler calls
`w32_audio_pump` at virtual scheduling boundaries. Fixtures render from a guest worker thread. Audio pumping
never invokes a guest callback or uses wall time.
WinMM waveOut and capture/endpoint enumeration/session control are not supplied by this addition.

Conformance: `examples/x64-audio` generates a 1kHz two-channel tone through public COM vtables (float32/48kHz then
int16/24kHz), with owned strings, failure paths and event polling. Unit tests assert actual sink samples, amplitudes,
channel polarity, crossings and virtual duration. `examples/x64-input` draws four state squares and reports raw/pad
state; unit/browser tests inject pads/keyboard/mouse and assert make/break, deltas, packets and pixels on both backends.
Both are original CC0 fixtures, fully lifted, with 300-frame differential oracles and no per-game profile branches.

### Host entropy (LANE-K1, additive v0.3)

`BGT_CAP_ENTROPY` (bit 13) advertises an available host entropy source.
`bgt_random_bytes(void *dst, uint32_t length)` fills the checked linear-memory span with
Web Crypto `getRandomValues` bytes, splitting requests at the browser's 65,536-byte quota.
It returns `BGT_OK`, `BGT_E_BOUNDS` for an invalid span, `BGT_E_UNSUPPORTED` if no provider
exists, or `BGT_E_IO` on provider failure. Failed host calls do not modify the destination.
Zero length is accepted when a provider exists. This is not the seeded simulation PRNG;
normal browser play never substitutes deterministic bytes. The BCrypt profile consumes
this source (system-preferred RNG or Windows' RNG pseudo-handle); no algorithm/hash
providers are advertised.

Only the headless differential oracle explicitly supplies a deterministic entropy replay
provider. That tape makes lifted/interpreted comparisons reproducible, is test-only,
and is not cryptographically secure. Independent host tests exercise real Web Crypto,
quota splitting, invalid ranges and provider failure; browser fixtures use real entropy.

### Coverage and slice boundaries

`coverage_entry(u32 address,u32 kind)` / `bgt_coverage_entry` records profile function/block/continuation entries
(`kind=1` lifted, `2` interpreted), not every decoded instruction. This is profile instrumentation, never a
game-dependent branch. Host stores up to 1,048,576 unique addresses with ORed kind bits; rejected events increment
`metrics.code_entries_dropped`, and any positive drop count rejects selective/strict builds. Recording entries does
not claim instruction-level packaging or complete path coverage within a selected function.
`slice_missing(u32 kind,u32 address)` / `bgt_slice_missing` stops at an explicitly missing dependency (1 code, 2 data).
The runtime pauses and reports `outsideSlice` rather than a wasm trap; resumption requires a broader package/reload.
No IO layout changes. These functions are present only for v0.3 modules; older modules do not import them.

Debug/test API `coverage()` returns schema `game-cask/coverage/1`: game id, module names/bases/SHA-256, executed entries,
file ranges at chunk granularity, errors/outside-slice count and measured render completion timings. Execution
counters remain in `metrics.execution`; consumed/observed/read-ahead FILE byte counters remain separate, and
`readAhead` ranges alone are not packaging evidence. The probe and browser fixture save snapshots. Strict slice
manifests carry `slice.code` (allowed entries), `slice.codeRanges` (half-open owning function ranges) and per-chunk
`missing` flags. An executed entry outside both allowed entries and owning ranges, or a read of a missing chunk,
pauses visibly and records the dependency, without fetching absent bytes. A strict slice never silently enables the interpreter to bypass the allowed set.

Coverage-guided nonslice builds keep all data and interpret unselected functions, recording kind=2 for the next build.
The current loader image retains conservative virtual section bytes (including unlifted machine code/data), so this
is **not** yet a minimum-image slice. Discovery records unknown indirect entries, but unowned code may require
analyzer improvements before selective convergence. Self-modifying code and instruction-level strict packaging
remain unsupported; see [pipeline.md](../../docs/pipeline.md) for ownership/selection and exact counter definitions.

## 13. v0.3 GPU layer (additive interface)

This section is normative for the wire interface, validator and future backend/profile implementations. Execution
is **not enabled** in existing renderers. `BGT_CAP_GPU` / TS `CAP_GPU` is bit 12. Without it, every GPU opcode below
returns `E_UNSUPPORTED` after stream framing validation, with no resources/requests allocated. Existing 2D commands,
readback, requests, streamed files, IO, ABI version and command stream version are unchanged. A backend advertises
this bit only after implementing this section, not merely because the browser supports WebGL/WebGPU. Shader language
support is separately queried; GLSL translation is not implicitly promised by CAP_GPU.

### 13.1 Wire conventions, handles, errors and ordering

Opcodes use the existing 8-byte prefix, zero flags and 4-aligned payload. Below, a comma-separated field is one u32
word unless explicitly `f32` or `i32`. Sizes exclude the prefix. C structs use precisely this order, no padding;
`bgt_gpu.h` is included by `bgt.h`, and `bgt_gpu_cmd.h` by `bgt_cmd.h`. Every op has a
`bgt_cmd_gpu_<lowercase-op>(bgt_cmdbuf_t*, const bgt_gpu_<lowercase-op>_t*)` helper; PASS_END takes only the buffer.
PIPELINE_CREATE and PASS_BEGIN additionally take arrays for their inline tails (see below). These struct-copy
encoders target the ABI's little-endian C machine (wasm32); pointer fields are **u32 wasm offsets**, not host pointers.
TS mirrors are `GPU_OP`, `GPU`, `GPU_LAYOUT`, `GPU_PIPELINE_FIELDS`, `GPU_LIMITS` in `runtime/abi.ts`.
`CommandEncoder.gpu(op, words)` emits these exact words; encode f32 fields as their IEEE-754 bits.

GPU handles are caller-chosen integers 1..1023 in **five separate namespaces**: buffer, texture, sampler, shader,
pipeline. Zero is not a resource, except as the screen color attachment / absent depth attachment in PASS_BEGIN.
They are distinct from legacy TEX_* handles: there is no implicit legacy/GPU texture aliasing or cross-sampling.
Deleting allows immediate handle reuse; already queued commands still refer to the prior generation by stream order.
CREATE of an invalid handle → E_INVALID; duplicate → E_STATE; missing resource on use/update/delete → E_NOT_FOUND.
Resources persist across submits/frames. Buffers start zero; textures start color zero / depth 1 / stencil 0 at every
mip. There is no cube texture, multisampling, storage buffer or compute interface in this layer. 3D / 2D-array textures, extra formats, LOD-aware samplers, texture read-back and GPU mip generation are the additive §13.7 operations.
Profiles implement these only by general transformations or report unsupported; never silently reinterpret them.

Framing validation is still all-or-nothing. Semantic failures skip **only** the failing command, preserve prior state,
and return the first error from submit (all errors retain opcode/offset). Wrong fixed length or inconsistent inline
tail → E_INVALID; oversized inline counts → E_LIMIT; nonzero command flags → E_UNSUPPORTED. Capability gating
precedes payload validation so old modules retain E_UNSUPPORTED for formerly unknown opcodes (even malformed).
With the capability present: shape validation precedes lifecycle/state checks, which precede
resource checks; create checks handle/duplicate first. Bad enums, boolean outside 0..1, NaN/Inf, zero required size,
misalignment and data length mismatch → E_INVALID. Memory pointer+length, buffer/texture region or draw-fetch outside
bounds → E_BOUNDS (addition/multiplication is checked without u32 wrapping). Documented budget/count → E_LIMIT.
Known unsupported language or depth upload → E_UNSUPPORTED. Backend allocation/device errors → E_IO and diagnostic;
shader errors use the request result below. A well-shaped but unsupported opcode still uses the legacy E_UNSUPPORTED.

All resource operations (0x40..0x4b and the §13.7 operations 0x59..0x5d) are **outside** a GPU pass. Pipeline binding/dynamic state/buffer binding/draws
(0x4e..0x58) are **inside** a pass. No legacy command, including READBACK and 2D state/resource operations, may occur
inside a GPU pass: E_STATE, no effect. Resource operations during a pass, nested begin, end outside a pass, draws
without a pipeline/required bindings, attachment feedback, incompatible pipeline targets → E_STATE. A pass must end
in the **same submission**. At submission end an unterminated pass is closed by a synthetic PASS_END and E_STATE is
reported at offset byte_len/op 0; preceding valid work is retained, and subsequent submissions start outside a pass.

Frame.items is the single ordering authority. Resource changes, readback and GPU pass boundaries break 2D batches.
All previously queued 2D draws finish before a GPU begin; GPU end stores results before later 2D draws/readback.
The screen is the same letterboxed logical surface as 2D (RGBA8, not a second canvas). GPU load preserves earlier
screen content; clear/load and later 2D blending observe that content in stream order. GPU passes do not modify the
legacy viewport/transform/scissor/texture/blend/TARGET state. At begin, GPU viewport/scissor cover the whole attachment,
depth range is [0,1], stencil ref 0, blend constant (0,0,0,0); all bindings and pipeline are unset. Bindings persist
on pipeline switch **within** the pass, but nothing persists to the next pass.

### 13.2 Buffers, textures, samplers and shaders

| Opcode | Name | Bytes | Payload, in order |
|---|---|---:|---|
| 0x40 | BUFFER_CREATE | 20 | handle, usage, size, data_ptr, data_len |
| 0x41 | BUFFER_UPDATE | 16 | handle, offset, data_ptr, data_len |
| 0x42 | BUFFER_DELETE | 4 | handle |
| 0x43 | TEXTURE_CREATE | 24 | handle, width, height, mips, format, usage |
| 0x44 | TEXTURE_UPDATE | 32 | handle, mip, x, y, width, height, data_ptr, data_len |
| 0x45 | TEXTURE_DELETE | 4 | handle |
| 0x46 | SAMPLER_CREATE | 32 | handle, min_filter, mag_filter, mip_filter, wrap_u, wrap_v, compare_enable, compare |
| 0x47 | SAMPLER_DELETE | 4 | handle |
| 0x48 | SHADER_CREATE | 24 | handle, stage, language, source_ptr, source_len, request |
| 0x49 | SHADER_DELETE | 4 | handle |

BUFFER_CREATE usage is a nonempty OR of VERTEX=1, INDEX=2, UNIFORM=4. Size is positive, at most 64 MiB. data_len is
0 (zero-initialize) or exactly size; UPDATE length is positive and replaces precisely [offset,offset+data_len).
All upload/source bytes are copied before submit returns, even if guest memory overlaps the command stream; backend
items use owned copies, never the original pointer. Deleting a buffer is safe outside a pass; bindings are pass-local.
Uniform bytes have the layout agreed by shaders (std140-compatible, see binding convention).

Texture usage is nonempty OR SAMPLED=1, ATTACHMENT=2. Dimensions are 1..4096; mips is 1..1+floor(log2(max(width,height))).
At mip L dimensions are max(1,floor(width/2^L)), max(1,floor(height/2^L)). No implicit extra mips or auto-LOD generation.

| Format | Value | Bytes/texel | Interpretation |
|---|---:|---:|---|
| RGBA8 | 0 | 4 | linear normalized RGBA |
| RGBA8_SRGB | 1 | 4 | RGB sRGB decode on sampling/encode on attachment write; alpha linear |
| R8 | 2 | 1 | normalized red, sample (r,0,0,1) |
| RG8 | 3 | 2 | normalized red/green, sample (r,g,0,1) |
| RGBA16F | 4 | 8 | four LE IEEE binary16 values |
| DEPTH24_STENCIL8 | 5 | 4 | depth normalized 24-bit, unsigned stencil 8-bit |
| DEPTH32F | 6 | 4 | float depth |
| NONE | 0xffffffff | — | pipeline with no depth attachment (not a texture format) |

All listed formats are part of CAP_GPU; a backend lacking native attachment support must implement it or leave the
capability unset. TEXTURE_UPDATE accepts tightly packed color data and 2D depth data; 3D/array depth remains E_UNSUPPORTED.
For DEPTH32F the bytes are little-endian float depth; for DEPTH24_STENCIL8 they are little-endian 24-bit depth in the
high three bytes plus stencil in the low byte. `data_len` is exactly width*height*bytes_per_texel. Region must fit the
selected mip. Coordinates and normalized sampling origin are top-left; no upload flip is guest-visible. Depth textures
can be sampled (depth aspect only; stencil sampling is absent). Attachment writes are stored; there is no discard/store option.

Sampler filters: min/mag NEAREST=0, LINEAR=1; mip NONE=0 (base level only), NEAREST=1, LINEAR=2 (trilinear).
Wrap CLAMP=0 (edge), REPEAT=1, MIRROR=2. Compare enable is boolean; compare uses the enum below. Comparison samplers
require a depth format; comparison produces depth-test samples. Non-comparison depth sampling returns depth in red.
Sampler LOD clamps to allocated levels, LOD bias 0, anisotropy 1. No mutable sampler state or border color.

Shader stage VERTEX=1, FRAGMENT=2, COMBINED=3. Languages WGSL=0, GLSL330=1, GLSLES300=2. COMBINED is WGSL only;
otherwise a module contains exactly its declared stage. Source is positive-length strict UTF-8 without NUL, at most
1 MiB, copied during submit. GLSL starts with `#version 330 core` or `#version 300 es` respectively, ES includes
precision declarations. Entry points are WGSL `vs_main` / `fs_main`, GLSL `main`. Source-language errors (including
bad version, entry point, illegal bindings/reflection) are compilation errors, not synchronous payload errors.
WGSL combined can occupy both pipeline shader fields. The two shaders in a pipeline must use the same language and
supply the appropriate stages (E_INVALID). No cross-language linking or automatic GLSL translation is required;
backends may translate and advertise additional language bits once conformant.

SHADER_CREATE reserves its caller-selected `request` through the **existing** §12 request allocator (same ID space,
32 outstanding/8 MiB result budget, duplicate/invalid/limit errors unchanged). It returns BGT_OK after queuing, not
a compilation result. The backend eventually invokes the item's `complete(code, log)` exactly once: BGT_OK on
successful compilation, E_IO on compile/reflection/device failure, with UTF-8 log text (empty allowed, truncated to
1 MiB). The ready request data is **i32 LE compile_status followed by UTF-8 log bytes**, no NUL. request_status is 1
even when compile_status is E_IO, so request_read can retrieve diagnostics. Results remain invisible until a later
update boundary, exactly as other requests. Closing cancels result delivery, not compilation or the shader object.
Deleting a pending shader does not cancel its request; stale completion must not mutate a reused shader handle.
A pipeline requires both shaders successfully compiled (pending/failed → E_STATE). Profiles wait for the request,
read the status and log, and close it before reusing the ID. A shader referenced by any live pipeline cannot be
deleted (E_STATE); delete the pipeline first. A failed shader remains allocated until explicitly deleted.

### 13.3 Pipeline layout and immutable state

0x4a PIPELINE_CREATE: 104-byte header, then buffer_count * 8 bytes of vertex layouts, attribute_count * 16 bytes
of attributes, color_count * 36 bytes of color states, with **no pointer or padding** between arrays.
0x4b PIPELINE_DELETE: 4 bytes, handle. Pipeline fields are immutable.

The 26 header words (byte offset = index*4):

| Index | Field | Meaning |
|---:|---|---|
| 0..2 | handle, vertex_shader, fragment_shader | GPU resource namespaces |
| 3 | topology | POINTS=0, LINES=1, LINE_STRIP=2, TRIANGLES=3, TRIANGLE_STRIP=4 |
| 4..5 | cull, front_face | NONE=0/FRONT=1/BACK=2; CCW=0/CW=1 |
| 6 | depth_format | NONE, DEPTH24_STENCIL8 or DEPTH32F |
| 7..9 | depth_test, depth_write, depth_compare | booleans, compare enum |
| 10..12 | stencil_enable, stencil_read_mask, stencil_write_mask | boolean, u8 masks (u32 words) |
| 13..16 | front_compare, front_fail, front_depth_fail, front_pass | front-face stencil compare and ops |
| 17..20 | back_compare, back_fail, back_depth_fail, back_pass | back-face stencil compare and ops |
| 21..22 | uniform_mask, texture_mask | bits 0..7 declare slots required by either stage |
| 23..25 | buffer_count, attribute_count, color_count | <=8, <=16, <=4; zero allowed |

Depth test/write require a depth format; stencil_enable requires DEPTH24_STENCIL8. Disabled depth test behaves as
ALWAYS (depth_write can still write). Disabled stencil preserves stencil. Compare enum (also sampler): NEVER=0,
LESS=1, EQUAL=2, LEQUAL=3, GREATER=4, NOT_EQUAL=5, GEQUAL=6, ALWAYS=7. Stencil comparison is
`(reference & read_mask) compare (stored & read_mask)`. Ops KEEP=0, ZERO=1, REPLACE=2, INCREMENT_CLAMP=3,
DECREMENT_CLAMP=4, INVERT=5, INCREMENT_WRAP=6, DECREMENT_WRAP=7. Ops apply to 8-bit stencil, with write_mask
preserving masked-off bits. REPLACE uses dynamic stencil reference. No depth bias, clamp, conservative raster or
polygon mode in this version. Point size 1; line width 1; primitives with insufficient final vertices are ignored.
Primitive restart is disabled, including all-ones index values. No strip-to-list reordering may change winding.

Vertex layout record (8 B): `stride, step`; stride positive multiple of 4, <=2048; step VERTEX=0 or INSTANCE=1.
Buffer slot is its index in this array. Attribute (16 B): `location, buffer, offset, format`. Location 0..15 unique;
buffer must index an existing layout; attribute end must fit stride. No overlapping-location alias; overlapping
byte ranges are legal. Formats and byte sizes: FLOAT=0/4, FLOAT2=1/8, FLOAT3=2/12, FLOAT4=3/16, UNORM8X4=4/4,
SINT=5/4, SINT2=6/8, SINT3=7/12, SINT4=8/16, UINT=9/4, UINT2=10/8, UINT3=11/12, UINT4=12/16.
Offsets align to 4 except UNORM8X4 (alignment 1). Integers are signed/unsigned 32-bit per component; UNORM converts
to float [0,1]. No packed/half/double vertex formats; profiles expand those into supported formats.

Color state record (36 B): `format, blend, src_rgb, dst_rgb, op_rgb, src_alpha, dst_alpha, op_alpha, write_mask`.
Format 0..4, blend boolean. Each channel computes `op(src*src_factor, dst*dst_factor)`, separately RGB and alpha;
when disabled source replaces destination. Write mask bits R=1,G=2,B=4,A=8 (zero legal). Factors ZERO=0, ONE=1,
SRC_COLOR=2, ONE_MINUS_SRC_COLOR=3, DST_COLOR=4, ONE_MINUS_DST_COLOR=5, SRC_ALPHA=6, ONE_MINUS_SRC_ALPHA=7,
DST_ALPHA=8, ONE_MINUS_DST_ALPHA=9, CONSTANT=10, ONE_MINUS_CONSTANT=11. For alpha, color factors mean that color's
alpha component. Ops ADD=0, SUBTRACT=1, REVERSE_SUBTRACT=2, MIN=3, MAX=4; MIN/MAX ignore factors. Normalized targets
clamp output to [0,1]. No dual-source blending, logic op or alpha-to-coverage. Blend constant supplies RGBA factors.

### 13.4 Passes, state, bindings and draws

| Opcode | Name | Bytes | Payload, in order |
|---|---|---:|---|
| 0x4c | PASS_BEGIN | 28 + color_count*28 | color_count, depth_texture, depth_mip, depth_load, stencil_load, f32 clear_depth, clear_stencil; then color records |
| 0x4d | PASS_END | 0 | — |
| 0x4e | PIPELINE | 4 | handle |
| 0x4f | VIEWPORT | 24 | f32 x, y, width, height, min_depth, max_depth |
| 0x50 | SCISSOR | 16 | x, y, width, height |
| 0x51 | STENCIL_REF | 4 | value |
| 0x52 | BLEND_CONSTANT | 16 | f32 r, g, b, a |
| 0x53 | VERTEX_BUFFER | 16 | slot, handle, offset, size |
| 0x54 | INDEX_BUFFER | 16 | handle, format, offset, size |
| 0x55 | UNIFORM_BUFFER | 16 | slot, handle, offset, size |
| 0x56 | TEXTURE | 12 | slot, handle, sampler |
| 0x57 | DRAW | 16 | count, instances, first, first_instance |
| 0x58 | DRAW_INDEXED | 20 | count, instances, first, i32 base_vertex, first_instance |

Color attachment record (28 B): `texture, mip, load, f32 r, g, b, a`. Load ops LOAD=0, CLEAR=1 (depth/stencil use
the same enum). Clear colors are finite floats, converted/clamped to the target representation; sRGB clear values
are linear. Clear depth is finite [0,1]; clear stencil/ref <=255. Clear ignores scissor/write masks. Depth_texture=0
means no depth attachment (depth_mip/depth_load/stencil_load must be zero). DEPTH32F requires stencil_load=LOAD.
Every attachment must have ATTACHMENT usage, the appropriate color/depth format and a valid mip. All selected mip
sizes must match. At least one attachment is required, depth-only legal. No texture may occur twice, even different
mips; duplicates/feedback → E_STATE. Texture=0 in a color record means screen, requires mip 0 and color_count=1;
optional depth texture must match logical dimensions. Pipeline color count/formats and depth format must exactly
match the active pass on PIPELINE binding, otherwise E_STATE. Sampling any active attachment, even another mip,
is forbidden. Legacy readback cannot read GPU-namespace textures; a profile renders/copies through the screen when
it needs the existing screen READBACK interface. No new readback alias is implied.

Viewport/scissor use attachment pixels, top-left, +y down; screen coordinates are logical and letterbox-scaled.
Viewport finite x,y>=0, width,height>0, fits attachment, depth range 0<=min<=max<=1. Scissor unsigned, fits attachment;
zero area is legal and suppresses rasterization. Blend constant components finite [0,1]. GPU NDC is +x right, +y up,
z in [0,w]; front-face winding is measured in this NDC xy plane **before** top-left viewport conversion. Profiles
translating legacy GL [-w,w] depth convert z to (z+w)/2. Backends translating to GL clip space convert z to 2z-w;
backends adjust Y/front-face and texture orientation so the same BGT source renders the same orientation on both.
Fragment position is top-left pixel centre with depth [0,1]. No guest-visible backend flip is permitted.

VERTEX/INDEX/UNIFORM_BUFFER require corresponding usage bits and positive size fitting the buffer. Vertex offset
multiple of 4; index format UINT16=0 or UINT32=1, offset and size multiple of 2 or 4 respectively. Uniform offset
multiple of 256, size multiple of 16 and <=65536. Slots 0..7; uniform and texture slots are independent namespaces.
TEXTURE requires SAMPLED usage and an existing sampler. Every pipeline layout buffer slot must be bound, even if
no attributes reference it. Required masks must be covered before a draw; extra bound slots are harmless. Buffer
and texture bindings need not wait for PIPELINE. No automatic binding of handle 0 or dummy buffers/textures.

DRAW: first is first vertex. DRAW_INDEXED: first is first **index**, measured from the bound index range start;
indices are unsigned, add signed base_vertex with no wrap. The resulting vertex index must be 0..0xffffffff.
instances and count are positive; instances<=65535. first_instance offsets instance-buffer fetching as well as
the shader instance index. Vertex-rate fetch uses vertex index; instance-rate fetch uses first_instance+i (divisor
1). Every referenced attribute's last byte must fit its bound range; the validator uses the CPU index shadow to
check indexed draws (including negative base_vertex). It never reads browser GPU memory. All-ones indices are
ordinary indices. first+count-1 and first_instance+instances-1 must fit u32; any out-of-range fetch → E_BOUNDS.
Missing pipeline/index/required vertex/uniform/texture binding → E_STATE. Zero count/instances → E_INVALID, not a
silent no-op. The shared frame vertex budget includes count*instances for GPU draws, plus generated 2D vertices.

### 13.5 Shader binding/reflection convention

There is no arbitrary native binding layout or uniform-location ABI. Profiles translate their API state to these
portable slots, rewriting shader inputs/uniforms as needed. Backends must validate reflection against this convention
and pipeline masks/vertex layouts (unused declared bindings are allowed; an active undeclared slot is an error).
WGSL uses `@group(0) @binding(s)` for uniform buffers s=0..7, `@group(1) @binding(2*s)` for textures,
`@group(1) @binding(2*s+1)` for samplers. A comparison depth texture uses texture_depth_2d/sampler_comparison.
Attributes use `@location(location)`, fragment outputs `@location(color_index)`. Uniform layouts must be std140
compatible on both languages (16-byte vector/matrix/array alignment; explicitly pad scalar/vec2 arrays; no WGSL-only
layout assumptions). Integer vs float attributes must match shader input types. Color output scalar type is float.

GLSL uses `layout(location=L) in` attributes and `layout(location=C) out` fragment outputs. Uniform blocks are
`layout(std140) uniform bgt_uS { ... };` with decimal S=0..7. Backends reflect block names and call
uniformBlockBinding(S); GLSL330/ES300 do not need binding layout qualifiers. Texture uniforms are named `bgt_tS`
(`sampler2D` or `sampler2DShadow`), bound to texture unit S; BGT binds the separate sampler on that unit. No ordinary
non-block uniforms, implicit attribute locations, native binding decorations or dynamic sampler-array indexing.
Varyings have matching names/types/interpolation in GLSL, matching @location in WGSL. Profiles flatten uniform
locations to std140 block ranges and texture units to slots; there is no engine-specific reflection shortcut.

GLSL sources access vertex/instance IDs through `bgt_vertex_index` and `bgt_instance_index` (u32 expressions), and
fragment coordinates through `bgt_frag_coord` (vec4 expression), **not** gl_VertexID/gl_InstanceID/gl_FragCoord
outside a backend-inserted prelude. Backends insert definitions after #version/precision lines. Vertex index includes
first or signed base_vertex; instance index includes first_instance (GL gl_InstanceID alone does not). Fragment
position uses top-left viewport coordinates. WGSL uses corresponding vertex_index/instance_index/position builtins
with the same semantics. Native GLSL gl_Position is the vertex output but holds BGT [0,w] depth before backend
conversion. Backend rewriting/wrappers may use private names prefixed `bgt_internal_`; guest sources must not use
that prefix. Pipeline reflection/link/target incompatibility detected after decoding reports E_IO with diagnostic
through the renderer's onError channel; module compile errors always complete the shader request with log.

### 13.6 Extended limits, backend handoff and recovery

The old 16-byte `bgt_gpu_limits_t` stays unchanged. `gpu_limits(dst,cap)` with cap 16..79 still writes 16 bytes and
byte_size=16. cap>=80 opts into `bgt_gpu_limits_v3_t` (80 bytes, byte_size=80); only those 80 bytes are validated/
written, larger tails untouched. cap<16 → E_LIMIT; misaligned/out-of-range destination → E_BOUNDS, no partial write.
The first 16 bytes retain their existing texture-limit meanings, independent of CAP_GPU. Extension words:

| Offset | Field | Value |
|---:|---|---:|
| 16 | gpu_supported | 1 iff CAP_GPU, otherwise 0 |
| 20 | max_gpu_handles | 1023 per namespace |
| 24 | gpu_budget_bytes | 268435456 aggregate GPU buffers + all texture mips + shader source bytes |
| 28 | max_buffer_bytes | 67108864 |
| 32 | max_vertex_buffers | 8 |
| 36 | max_attributes | 16 |
| 40 | max_binding_slots | 8 each uniform/texture namespace |
| 44 | max_color_attachments | 4 |
| 48 | uniform_offset_alignment | 256 |
| 52 | max_uniform_range | 65536 |
| 56 | max_vertex_stride | 2048 |
| 60 | max_shader_bytes | 1048576 |
| 64 | shader_languages | bit 0 WGSL, bit 1 GLSL330, bit 2 GLSLES300; 0 without CAP_GPU |
| 68 | max_mip_levels | 13 |
| 72 | max_instances | 65535 |
| 76 | reserved | 0 |

These are fixed portable ceilings, not native-driver maxima; unsupported backends still return the ceilings with
supported/languages zero. The legacy max_texture_dimension can exceed the GPU layer's fixed 4096 ceiling. Each allocated GPU
texture mip consumes width*height*format_size; shader sources consume source_len; buffers consume size. No physical
alignment overhead is charged. `gpu_budget_bytes` is a configurable reservation/accounting limit (default 268435456),
not measured physical VRAM; `HostConfig.gpuBudgetBytes` and `game.json` `gpu.budgetBytes` accept validated values from
16 MiB through 0xffffffff. Samplers/pipelines count only against their namespaces. Samplers/pipelines count only against their namespaces. Legacy 2D resources keep
their separate frozen budgets. Queued GPU upload/source copies additionally total at most 256 MiB per frame;
exceeding this → E_LIMIT. All existing submit/command/2D frame limits still apply. Resource updates are ordered, not
coalesced across draws or passes. No backend may reorder a deletion ahead of earlier commands using that resource.

`commands-gpu.ts` exports per-host `GpuState`; `DecodeContext.gpu` and `gpuRequest` enable validation. `host.ts`
accepts `HostConfig.gpuBackend` only together with CAP_GPU; absent/zero-language implementation clears the bit.
Validated `GpuItem` records appear in `Frame.items` in order, with owned `data`/`source`, decoded u32 `words`
(including f32 bit patterns), and shader `complete`. `renderers/types.ts` defines `GpuBackend.languages` and
`execute(item): number`. The backend's frame loop calls execute at the **item's position**, flushing/ending any 2D
batch first, and returns/records nonzero errors via diagnostics; decoding never calls browser APIs. `Renderer.gpu`
is optional; missing is exactly `UNSUPPORTED_GPU` (languages 0, execute returns E_UNSUPPORTED). Current renderers
explicitly return `UNSUPPORTED_GPU` and runtime capabilities omit CAP_GPU. Backend lanes must wire Renderer.gpu into HostConfig and capability
selection when complete; simply adding execute is insufficient. No new browser implementation is hidden in this ABI.

On device loss, pending shader requests must complete with E_IO/log. GPU buffers, textures, samplers, shaders and
pipelines must be recreated from backend-owned descriptors and upload shadows in creation/update order; all
attachment contents are lost (EVENT_TARGETS_LOST), while uploaded content is restored. Maintain CPU buffer shadows
for bounds validation and invalidate no guest handles silently. If a fallback backend cannot support the advertised
languages/features or restore these resources, stop with a diagnostic, rather than continuing with missing objects.

Conformance entry points: `tests/unit/abi-layout.test.ts` compares all C/TS struct offsets, enum/opcode values and
all C encoder output, including inline tails. `tests/unit/gpu-commands.test.ts` covers every accepted op and malformed
structure/ranges/handles/state/ordering/shader results using a recording backend. `requests.test.ts` retains the
unchanged v0.2 module regression and deferred request tests. Browser GPU rendering tests are the backend lanes'
responsibility; this section alone does not claim GPU pixels or an OpenGL 3.3 profile are implemented.

### 13.7 Texture and sampler extensions (additive, opcodes 0x59..0x5d)

Added by lane K6a for GL 3.3 texture/framebuffer semantics. They need `CAP_GPU` exactly like §13 (otherwise
`E_UNSUPPORTED` after framing validation) and are implemented by both the WebGL 2 and WebGPU backends. Existing
opcodes, layouts, the 80-byte limits struct and all legacy behaviour are unchanged; legacy `TEXTURE_CREATE`,
`TEXTURE_UPDATE` and `SAMPLER_CREATE` remain valid and behave as the matching extended form (2D, wrap_w = clamp,
LOD range [0, 1000]). Handles share the existing texture/sampler namespaces. C layouts are
`bgt_gpu_texture_create_ex_t` etc. in `bgt_gpu.h`, encoders `bgt_cmd_gpu_*` in `bgt_gpu_cmd.h`, TS mirrors in
`GPU_OP`, `GPU_LAYOUT`, `GPU.DIM_*`, `GPU.FORMAT_*` and `GPU_LIMITS.volumeDimension/arrayLayers`.

| Opcode | Name | Bytes | Payload, in order |
|---|---|---:|---|
| 0x59 | TEXTURE_CREATE_EX | 32 | handle, dimension, width, height, depth, mips, format, usage |
| 0x5a | TEXTURE_UPDATE_EX | 40 | handle, mip, x, y, z, width, height, depth, data_ptr, data_len |
| 0x5b | SAMPLER_CREATE_EX | 44 | handle, min_filter, mag_filter, mip_filter, wrap_u, wrap_v, wrap_w, compare_enable, compare, f32 min_lod, f32 max_lod |
| 0x5c | TEXTURE_READBACK | 36 | handle, mip, x, y, z, width, height, depth, request |
| 0x5d | TEXTURE_GENERATE_MIPS | 8 | handle, base_level |
| 0x5e | TEXTURE_ALLOCATE_MIPS | 8 | handle, allocated_mips (grow native storage through this exclusive level) |

**New formats** (valid only through `TEXTURE_CREATE_EX`; the legacy op still rejects them): RGB10A2=7 (unorm 10/10/10/2,
LE u32 `r | g<<10 | b<<20 | a<<30`, 4 B), R16F=8 (2 B), RG16F=9 (4 B), R32F=10 (4 B), RG32F=11 (8 B), RGBA32F=12
(16 B). All are sampleable and color-attachable. R32F/RG32F/RGBA32F filter linearly and blend only where the backend has
the native capability (WebGL 2 `OES_texture_float_linear`/`EXT_float_blend`, WebGPU `float32-filterable`/
`float32-blendable`, requested best-effort at device creation); otherwise the offending create/binding/pipeline fails with
`E_IO` and a diagnostic, never a silent fallback.

**TEXTURE_CREATE_EX.** `dimension` 2D=0, 3D=1, 2D_ARRAY=2. For 2D `depth` must be 1 (`E_INVALID`). 3D width/height/depth
and array layers are <=256 (`E_LIMIT`; fixed portable ceilings, array width/height remain <=4096). 3D and array textures
are color-only and SAMPLED-only: depth formats or ATTACHMENT usage → `E_UNSUPPORTED` (no layered attachments). Mip
extents: width/height halve (min 1); 3D depth halves (min 1); array layers are constant. `mips` is
`1+floor(log2(max(dims)))` at most, over the 2 (2D/array) or 3 (3D) extents. Native storage is allocated lazily: creation
reserves level 0; an explicit update/readback/attachment use of a higher level grows through that level, and generation
grows through the logical mip count. Budget counts only allocated texels. Textures start zero (depth 1 / stencil 0 for depth formats).

**TEXTURE_UPDATE_EX.** Color formats and 2D depth formats are accepted. The region `[x,x+width) × [y,y+height) × [z,z+depth)`
must fit the selected mip (`E_BOUNDS`; `z` is a slice for 3D and a layer for arrays, always 0/1 for 2D).
`data_len` is exactly `width*height*depth*bytes_per_texel`, rows tightly packed top-to-bottom, slices in order.

**SAMPLER_CREATE_EX.** `wrap_w` applies to 3D textures. LOD values are finite, `0 <= min_lod <= max_lod <= 1000`.
`mip_filter` NONE reads exactly level `floor(min_lod)` (level 0 for legacy samplers); otherwise the computed LOD
is clamped to `[min_lod, max_lod]` and then to the allocated levels. Comparison samplers still require a depth texture.
Texture dimension must match what the shader declares for the slot (`sampler2D`/`sampler2DShadow` → 2D, `sampler3D` → 3D,
`sampler2DArray` → 2D_ARRAY); a mismatch is a backend error (diagnostic, draw skipped). Array coordinates are
`vec3(u, v, layer)` with the layer rounded to nearest and clamped; the GLSL330/ES300 and WGSL conventions are in §13.5
extended with `sampler3D`, `sampler2DArray` (WGSL `texture_3d<f32>`, `texture_2d_array<f32>`). BGT has no LOD bias,
border colour or swizzle; profiles that expose those GL features must approximate and say so.

**TEXTURE_READBACK.** Color and DEPTH32F formats are accepted (`DEPTH24_STENCIL8` stencil readback is unavailable where the backend cannot sample its stencil aspect; such a request returns `E_UNSUPPORTED`; `E_LIMIT` above 8 MiB result). Reserves `request`
from the §12 allocator and, in stream order, returns the stored texels of the region as `width*height*depth*bytes`
tightly packed bytes (rows top-first, slices in order, storage layout of the format; sRGB bytes are the encoded values,
floats are exact binary16/binary32). Ordinary request visibility rules apply (visible after a later update boundary).
It observes all earlier passes and updates. This replaces the old "no GPU texture read-back" rule for textures only; the
legacy screen READBACK is unchanged.

**TEXTURE_ALLOCATE_MIPS.** Grows native storage to contain levels `[0, allocated_mips)`, monotonically, preserving all previously allocated
contents including rendered contents. Only newly represented levels consume budget; failed growth leaves resource state and
accounting unchanged.

**TEXTURE_GENERATE_MIPS.** Regenerates levels `base_level+1 .. mips-1` from level `base_level` by 2×2(×2) box filtering
(sRGB averaged in linear space; odd extents are implementation rounded). Color formats only. WebGL 2 uses
`generateMipmap`; WebGPU uses render passes (2D/array) or a CPU box filter over its upload shadow (3D, which can never be
a render target). On device restoration, generated levels are recomputed from the restored uploads; rendered contents are
lost as for all attachments.

Conformance: `tests/unit/abi-layout.test.ts` (C/TS layouts, enums, encoders), `tests/unit/gpu-commands.test.ts` (every
accepted and rejected form), the backend suites, and the `x64-gl-fbo` fixture (pixels on both backends plus a documented
cross-backend tolerance, see `docs/handoff/K6a.md`).
