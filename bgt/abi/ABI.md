# Game Cask Browser Target (BGT) — ABI v0.2

Status: **v0.2** (adds §11 to the frozen v0.1; every v0.1 game still loads unchanged). The C header is [`bgt/include/bgt.h`](../include/bgt.h) and
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

- Versioning: `BGT_ABI_VERSION = (major << 16) | (minor << 8) | patch`, currently `0x000200` (v0.2).
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
| `BGT_BLEND_INVERT` | 4 | `dst = src × (1 − dst)`; with a white source this is the classic invert (GDI `DSTINVERT`/`PATINVERT` with white) |
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
