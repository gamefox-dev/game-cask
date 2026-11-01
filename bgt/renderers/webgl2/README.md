# WebGL 2 §13 backend

`WebGL2Gpu` executes all 30 GPU §13/§13.7 opcodes in `Frame.items` order. `WebGL2Renderer` restores legacy GL state at
GPU/2D boundaries. The runtime connects `Renderer.gpu` to the host and advertises `CAP_GPU` only when
`languages != 0`. The five additive K6a texture/sampler operations retain all legacy wire layouts.

## Capability and language support

The complete feature gate requires `OES_draw_buffers_indexed` (per-attachment blend equations/factors/masks),
`EXT_color_buffer_float` (RGBA16F attachments), and the portable texture, uniform, vertex-input and binding limits.
If these are missing, ordinary v0.2 rendering remains available but `CAP_GPU` is clear. In particular, mere
availability of a WebGL 2 context is not enough. Shader-language bits are `0b110`: GLSL330 and GLSLES300.

`shaders.ts` translates the portable GLSL 3.30 core graphics subset into GLSL ES 3.00, inserts BGT builtin
expressions and wraps vertex `main` to convert [0,w] depth to GL clip depth and invert attachment Y. Fractional
viewports use a vertex transform plus original homogeneous-clip-coordinate fragment rejection, avoiding native
integer viewport truncation without admitting outside-centre point footprints. Unsupported
desktop-only GLSL constructs fail with a compilation request log, rather than silent approximation. Reflection
validates block names, masks, texture uniforms, input scalar/vector types and linked output locations (including
arrays). Interface declarations must be explicit, not hidden in preprocessor macros. Uniforms use
std140 `bgt_u0..7`; sampler uniforms use `bgt_t0..7`. Native/private builtin access is rejected.
GLSL ES 3.00 has no `noperspective`: the vertex wrapper forwards `value * w` and `w` through the ordinary
perspective-correct varying path and the fragment wrapper divides them, which gives exact screen-linear
interpolation. ES has no implicit int-to-float conversions and the GL profile cannot type-check function bodies,
so desktop shaders relying on them fail with the native ES compiler's log (WebGPU's frontend is more tolerant).

I5 carries floating `sampler3D`/`sampler2DArray` reflection and dimension-specific texture-unit binding through
the GL profile to GLSL ES 3.00 declarations and §13.7 storage. Coordinate conversion flips Y only, preserving
volume Z and array layer; gradients and integer fetches follow the same convention. `x64-gl-fbo` asserts typed
reflection, units 3/5 and pixels for both dimensions on WebGL 2 and WebGPU. Cube maps remain explicitly rejected
(no cube storage in the ABI); array-shadow/integer samplers are also outside the supported GL subset.

**WGSL is WebGPU-only.** This backend does not ship an npm WGSL translator and does not advertise the WGSL bit.
No dependency was added or fetched. A WGSL fixture is therefore not claimed here; WebGPU is a separate lane.

## Storage and driver adaptations

GPU passes use top-row-at-GL-row-zero attachment storage, so uploads, rendered attachments, fragment positions,
viewports/scissors and sampling all share BGT top-left coordinates. Screen passes blit the existing letterboxed
screen into a logical-size RGBA8 attachment on LOAD, then blit back at END. Later legacy draws and READBACK see
the same content, not a separate canvas. Logical screen depth attachments therefore have logical dimensions.

CPU-owned buffer/texture upload shadows support restoration and base-vertex emulation. Indexed draws rebase
indices; `first` and `first_instance` are carried into shader IDs and fetch offsets. Wide vertex strides (>255,
up to the ABI's 2048) are packed into scratch attributes because WebGL's native stride limit is smaller. Sparse
full-width u32 indices use dense native indices and a private integer texture lookup in vertex unit 8, preserving
primitive order and BGT IDs while avoiding GL_MAX_ELEMENT_INDEX and mandatory fixed-index primitive restart.
All-ones indices remain ordinary vertices. Guest texture slots remain 0..7. These are general ABI adaptations,
not fixture/engine-specific paths.

Buffers, textures (including all uploaded mip levels), samplers, successfully compiled shader sources and
pipelines are recreated on context restoration. Attachment-rendered contents are lost; uploads are restored and
the runtime emits DEVICE_RESET plus TARGETS_LOST. Queued resource operations observed during loss are replayed
in order. Shader items observed during loss complete with E_IO/log exactly once and remain failed CPU handles;
they are not recompiled during restoration. Deleting such a handle cannot poison unrelated recovery. Restoration
failure is terminal, never a
silent handle invalidation. Cross-backend migration of advertised GPU resources/languages is not attempted.

## Reproduction

- `npm run build:examples`
- `npx playwright test tests/e2e/gpu-webgl2*.spec.ts --project=chromium-webgl2`
- Native `examples/gpu-scenes` args 0..7: triangle, alpha/mip quad, sampled MRT, depth/stencil, 1,000 sprites,
  uniform animation, ES300 fragment positions, interleaved 2D/GPU/2D. Args 8/9 test wide strides/first instance.
- Every required scene asserts screen pixels and the existing guest screen READBACK result. Backend probes add
  every color/depth format, upload orientation, independent MRT state, reflection errors and full-width IDs.
