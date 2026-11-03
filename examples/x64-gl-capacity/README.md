# GL object-name capacity (CC0 fixture)

Original CC0-1.0 Win64 PE source. No captured game content, overrides or BGT imports.
The fixture holds 600 names in each of nine supported GL namespaces, uploads 600 textures and
buffers, then draws using the late VAO, texture, buffer and sampler. Actual WebGL2/WebGPU tests
pixel-check green (late objects), blue (delete/re-generation), and red (full-width GLuint bindings).
A retained unbound FBO continues to read the deleted texture generation, not the reused name.
The recording unit oracle does not rasterize and expects exactly the three screen-pixel failures.

## Bounds and reservations

Guest GLuints are independent of both slots and wire handles: 1023 slots per namespace; zero is
never generated. Arbitrary nonzero texture/buffer/FBO/RBO bind-created names are supported, including
0xf1234567. Shaders and programs share a guest name space but have separate slot tables. Unbound
containers retain deleted object generations until detached; retained generations still consume slots.
Transform-feedback object names/pause remain unexposed; their buffer/query bindings are supported.

ABI §13 is unchanged: 1023 handles per GPU namespace, shared dynamic pools. Preserve the historical
private IDs for wire-oracle stability; exclude reservations even when not materialized:

- Texture pool: reserve **900..921** (depth 900; fallbacks 901..905/920..921;
  sparse-output private images in 904..918); **1001 public texture/renderbuffer storage handles**.
- Buffer pool: reserve **1000..1006 and 1023** (padded UBOs and current attributes);
  **1015 buffer/ordinary-program-uniform handles** shared dynamically.
- Shader stages: **1023** compiled/link-snapshot handles shared dynamically; a linked program usually
  needs two additional stages. Sampler descriptors: **1023**, shared by equal immutable descriptors.
  Existing pipeline descriptor cache remains 128 (not a guest GL object namespace).

The aggregate GPU reservation defaults to 256 MiB and remains configurable per ABI; host memory,
texture bytes, upload/submission and shader/pipeline bounds may be reached before a handle bound.

## Exhaustion contract and diagnostics

Failed Gen* calls leave output arrays untouched; CreateShader/CreateProgram return zero. All resource
exhaustions raise GL_OUT_OF_MEMORY (0x0505), log object type, reason, live count and failed request count,
and increment porter-visible metrics.gl_objects.<namespace>.{live,peak,failures,failed_requests}.
Deleting resources permits handle/name reuse without aliasing retained generations. The fixture reaches
both real texture/buffer storage and name ceilings and asserts errors, unchanged sentinels and recovery.
Native adapter tests additionally cover all namespace ceilings, shared shader stages, high FBO/RBO names,
mixed storage, deferred lifetimes and rejected creates/deletes/byte-budget/descriptor-cache recovery.
