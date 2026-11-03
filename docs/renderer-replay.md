# Renderer frame recording and replay

This debug-only, engine-agnostic harness records **all renderer input from startup**, not an incomplete list of live descriptors. Recordings contain private shaders/uploads; keep them OUTSIDE Git.

## Capture (already-built game, dev probe)

Use the generic deterministic driver (or a custom scratch input script):

```sh
npm run probe -- --game YOUR-ID --backend webgl2 --script tools/probe/record-to-frame.mjs --params recordTo=7063 --record-frame 7063 --out /private/scratch/title
```

The probe exposes its sink **before navigation/init**. The runtime awaits each snapshot before drawing or consuming it. This is opt-in, adds no game ABI import/opcode, and does not replace native results with CPU shadows. The probe fails if the script does not render the exact requested update. Use one runtime lifetime per recording; do not navigate/restart within a recording.

## Versioned format

UTF-8 NDJSON, schema `game-cask/renderer-recording/1`:

- Header: `{type:"header", schema, fromStartup:true, targetUpdate:N}`.
- Frame: `{type:"frame", sequence:0.., update, width,height,logicalW,logicalH,letterbox,vertices,items}`. Dimensions/letterbox are recorded, not inferred from another browser. `vertices` is base64 of exact legacy vertex bytes, including raw u32 color bits. Items retain every non-function field; `data` is exact base64 owned upload bytes; `source` is exact shader source. GPU words retain wire unsigned bits. Guest pointers are not dereferenced on replay. Callbacks are delivery plumbing, not renderer input.
- End: `{type:"end",frames:COUNT,targetUpdate:N}`, written only after target input is captured.

The first rendered frame includes all init-time resource work (it may be update1 in a paused probe; recording does not add an extra guest render). All rendered frames are retained, including empty frames/repeated renders of an update. Real execution preserves handle generations, rendered texture/mip contents, feedback-produced buffers, copies/blits, and inter-frame LOADs. The file streams to disk with backpressure, one frame at a time (not accumulated in browser RAM). Missing footer/gaps fail, never imply a zero-resource checkpoint. Device/context loss is outside this format.

## Replay

Build the CC0 sample once (server readiness only), then:

```sh
npm run build:sample
npm run probe:replay -- --input /private/scratch/title/frame-recording.ndjson --out /private/scratch/replay --port 5198 --save-targets
```

Own identity-checked Vite server, never :5173; real Chromium WebGL2 + WebGPU and production renderers. No guest/profile/shader substitution runs during replay. Startup frames execute normally. In the target frame, ordered native readbacks follow each PASS_END (each attachment) and BLIT (destination), without splitting/reordering passes. Final screen is read too. Context/device loss, shader/native errors, unavailable WebGPU and incomplete files fail closed. Exit1 for any byte difference or error.

`diff.json` reports the first differing pass, exact differing pixels/bytes and maximum byte delta per target. Screen PNGs and raw RGBA8 bytes are always saved. `--save-targets` also saves raw native texels for every inspected target (LE binary16/32 floats). Comparison is exact: shader/filter rounding differences are not hidden by tolerances. Packed depth24/stencil8 snapshots are explicitly omitted: WebGPU has no packed stencil texture readback. Depth32 snapshots are real depth floats. Colors/depth32/screens are measured, not reconstructed from upload shadows.
