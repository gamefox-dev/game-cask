# GL output/range/continuation contracts

Original **CC0-1.0** fixture, normal Win64 `-O2`/CRT pipeline, no BGT imports or overrides, no captured sources.

- Four RGBA8 MRT attachments, sparse outputs at locations 1/3, exact written/untouched pixels, intersected color
  masks and a fragment entry point with no outputs.
- Linked std140 80/176/192-byte blocks, reflected offsets, program-local bindings, reversed two-block declaration
  order, shared context binding points, nonzero aligned ranges, arbitrary range sizes, full-width invalid arguments,
  unbind, backing-store resize and relink reset. Every raster expectation checks all four channels.
- Desktop WGL undefined-result policy: short bound UBOs retain the app prefix and zero-fill only missing bytes,
  counted approximation and once-per-linked-program/block/binding diagnostic. A GLSL ES300 feedback shader reads a
  **GPU-generated** short prefix plus zero tail, proving context policy does not depend on source language and no
  stale CPU shadow/unrelated app bytes are substituted. See reviewer amendment #107/#108 in the K14b handoff.
- A single uninterrupted update submits **3000** ordered feedback draws with changing buffer updates, native ping-pong
  dependencies, and 3000 distinct audit words. Every word is compared, not just the last result. No yield in the loop.
- glCopyBufferSubData exact byte-granular copies, all nine desktop GL3.3 buffer targets, same-buffer disjoint ranges,
  overlap/negative/bounds/zero-size errors and GPU-generated odd-byte copies. Pixel-buffer transfers remain explicit
  unsupported errors rather than client-pointer misinterpretations.

`tests/e2e/x64-gl-ranges.spec.ts` requires every guest check on WebGL2/WebGPU, checks continuation metrics and budgets,
zero runtime/command errors, exact finish pixels and cross-backend equality. Direct native `gpu-outputs` and
`gpu-buffer-copy` browser suites complement this fixture with canonical GLSL330/ES300/native combined WGSL interfaces
and every byte alignment. The recording oracle never rasterizes/executes shaders: its known GPU-dependent failures
are asserted separately, and the 300-frame differential oracle compares semantic API/GPU transport only.
