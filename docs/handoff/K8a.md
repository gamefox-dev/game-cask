# K8a — Q21 checkpoint: current attributes and texture swizzle

## Acceptance / continuation boundary

**Q21 is incomplete. Tier 1 is incomplete. This is a bounded, tested checkpoint, not the lane finish line.**
The reviewer explicitly instructed: commit this checkpoint, then continue with (1) lazy mip allocation/configurable
GPU budget, (2) depth uploads, (3) integer textures/samplers/render targets/readback, (4) indexed `glClearBuffer*`.
The same instruction requires stopping for a fresh session when context exceeds about 60%. This session reached
that boundary; no context compaction was used. The next session must implement those four items, with a commit and
regressions after each, not treat them as accepted exclusions or claim the target's first frame was reached.

Branch `lane/K8a`, base `0838b00`. No push, game files, copied target evidence, system installs or dependencies.
`docs/v03-status.md` is unchanged for integration ownership.

## Delivered

- All eight `glVertexAttrib1..4f/fv` APIs set context-current values (not VAO state), with default `(0,0,0,1)`,
  missing-component defaults and `GL_INVALID_VALUE` for index >=16. The Win64 fourth component is correctly read
  from the fifth argument on the stack. Enabled arrays take precedence over current values.
- Draw lowering supplies disabled active float inputs through one private instance-rate buffer, repeating the
  current values for each instance. This preserves indexed/base-vertex fetching through the unchanged §13 ABI;
  no native-backend special case or new opcode is needed. The buffer is namespace-disjoint handle 1023 (public
  1..255, uniform 701..955), pooled/geometrically grown, and uploads are owned snapshots in draw order.
- `GL_TEXTURE_SWIZZLE_R/G/B/A/RGBA` now actually affects non-comparison sampling. Canonical GLSL emission wraps
  `texture`, `textureLod`, `textureGrad`, `texelFetch` results once, using per-slot selectors after ordinary uniforms
  in `bgt_u0`. Swizzles are refreshed from the texture bound to the program's GL unit, not from the sampler object.
  ZERO/ONE selectors work; `textureSize`, comparison results and stored/readback pixels remain unswizzled.
  No swizzle approximation is counted. Existing float 2D/3D/array support remains; integer support is NOT added.
- GL API census is now **200 implemented / 160 explicit unsupported / 360 total**.

Files: `platforms/win32/w32_gl.c`, `w32_gl_api.h`, `w32_gl_draw.h`, `w32_gl_tex.h`, `w32_glsl.h`.
One shared test hook: `tests/oracle/oracle.ts` selects the existing recording-only GPU oracle for the new fixture.
No additive ABI or renderer file changes are included; incomplete experimental changes were removed before tests.

## Fixture / regression strength

Original CC0 `examples/x64-gl-current` is a normal `-O2` Win64/CRT PE pipeline fixture, no BGT imports/overrides.
`tests/unit/x64-gl-current.test.ts` checks exact error/atomicity/storage contracts, current-value upload bytes
(including repeated instances and the fifth Win64 argument), all four sampling wrappers and selector uniforms.
The recorder never rasterizes: it must fail exactly the 19 pixel checks, not any non-render-dependent check.

`tests/e2e/x64-gl-current.spec.ts` requires all guest checks and 16 panel probes on **each** real backend:
actual current default, every setter, enabled-array precedence, VAO independence, three spatially separated/color-distinct instances, unit-5 sampling
with a distinct sampler object, identity/vector/individual swizzles, and texture/LOD/grad/fetch forms. The guest
reads **all four channels** through an explicit RGBA8 FBO, avoiding reliance on the default framebuffer having
alpha bits. Swizzle queries, invalid-vector atomicity, unswizzled GetTexImage and an incomplete texture with
all-ONE swizzle returning black are asserted. The clear differs from the default-current panel so a dropped draw
cannot pass that pixel check. No tolerances or
existing assertions were relaxed. Cross-backend result: **different=0, unmatched=0**. Screenshot viewed: sixteen
solid-color panels in the expected 4x4 arrangement with letterboxing, no missing panel or unexpected geometry.

Bounded limits: disabled active **float scalar/vector** inputs only (integer current setters remain explicit
unsupported); the extra instance buffer consumes one of eight ABI vertex slots. Existing integer shader-input,
vertex format and GL profile limitations are not expanded silently. No matrix/array current-attribute support is
claimed. No physical iPhone/Safari/Firefox or game title/playability validation.

## Actual gates on this checkpoint

| Check | Result |
|---|---|
| `npm run doctor` | ready, original/ empty |
| `npm run lint` | pass: ESLint, clang + real GCC host checks, **28 example check-builds** |
| `npm run typecheck` | pass |
| `env -u PI_PROVIDER_EXTENSION npm test -- --maxWorkers=1` | **656 pass / 5 fail**, 60 files, no skips; 686.27 s |
| `BGT_E2E_PORT=5218 BGT_REQUIRE_WEBGPU=1 npm run test:e2e` | **211 pass / 51 existing intentional skips / 0 failed / 0 flaky**, 5.6 min |
| `npm run leakcheck` | pass (rerun for staged commit) |
| Every pipeline CLI oracle, explicit 300 frames | **24/24 identical, 7,200 pairs**, null errors, lifted interp=0, stubs=[] |

Browser counts: WebGL2 **95/24 skipped**, WebGPU **108/26**, auto **8/1**. The new fixture accounts for three passing
browser tests, not an availability skip. All existing GL/FBO/GLSL/smoke comparisons remain within unchanged bounds.
Native BGT examples are built/browser-tested, not given fictitious interpreter oracles.

The five unit failures are exactly the known **Q25 sandbox-denied `ps` FIFO/liveness** cases in unchanged
`tests/unit/pi-harness.test.ts`: serialization exit 143 vs75, oldest-first, dead/reused/live-pid ownership,
slot-count change, waiting-ticket signal cleanup. The harness and its assertions were not modified/skipped.
No all-green unit/Tier1 claim: next session must incorporate a reviewer-supplied K7i repair or obtain exact-commit
external verification as directed, not assume the base commit's external validation applies to this tree.

Earlier attempts: an initial `--check` build timed out at 600 s and a focused unit run with global setup timed out
at 300 s during the 1.6M scale build; neither reached test results. A later full unit attempt timed out at 1200 s
without a summary; the complete rerun above is authoritative. First focused tests had 2 GLSL formatting assertions
fail because helper functions separated sampler declarations: keep declarations contiguous, all assertions remain.
First browser probe passed WebGPU but WebGL default framebuffer alpha made four guest checks fail. The fixture now
uses explicit RGBA8 storage; all original RGBA values are asserted and both browsers pass.

Independent review: first fresh pi session failed invalid provider credentials; second failed provider selection;
third explicitly loaded the inherited provider extension and completed a real read-only source review. It found
(1) applying object swizzle to the incomplete-texture fallback, and (2) nondiscriminating default-current/instancing
pixels. Both were fixed: fallback slots now receive identity selectors, clear differs from the default value,
and the three instances have separate geometry/colors with additional left/right probes. Focused post-review
checks: **44 unit tests / 2 files**, **3 browser tests**, cross-image equality. Its original source-review findings
are in `/tmp/k8a-independent3.log`; it did not run tests or claim a Tier1 PASS. The author's gates are not delegated
verification. Scratch logs `/tmp/k8a-{lint,typecheck,doctor-final,test2,e2e,leak}.log`, per-oracle
`/tmp/k8a-oracle-<id>.log`, summary `/tmp/k8a-oracles.json`; those machine-local files are not durable guarantees.
Ignored `reports/e2e-results.json` and `reports/oracle-*.json` retain local results.

## Remaining work — exact next steps (reviewer-mandated order)

### 1. Lazy mip allocation + configurable, truthful budget

Start `platforms/win32/w32_gl_tex.h`: `gpu_create` currently sets `gmips=chain_len(...)` and allocates every level,
including a 4096² DEPTH32F texture's 13-level chain. It also sets `t->gpu` before a failing submit, and `submit`
currently maps every error to BAD_OP. **Do not retain fake live texture state or map budget failure to success.**

Implement necessary-level allocation and preservation when later levels are defined/generated. Existing `tex_image`
allows levels before level0 and explicit mip content; preserve those tests. Growing native immutable storage must
preserve uploaded AND rendered content, not merely replay the CPU upload shadow. An additive texture mip-growth/
copy contract may be needed; document in its own ABI.md subsection, mirror C/TS/encoders/layout tests, implement both
backends and restoration. Do not reserve an opcode without rechecking current ABI/parallel lane ownership.
Validator budget changes must charge actual represented mip sizes and commit resource state only after successful
validation. Profile allocation failure must produce `GL_OUT_OF_MEMORY`, no pretending GPU storage exists.

Budget source today: `GPU_LIMITS.budget=256 MiB` in `bgt/runtime/abi.ts`, used for resources and separately upload
queue in `commands-gpu.ts`; extended limits in `host.ts` report the constant. Make the live resource limit documented
and configurable, bounded by representable/native constraints. Browser APIs do not expose aggregate available VRAM:
never mislabel an estimate as measured device memory. Ask reviewer if configuration/default/device-ceiling policy is
not settled. Regress 4096² DEPTH32F at level0, later 13 defined levels, preserved lower-level contents, exact byte
accounting, configurable pass/fail thresholds, failed-create/failed-growth rollback, and real browser allocation.

### 2. Depth uploads with non-NULL data and allowed readback

Current blockers: `tex_image` / `tex_sub_image` explicitly reject data for depth; `transfer_error`, `decode_pixel`,
`encode_texel`, `decode_texel`, `encode_external`, GetTexImage and ReadPixels need checked depth/packed DS paths.
ABI validator currently rejects all depth uploads/readbacks/mip generation. Do not simply remove those checks.
WebGL2 accepts typed depth texture uploads but cannot directly read depth attachments through ordinary readPixels;
use a truthful ordered depth-sampling/conversion readback path where necessary. WebGPU **does not accept
queue.writeTexture to depth**: implement ordered staging/render-depth upload and supported aspect/readback rules,
including stencil semantics for DEPTH24_STENCIL8, not a forbidden color upload or stale CPU shadow of rendered data.
Depth16/24/32F + packed DS need normalized known answers, pixel-store/type errors, partial uploads, sampled pixels,
readback and recovery tests on both actual backends. Preserve no-data allocation behavior and existing FBO assertions.

### 3. Integer textures, samplers, render targets and readback

Current format table in `w32_gl_fmt.h` rejects R/RG/RGBA integer sizes; transfer rejects `*_INTEGER`.
Use exact integer conversions (do not round-trip 32-bit integer texels through float). Add ABI native integer formats
with exact bytes/component signedness; update validator format/target/clear/sampler class rules, both native format
maps, typed upload/readback, recovery. Integer sampler reflection in `w32_glsl.h` already recognizes GL enum kinds
but intentionally rejects active integer samplers. Canonical emission must retain type, coordinate transforms,
swizzle scalar type, unit bindings and alias checks. WebGPU GLSL frontend/native bind layouts need integer texture
reflection plus integer nearest sampling using textureLoad and immutable wrap/LOD rules (native textureSample is
not legal for integer textures). WebGL2 pipeline reflection must accept typed samplers/outputs. Integer render
outputs disable/ignore blending per GL, not normalized float results. Coordinate shader ownership with K8b.
Original synthetic regressions: every required integer format/type, full-width positive/negative known answers,
integer shader samples, actual integer outputs, exact readback, mismatched transfer classes/filtering/FBO errors.

### 4. Indexed glClearBuffer{fv,iv,uiv,fi}

All four remain GLSTUB. Implement draw-buffer-index selection (including GL_NONE no-effect and appropriate draw
index errors), correct buffer enums and format classes, float/depth/stencil and signed/unsigned handling. Preserve
clear state (these calls do NOT change glClearColor/Depth/Stencil), scissor and write-mask behavior. Existing ABI
pass load clears ignore masks/scissor and encode colors as floats, so they alone are insufficient. Add a portable
ordered clear operation or truthful draw lowering on **both** backends, with integer values not truncated by float.
Test permuted draw-buffer maps, untouched attachments/channels/regions, exact errors and pixel/readback results.

## Evidence handling / completion

Read available private input `iteration-requests.md` then `resume4-call-arguments.json` outside the repository.
The requested `resume4-contract-valid-webgl2/contracts.json` and `resume4-contract-webgpu/contracts.json` directories
were absent in this sandbox at session start. Do not claim to have inspected them; do not copy any inputs into Git.
Original synthetic fixture sources only. The unchanged game was not built/run here and no title/first-draw claim
is made. At final full-lane completion rerun every required gate, every pipeline oracle at 300 frames, and a fresh
independent validation session; update this handoff with actual counts and remaining boundaries.
