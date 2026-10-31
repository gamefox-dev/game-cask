# One GPU conformance fixture (CC0)

`gpu-scenes` is the single §13 fixture/build. There is no `gpu-scenes-wgpu` executable.

- `arg0=0..7`, `arg1=0`: common GLSL330/ES300 streams: indexed triangle (negative base vertex), mip/alpha quad,
  asymmetric sampled MRT, depth/stencil, 1,000 instances, animated std140 UBO, top-left fragment positions,
  and legacy 2D → GPU LOAD/viewport → legacy 2D. Scenes 8/9 retain wide-stride and first-instance cases.
- `arg1=1`: same common scene, freezes after its ordered guest readback (paused-presentation/resize regression).
- `arg1=2`: retained native WGSL, shader-deletion/reuse and GLSL frontend-specific cases from the former fixture,
  in `wgsl-scenes.c`; WebGPU only. `arg1=3` selects their ES300 variant. These are additional coverage, not a
  different cross-backend golden. Unsupported WGSL on WebGL 2 is not disguised as success.

`tests/e2e/gpu-webgl2.spec.ts` asserts the common scene pixels on **both** backends (the historical filename remains
for lane-specific recovery tests). WG tests use the same fixture's additional cases without dropping old assertions.
`gpu-cross-backend.spec.ts` compares every common scene using separate backend launches. Chromium's native Metal
WebGL implementation does not satisfy §13's indexed-blend/portable-limits gate on this machine, so the cross launch
uses Chromium SwiftShader for WebGL and native Metal WebGPU. Requested backends and shader readiness are asserted.

## Cross-image tolerance

All comparisons are RGB on an opaque canvas: WebGL default-framebuffer readback returns alpha 255, while WebGPU
retains the output texture's stored alpha. Guest ordered readback/blend assertions remain independent of this choice.

- Per-scene probes retain their original exact/2..5-channel tolerances.
- Full images: channel delta ≤2, at most **1.5%** differing pixels; at most **0.1%** may lack a symmetric matching
  RGB within **one device pixel** in the other image. Symmetric matching rejects missing/recolored geometry.
- Common scenes are compared at 160×128 (1:1 logical pixels), avoiding presentation magnification of half-pixel
  raster-edge differences. Other browser probes/recovery still exercise the 960×540 fractional-scale presentation.
- Measured: eight scenes match RGB exactly; the two sprite variants differ at **0.78125%**, all within one pixel.
  Differences localize to two horizontal sprite-edge rows at half-pixel boundaries, not shifted instance IDs/colors.

GL/smoke use the same comparator at 960×540, with separate per-tile goldens. Measured differing RGB fraction is
**1.1040%** (held-input smoke **1.1048%**), symmetric-unmatched **0**. Same-backend repeated captures and smoke's
released-input/terminal images require **bit-exact RGB**. The tolerance does not relax API/oracle hashes or sample
assertions. An explicit reviewer decision timed out to the documented edge-aware default; no prior tests were weakened.
