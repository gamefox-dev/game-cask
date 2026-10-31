# Lane W2 — WebGL 2 GPU execution

## Finish line

- All 25 §13 opcodes execute in the WebGL 2 frame loop, in stream order. A C-fixture coverage test asserts every
  opcode 0x40..0x58 was exercised. Resources retain generation ordering; shader logs use the existing requests.
- CAP_GPU requires indexed blend, floating-point attachments and portable native limits. Missing either extension
  clears the bit and shader-language mask, while legacy sample rendering and context recovery remain functional.
- Original CC0 native `examples/gpu-scenes` calls §13 directly: indexed RGB triangle (negative base vertex), alpha
  textured/mipmapped quad, MRT with two outputs subsequently sampled, depth plus stencil masking, 1,000 instanced
  sprites, animated std140 UBO, GLSL330 and ES300, and screen 2D/GPU LOAD/viewport/2D interleaving. Additional args
  test 2048-byte vertex strides and nonzero first_instance. No engine/profile/game-specific execution.
- Each of the eight required scenes has exact/tolerance pixels plus the existing guest screen READBACK result.
  Backend probes additionally assert all seven color/depth formats, initialization, sRGB, depth comparisons,
  independent MRT blending/masks, top-left uploads, reflection/compile failures and full-width unsigned IDs.
- Actual WEBGL_lose_context restoration is checked against before/after pixels for nine static scenes. Buffers,
  all uploaded texture mips, samplers, shaders and pipelines are recreated. Runtime events report DEVICE_RESET and
  TARGETS_LOST. A lost-interval probe proves one failed shader completion and ordered queued UBO upload replay.
- WGSL is explicitly **WebGPU-only** here (language mask 6). No translator dependency was added/fetched. The brief
  permits this boundary; no WGSL scene or WebGPU execution is claimed. See backend README for language handling.

## Implementation / contract readings

No ABI/wire change. `bgt/renderers/webgl2/README.md` documents the implementation and reproduction commands.
Screen GPU passes use a logical-size top-row-first backing attachment and ordered letterbox blits, preserving
legacy screen LOAD/readback without requiring device-size depth textures. GLSL wrappers adjust depth/Y and IDs.
CPU upload shadows enable base-vertex rebasing and wide-stride packing. Sparse full-width indexed IDs use a private
integer texture lookup (vertex unit 8), avoiding WebGL's element-index ceiling and fixed-index primitive restart.
WGSL support is not implied by CAP_GPU. Attachment-rendered contents are deliberately lost on restore, uploads
restored. Inability to restore stops with diagnostics instead of silently invalidating handles. Cross-backend
migration of advertised GPU languages/resources is fail-closed; a renderer advertising GPU does not silently
fall back after unrecoverable loss.

## Required checks (sequential, final source)

- `npm run doctor`: ready.
- `npm run lint`: passed (ESLint plus all example builds/checks).
- `npm run typecheck`: passed.
- `env -u PI_PROVIDER_EXTENSION npm test`: **194 tests / 21 files passed**. The ordinary inherited-environment run
  first exposed two existing bridge fixture failures: the live provider adds an extra `-e`, while fake-pi asserts
  its first extension is the workspace bridge. Unsetting only that external provider hook makes the full unchanged
  suite green; no test was skipped, modified or weakened for it.
- `npm run test:e2e`: **113 passed / 32 skipped**. Skips: 4 existing plus 28 WebGL-specific cases in the WebGPU
  project. All **28 W2 browser cases** pass on `chromium-webgl2`; existing 2D/readback/visual conformance unchanged.
- `npm run leakcheck`: passed.
- Ten explicit `npm run oracle -- examples/<id> 300` calls passed: x64-audio, x64-basics, x64-cpp, x64-cpprt,
  x64-crt, x64-gui, x64-input, x64-memory, x64-tls, win32-hello (**3,000 compared frames**, identical/no errors).
- `git diff --check`: passed. No system install, network, original game input or push. No ENOSPC in this session.

Logs are small clone-local `.scratch-W2/*.log`, not committed. The literal brief scratch path
`/Users/dev/projects/pi-work/scratch-W2` is denied by this sandbox; the inherited actual harness scratch is
`/Users/dev/projects/pi-work/runs/p2d/scratch-W2`. The clone-local directory avoided writing elsewhere. No large
scratch build outputs or retained repeated failure traces are needed for the deliverable.

## Ownership and integration

Only tracked exception outside W2's renderer/shader/fixture/test areas is **`bgt/runtime/runtime.ts`**, each edit
marked `/* LANE-W2 */`: CAP_GPU selection, HostConfig.gpuBackend connection, target-loss event and fail-closed GPU
migration guard. This small shared startup/loss glue is necessary for the backend to be observable; coordinate it
with W1 rather than overwriting that lane's implementation. No docs/v03-status.md or docs/verification.md edits.

The resumed uncommitted files were complete (not truncated); they were reviewed, retained and repaired. Added
regressions address driver stride limits, sparse/full-width IDs, shader reflection and translation, incomplete
feature gates, unsupported-context restoration and loss-interval resource replay. No dependency changes.

## Independent review

A separate fresh real pi session performed read-only static review, found three correctness issues and later
rechecked their fixes. No delegation or independent suite execution is invented: the reviewer ran only static
inspection and diff checking, while this author ran all gates above. Reports remain in `.scratch-W2/`:
`independent-review.md`, `independent-recheck.md`, `independent-final.md`. Final reviewer verdict:
**"No blocking findings in the exact repaired areas inspected."**

Resolved review findings, each with passing regressions:

- Failed-on-loss shader sources are not recompiled during recovery; invalid lost-interval source plus deletion
  cannot terminate restoration of an unrelated UBO/pipeline. Both loss callbacks complete exactly once.
- Output reflection queries linked locations for names and array elements, rejecting a two-output array or
  adjacent outputs against one target. Nonliteral location expressions rejected by Chromium have an explicit
  failed compilation/log assertion instead of being ignored by decimal-text parsing.
- Fractional viewports are emulated with a vertex transform and original homogeneous-coordinate interpolation /
  fragment rejection, preserving original clip planes. The asymmetric fractional triangle and reviewer's exact
  outside-centre point footprint are checked. No native f32-to-integer viewport truncation.
- Strengthened MRT to asymmetric top red/bottom green before sampling alongside blue, and made CONSTANT blending
  affect asserted RGBA values. W2 GPU draw/pass counts now contribute to existing renderer diagnostics.

This does not constitute Safari/Firefox/mobile or physical hardware verification. The executing browser here is
desktop Chromium; no iPhone/performance/playability claim. No remaining known W2 blocker. W1 integration must
preserve the marked shared runtime glue; WGSL translation remains deliberately WebGPU-only.
