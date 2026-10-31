# WebGPU §13 backend

`WebGPURenderer.gpu` implements all 25 ABI operations with native WebGPU resources. The runtime advertises
CAP_GPU only with an executable backend and passes that backend to the per-host validator. Wire layouts,
ceilings and guest interfaces are unchanged; this implementation adds no ABI fields or opcodes.

## Ordering and pixels

`Frame.items` remains the ordering authority. Resource changes, pass boundaries and readback flush 2D passes.
After the first GPU **screen** pass, one retained RGBA8 **logical-size** surface holds both 2D and GPU commands,
followed by nearest-sampled letterboxed presentation. GPU screen LOAD, legacy blending and request readback all
observe that surface, including later 2D-only/resource-only submissions. Guests that never use GPU screen passes
retain the original physical-pixel 2D raster path, including its fractional-scale edge coverage. A final physical
snapshot preserves update-driven guests during empty paused captures; resize crops the old letterbox into the
new one rather than stretching bars or clearing the image. Device loss invalidates these attachment snapshots. There is no second canvas or guest texture-namespace alias.

`gpu.ts` consumes owned decoder snapshots; no browser operation reads guest upload pointers. It implements
strip-to-list expansion (all-ones indices are not restart), signed base vertex and first instance, and repacks
byte-aligned UNORM8X4 attributes to WebGPU's more restrictive layout without changing guest bytes. Native
validation errors go to renderer diagnostics. Shader errors instead finish the existing request with E_IO
and line/message text, without also emitting an uncaptured GPU error.

## Runtime shader translation

`shaders.ts` is a dependency-free, kit-maintained GLSL 330 core / ES 300 frontend, versioned with the backend.
WGSL is passed unchanged to the native compiler after ABI reflection validation. GLSL is tokenized/parsed
at runtime, translated to WGSL, then validated by the native compiler. No network, native subprocess,
build-time shader conversion, shader-name lookup, or engine-specific shader substitution is involved.

The practical frontend supports the §13 block/sampler naming convention, std140 scalar/vector/matrix
members and explicitly padded arrays, named/instance uniform blocks, attributes, name-linked varyings,
interpolation qualifiers, helper functions, local/global declarations, arithmetic, casts/constructors,
fixed-size array constructors/indexing, swizzles (including writes), conditionals, loops, discard, common math/derivative builtins,
texture/explicit-LOD/gradient/fetch/size operations, comparison depth sampling, portable IDs, and top-left
fragment coordinates. `gl_FragCoord` is accepted as an additional frontend alias of `bgt_frag_coord`, as
requested by lane WG; clip z remains BGT [0,w], not legacy GL [-w,w]. GLSL mat2 uniform columns receive
std140 padding and are reconstructed on use. Separate shader modules are relinked with one shared varying
location map on pipeline creation.

This is not an unrestricted desktop GLSL compiler: preprocessing beyond #version, user structs,
out/inout helper parameters, implicit ordinary uniforms, sampler arrays, and unsupported syntax produce
readable compilation failures, never guessed WGSL. Profiles already have to flatten API uniform locations
and rewrite their bindings per §13.5. Extend this general frontend rather than adding per-engine patterns.

`depth.ts` handles WebGPU's ban on non-comparison filtering of depth textures. GLSL sampler2D bindings
are specialized to their bound depth format, and depth sampling is lowered to textureLoad with the
immutable sampler's nearest/bilinear/mip/wrap rules. WGSL non-comparison depth samples use the same
lowering; comparison samplers retain native comparison sampling. Derived pipelines are cached by sampler
**descriptor**, not handle, so deletion/reuse cannot select stale state. Derivatives determine implicit LOD.

## Recovery

Descriptors and compact per-mip upload shadows restore resources after device loss; buffer byte updates
are retained in CPU shadows. Attachment contents are deliberately lost and EVENT_TARGETS_LOST is emitted.
Pending shader requests complete exactly once with E_IO and a loss log. Deleted/reused shader handles do
not receive stale readiness updates. Pipelines are recreated only after shader recompilation; failed
restoration is reported rather than silently continuing with invalid handles. Recovery preserves the
backend object referenced by the validator. The existing 2D WebGPU→WebGL 2 fallback remains supported;
without live GPU resources its capability/limits are renegotiated, while live §13 resources stop with an
explicit diagnostic if the fallback cannot restore them.

## Tests

- [`examples/gpu-scenes`](../../../examples/gpu-scenes/README.md): one fixture/common GLSL golden for both backends;
  its `wgsl-scenes.c` retains additional native-WGSL and shader-lifetime cases selected with arg1=2/3;
  exact guest request readback and pixel expectations, indexed triangle, mip alpha, MRT, depth/stencil,
  1,000 sprites with nonzero first instance, animation, GLSL/WGSL, and interleaving.
- `tests/e2e/gpu-webgpu.spec.ts`: all eight pixel scenes and resource/pipeline restoration.
- `tests/e2e/gpu-webgpu-conformance.spec.ts`: all-op coverage, ES300, native shader compilation, error/loss
  handling, every texture format, byte updates, unaligned attributes, strips/base vertex, depth filtering.
- `tests/unit/gpu-webgpu-shaders.test.ts`: translation/reflection and readable failure regressions.

Run browser tests with `BGT_REQUIRE_WEBGPU=1` to turn unavailable hardware into failure instead of a skip.
