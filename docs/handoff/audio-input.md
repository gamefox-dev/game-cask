# Lane E — audio and input profiles

## Finish line: complete

Original CC0 fixtures `examples/x64-audio` and `examples/x64-input` go through the normal AMD64 pipeline.
No game files, overrides, engine detection, host execution of Windows programs, new dependencies or system installs.
ABI additions are isolated under **Stereo audio and independent gamepads (Lane E, additive v0.3)** in
`bgt/abi/ABI.md`. Existing 224-byte IO, merged input and mono audio contracts are unchanged.

- COM: table-based class registry (MMDeviceEnumerator), CoInitialize/Ex nesting/apartment mode errors,
  CoCreateInstance class/interface errors, stable IUnknown identity, refcounts, owned task memory,
  PropVariantClear/Copy and InitPropVariantFromString (owned strings tested independently).
- WASAPI: default render endpoint, device activation, shared stereo float32/int16, GetMixFormat, format checks,
  Initialize/GetBufferSize/GetCurrentPadding, Start/Stop/Reset, render GetBuffer/ReleaseBuffer, silent buffers,
  float clipping, deterministic sample repetition/decimation resampling and virtual-clock ring draining.
  Tests cover invalid ordering/counts, uninitialized calls, event requirement, capacity and allocation ownership.
- Events: periodic virtual 10ms signals and main-thread CreateEvent/SetEvent/ResetEvent/WaitForSingleObject polling.
  Stop preserves pending frames; Reset discards them. Browser locked/full queues may drop output without stalling
  the virtual endpoint. No wall-clock state enters endpoint timing.
- Input: separate four-slot Gamepad API snapshots, normalized test injection, packet-change XInputGetState,
  GetCapabilities, SetState best-effort actuator; standard buttons, triggers and Y-axis conversion.
  Raw Input keyboard/mouse registration, WM_INPUT generation-checked handles, RID_INPUT/RID_HEADER size-query,
  buffer-too-small and null-handle paths with native x86/x64 layouts. USER keyboard snapshot shares held state
  with async/key-state APIs, including sided/aggregate modifiers and mouse buttons.

## Evidence and checks

Latest complete gates on branch `lane/E`:

| check | result |
|---|---|
| `npm run doctor` | ready |
| `npm run lint` | clean, including all example build checks |
| `npm run typecheck` | clean |
| `npm test` | **102 passed / 18 files** |
| `npm run test:e2e` | **85 passed, 4 existing skips**; WebGL2 + WebGPU + auto |
| `npm run leakcheck` | clean (235 committable files) |
| explicit `npm run oracle -- examples/<id> 300` | **10/10 identical**, no errors |

Oracle IDs: x64-audio, x64-basics, x64-cpp, x64-cpprt, x64-crt, x64-gui, x64-input, x64-memory, x64-tls,
win32-hello. Reports: `reports/oracle-<id>.json`; logs: `/Users/dev/projects/pi-work/scratch-E/`.
The two new fixtures have zero interpreted instructions and empty stub lists over 300 frames.
Latest built audio: 76 lifted functions / 1,893 instructions / 739,523 wasm bytes;
input: 80 functions / 1,803 instructions / 729,760 wasm bytes. These are total module bytes, not marginal lift cost.

`tests/unit/audio-input.test.ts`: six tests, including both 300-frame differential oracles.
The sink test receives exactly 48,000 stereo frames: 0.5s float32/48kHz followed by 0.5s int16/24kHz converted to
48kHz. Left amplitude ±16,384, right ±8,192 opposite polarity; positive zero-crossing frequency ~1kHz and virtual
span 58–62 fixed frames. Fixed host wall time deliberately prevents a wall-time implementation from passing.
The additive ABI test catches invalid indexes/counts/pointers, snapshot aliasing, stereo partial-acceptance units
and rumble routing. Separate mocked browser-pad polling test prevents injection-only implementations from passing.
Input fixture checks packet/state values, raw K make/break and mouse delta +7/−4, key-state consistency, header queries,
short buffers and invalid handles. Browser tests assert four exact-color squares, held/released state and logs.

`tests/e2e/audio-input.spec.ts`: four passes (two on each actual renderer), real keyboard gesture unlocks audio,
nonzero browser playedFrames, no errors/stubs/interpreter fallback. Full report: `reports/e2e-results.json`.
`x64-input-held.png` attachments for both renderers were decoded into scratch and visually reviewed: **OK** — all
four green state squares have clean corners, PAD / RAW KEY / RAW MOUSE / KEY labels fit above their squares, no
clipping/stale pixels. Earlier truncated fixture label was fixed before final gates. The fixture has no menus or
resources requiring a resource tour. Kit resource-tour tests also passed in the full suite.

## Outside ownership: small marked integration changes

All C/JS touch points have `/* LANE-E */` markers (JSON has that marker in a metadata string).

- `tools/build/pipeline.mjs`: compile the three new shared profile translation units.
- `platforms/win32/w32_core.c`: register their API tables and pump audio/raw input at frame boundaries.
- `platforms/win32/w32_kernel.c`: close fallback events before the existing file-handle path.
- `platforms/win32/w32_user.c`: expose the common HID/VK mapper and queue bridge; GetKeyboardState registration,
  sided/generic modifier consistency and held mouse-button state.
- `platforms/win32/dlls.json`: declare ole32/propsys and three XInput DLL names.

BGT changes are audio/input-only: `bgt/audio/audio.ts`, `bgt/input/input.ts`, audio/input additions in
`bgt/runtime/{host,runtime}.ts`, `bgt/include/bgt.h` and the dedicated ABI subsection.
New fixture/test files and this handoff are lane-owned. Neither status nor verification documents were edited.

## Scheduler handoff and explicit compatibility limits

No guest threads are fabricated. The threads lane should replace the small event adapter in `w32_audio.c`, route
`w32_audio_signal_event` into scheduler wakeups, call `w32_audio_pump` at virtual scheduling boundaries, and include
CoInitialize apartment state in per-thread state. All audio client/ring/refcount state remains independent of that
adapter. Resolve duplicate CreateEvent/WaitForSingleObject names when merging; do not leave registry-order selection.

Scope intentionally excludes optional WinMM waveOut (not cheap once queued callbacks/header ownership are included),
capture, session controls, endpoint enumeration/notifications, exclusive/extensible formats, COM marshaling,
BSTR/variant arrays, unaccelerated physical mouse movement, raw wheel/HID enumeration and low-bit async key latches.
Unsupported COM methods/formats return HRESULT errors, not success stubs. Raw registrations accept only foreground,
INPUTSINK and removal; unknown hardware scan codes are zero. Ring capacity is bounded to 19,200 source frames;
resampling is deterministic but not bandlimited. Physical rumble, Safari/iPhone, and independent fresh-agent
validation were not performed; no such hardware or delegation claim is made. These are compatibility limits, not
unfinished fixture finish-line items.
