# GL current attributes and texture swizzle

Original CC0-1.0 Win64 fixture, compiled normally with `-O2` and the CRT; no BGT imports or overrides.

Sixteen panels assert the actual GL default `(0,0,0,1)`, every `glVertexAttrib1..4f/fv` setter (including the fifth
Win64 stack argument), disabled-array values, enabled-array precedence, context-current values across VAO switches,
three spatially separated and color-distinct instances, and texture swizzle for `texture`, `textureLod`, `textureGrad` and `texelFetch` on texture unit 5.
The guest checks all four channels through `glReadPixels` on an explicit RGBA8 framebuffer, checks GL errors,
invalid-vector atomicity, incomplete-texture black fallback despite all-ONE swizzle, and verifies `glGetTexImage` reads the original unswizzled storage. A separate sampler
object remains bound: texture swizzle must not accidentally come from the sampler.

Browser tests require every guest check, all sixteen RGB panel probes on both backends, no command/runtime errors,
no unimplemented GL entries, and zero approximation metrics. Cross-backend images are compared without changing the
existing `0.015`/`0.001` thresholds. The recording-only unit/oracle backend validates command bytes and transport,
not rendered pixels: all nineteen pixel checks (sixteen panels, two distinct instances and the incomplete fallback) are deliberately
expected to fail there, and nowhere else.

```sh
npm run build:examples
npm run oracle -- examples/x64-gl-current 300
BGT_REQUIRE_WEBGPU=1 npm run test:e2e
```

This fixture covers Q21 current attributes and swizzle only. Depth uploads, integer textures, `glClearBuffer*`,
and lazy mip allocation are not covered or claimed here.
