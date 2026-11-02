# K9b / K9c handoff — Q35 framebuffer blits and Q34 transform feedback

## Current delivery

K9c continues K9b on `lane/K9b`. Q34 is implemented end to end on both backends in **`3fea2b8`**, with independent-review repairs in **`a256b2a`**. Q35's bounded single-sample implementation remains **`3776c8e`**, documented by the historical checkpoint **`f3a465c`**. **Tier 1 is green on the final executable tree `a256b2a`**. The final handoff commit changes documentation only; exact results are below.

No captured shader/source, target artifacts or game files were added. New fixtures are original CC0-1.0. No original executable was run, no push/web/install was performed, and no target first-draw/title/playability claim is made. This is bounded GL 3.3 / GLSL330 + ES300 contract work, not unrestricted GL conformance.

## Q34 implementation

- Additive ABI **§13.11**: `FEEDBACK_VARYINGS` 0x61 (20 B), `FEEDBACK_CAPTURE` 0x62 (52 B), `BUFFER_READBACK` 0x63 (16 B), plus buffer usage FEEDBACK=8. Each operation has its own normative subsection, C layout/encoder, TS mirror/decoder and both native implementations. Old layouts/opcodes/limits/IO remain unchanged.
- Pending vs linked varying declarations; INTERLEAVED/SEPARATE order; reflection and component limits; transactional relink; failed current-program relink retains installed executable, uniforms and saved uniform locations. Builtin position/point-size capture uses collision-free output symbols before depth/viewport/backend conversion. Delete-current-program lifetime is deferred until unbound.
- Buffer base/range bindings and indexed queries, checked cursors/ranges, Begin/End primitive-class rules, GL errors/atomicity, RASTERIZER_DISCARD, exact primitives-written queries. Result counts derive from validated complete primitives (no geometry stage/conditional rendering/overflow); not fake native timing or occlusion results. Pause/resume and feedback objects are not exposed in this GL 3.3 profile.
- WebGL 2: native transform feedback. Indexed/strip fetches preserve original IDs and primitive order through dense assembly; native stale-binding cleanup; transactional interface replacement; guaranteed begin/setup/draw cleanup. Separate raw varyings preserve noperspective capture while value-times-w proxies retain raster interpolation.
- WebGPU: new separate **`bgt/renderers/webgpu/feedback.ts`** invokes canonical translated vertex function from compute, reads aligned copies of **native** input buffers, writes exact tight component words, and copies results to native destinations before later passes. No CPU vertex execution, stale upload-shadow output or game-specific behavior. Flattened 2D dispatch handles expanded strips above 65,535 workgroups; bounded pipeline cache. Translator change is only exporting its existing identifier mangler.
- Ordered native buffer readback feeds glGetBufferSubData, deferred through the shared request system. Aligned partial updates preserve GPU-written neighbors. Subsequent draws and ping-pong capture consume GPU data directly, without CPU reupload.

### Explicit limits / truthful failures

- Existing frontend array/matrix/interface-block varying restrictions remain compile/link errors; scalar/vector f32/i32/u32 are supported. Native WGSL feedback is E_UNSUPPORTED. Vertex-only feedback is supported with discard; nondiscarded vertex-only draws fail explicitly.
- Generated index validation and byte-unaligned partial updates/repacking of generated inputs require an authoritative CPU shadow and are explicitly E_UNSUPPORTED / GL_INVALID_OPERATION. Full reupload restores upload authority. Native storage/allocation limits produce an error/diagnostic, never successful empty capture.
- **Recovery fails closed** if a live buffer still contains uncached GPU-generated data. Neither backend silently restores zero/stale captured bytes. Full reupload or deletion before loss permits ordinary resource restoration. Direct native tests assert rejection and subsequent full-upload restoration; this is not claimed as physical device-loss/hardware validation.
- No multisample storage/resolve (existing MAX_SAMPLES=0), array/matrix output expansion, native-WGSL compute interface, new GL version or unrestricted GLSL compatibility claim. Q33/Q36/Q37 translator work remains lane K9a's ownership.

## Fixture / regression strength

`examples/x64-gl-feedback` is a normal Win64 **-O2 / CRT** PE pipeline fixture, no BGT imports or overrides. **100 guest checks per actual backend** assert:

- Interleaved and separate exact captured bytes; tight float/vec2, full-width signed/unsigned values; original gl_Position and gl_PointSize; collision with user `bgt_tf_position`; varying reflection and pending/relinked interface.
- Ordinary uniforms, UBO and texture input; instanced/divisor attributes and original vertex/instance IDs; indexed order; complete line/triangle lists and strip winding/order; incomplete tails and zero-output after an exactly full range.
- Range prefix/suffix sentinels; repeated draws/cursor advancement; discard and capture-with-rasterization; exact primitives-written query/availability; alias/range/begin/end/relink/type errors; no-error atomicity.
- Failed relink retains current executable and accepts saved-location uniform mutation; ES300 vertex-only capture; normalized byte offsets 1/2/3; former native UBO becomes feedback destination; GPU ping-pong; aligned partial update preserves captured neighbors.
- Non-unit-w noperspective raw capture and simultaneous actual rasterization; discard without feedback still validates illegal element types; final draw reads captured GPU buffer with **no CPU reupload**. Finish image: centered red rectangle on black, exact cross-backend equality. Viewed browser screenshot confirms the expected rectangle/black margins; no game visual claim.

`tests/e2e/gpu-feedback.spec.ts` additionally uses both actual native backends for a five-byte input range, odd-byte readback, wrong-type and missing-name candidate rejection followed by valid original capture, injected begin failure/cleanup, generated-buffer restore rejection then full-reupload restoration, and **1,400,000 strip inputs → 4,199,994 captured outputs**, checking the final odd triangle across the 1D dispatch boundary.

The headless recorder never executes shaders or rasterizes: `tests/unit/x64-gl-feedback.test.ts` expects exactly **28 GPU-dependent failures**, and no semantic/error/query failure, while checking transport declarations/ranges/order. Differential recording oracles are not substituted for native pixels. C/TS ABI layout/encoder tests cover every new struct/member/enum/helper; validator tests cover ownership, aliasing/rebinding, interface replacement atomicity, ranges, deferred requests and unsupported paths.

## Executed GL gap census (target measurements, not copied artifacts)

Read supplied Resume 5 iteration requests/localization, both capture/sample files and independent shader audit/control findings. Early 900-update captures have **zero executed-stub intersection** despite 379 optional lookup misses; optional lookups are not an implementation queue. Later measurements:

| API | WebGL2 evidence | WebGPU evidence | outcome |
|---|---|---|---|
| glTransformFeedbackVaryings | executed stub | absent from later observed intersection | **Q34 implemented**, pending/linked declarations and reflection |
| glBeginTransformFeedback | executed stub | executed stub | **Q34 implemented**, primitive/state/binding checks |
| glEndTransformFeedback | executed stub | executed stub | **Q34 implemented**, lifecycle/cursors |
| glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,…) | executed API rejected target | same profile path | **Q34 implemented**, plus BindBufferRange/indexed state |
| glBlitFramebuffer | executed stub | executed stub | **Q35 implemented** within single-sample contract |

No other GLSTUB intersects the supplied later samples. Updated registry: **219 implemented / 141 explicit unsupported / 360 total**. This census does not assert that unobserved target paths will not expose further gaps or that the target now reaches first draw/title.

## Independent review and repaired failures

Three actual fresh sessions were launched with workspace `run-pi.sh`, PI_BRIDGE=0 and distinct reviewer lane IDs, read-only source-review scope. No source-review result is attributed as author-run Tier 1 or native-test evidence.

1. First review found eight edge cases: byte-aligned UNORM fetch/tail staging; generated-buffer recovery; stale native UBO/setup cleanup; destructive interface replacement; retained-executable uniforms; expanded dispatch bound; builtin symbol collisions; zero-output authority/cursors. All repaired and discriminating native/guest/unit regressions added.
2. Second review at `3fea2b8` confirmed those repairs and found noperspective raw capture, sticky native error after candidate link failure, and discard bypassing index validation. **`a256b2a`** repairs all three with native and guest regressions.
3. A third fresh session reviewed **`a256b2a`** and returned **PASS within bounded read-only source-review scope**, explicitly confirming R1–R3 and the earlier F1–F8 repairs. It ran no tests/builds/browser/oracle and did not certify Tier 1. Scratch result: `/tmp/k9c/review3-findings.md`; earlier review findings remain at `/tmp/k9c/review-findings.md` and `/tmp/k9c/final-review-findings.md`.

Earlier failures are retained honestly: a temporary direct-browser module import used a wrong Vite URL (404); corrected to repository /@fs modules. Exact normalized-value comparisons initially used .2/.4/.6/.8, exposing native conversion rounding, then used original representable 0/1 endpoint inputs without relaxing equality. Initial diagonal finish geometry exposed native edge rounding; fixture changed to an axis-aligned viewport rectangle while retaining full byte and interior/outside pixel assertions. Missing native-binding cleanup and strip TF modes drove actual implementation fixes, not allowlists/skips/tolerance changes. The first broad unit run had one ENOENT x64-crt oracle preflight failure because an overlapping example/e2e build republished its manifest. Final checks are run sequentially with respect to example publication; no assertion is weakened.

## Final verification

All executable code/tests were frozen at **`a256b2a`** before the passing final runs. Documentation-only changes followed. No assertions, tolerances, skips or hardware-availability policy were relaxed.

| Gate | Actual result |
|---|---|
| doctor | **ready**, Node/Zig/Chromium available, original/ empty |
| lint | **PASS**: ESLint, clang + real GCC host/frontend checks, **30 example check-builds** (scale retains its build/oracle gate) |
| typecheck | **PASS**, tsc --noEmit |
| npm test -- --maxWorkers=1 | **813 passed / 69 files / 0 failed / 0 skipped**, 768.88 seconds |
| BGT_REQUIRE_WEBGPU=1 npm run test:e2e | **226 passed / 51 existing intentional skips / 0 failed / 0 flaky**, 245.13 seconds after example builds |
| leakcheck | **PASS**, **553 committable files** including final docs |
| every pipeline oracle | **27/27 × 300 frames = 8,100 identical pairs**, exit 0, null errors, lifted interp_insns=0 and stubs=[] |
| fresh independent source review | **PASS at a256b2a**, bounded read-only scope; no author-test attribution |

Browser breakdown: WebGL2 **101 pass / 24 skip**, WebGPU **117 / 26**, auto **8 / 1**. Q34 adds **five native browser tests**, all passing, plus the guest fixture's 100 checks per backend and exact cross-image comparison. The final test command built all examples first. The final broad unit run, browser publication/build and explicit oracle loop were sequential, eliminating the earlier manifest-publication race. Lint --check uses temporary outputs and does not republish browser fixtures.

Explicit oracle inventory: win32-conformance, win32-hello, x64-audio, x64-audio-init, x64-basics, x64-contracts, x64-cpp, x64-cpprt, x64-crt, x64-gl, x64-gl-blit, x64-gl-current, x64-gl-fbo, **x64-gl-feedback**, x64-gl-integer, x64-glsl, x64-gui, x64-handles, x64-input, x64-memory, x64-scale, x64-smoke, x64-sysdlls, x64-threads, x64-tls, x86-handles, x86-threads. Native BGT examples retain native known-answer/browser checks, not fabricated interpreter self-oracles.

Author logs under `/tmp/k9c/`: `final-unit.log`, `last-e2e.log`, `last-lint.log`, `complete-{doctor,types,leak}.log`, `final-oracle-<id>.log`, `final-oracles.json` and `final-oracles.log`; focused final repairs at `repair-{unit,native}.log`. These are machine-local scratch, not durable guarantees. Ignored `reports/oracle-*.json` and `reports/e2e-results.json` hold structured local results. Final viewed finish image is in the e2e artifact directories. Earlier failing/provisional logs are not current PASS evidence. Disk remained approximately **14 GiB free**, no ENOSPC; temporary check-build directories are tool-cleaned, fixture build/oracle outputs remain available. No push, network/game access or system install.

## Historical Q35 checkpoint evidence

Q35 single-sample blits (`3776c8e`) had **792 unit tests / 67 files**, **221 browser passes / 51 existing intentional skips**, and **26 × 300 = 7,800 identical pipeline oracle pairs**, plus doctor, clang/GCC lint, typecheck and leakcheck green. The original CC0 `x64-gl-blit` retains **46 guest checks** per real backend and exact cross-backend pixels for scaled/flipped/scissored/masked/default/depth/stencil/same-image transfers. WebGL native scaled-stencil mis-mapping was isolated and repaired with real rendered stencil bit-plane tests; WebGPU copies compatible images or renders general transfers. No CPU upload shadow is treated as rendered stencil. This is historical evidence, not a replacement for K9c's final reruns.
