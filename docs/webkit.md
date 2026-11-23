# Desktop WebKit runs (informational)

```sh
npm run test:e2e:webkit
```

builds the examples and runs the browser suite in Playwright's **desktop WebKit** (webkit-2370 for Playwright 1.64):
the `webkit-webgl2` project (the whole suite, `devices['Desktop Safari']`: 1280x720 at devicePixelRatio 2) and the
`webkit-webgpu` project (only `gl-page-fps.spec.ts`, K67). Results go to `reports/e2e-webkit-*`. It is the same as
`BGT_ALL_BROWSERS=1 playwright test --project=webkit-webgl2 --project=webkit-webgpu --workers=1`.

**Informational, not a gate and not iPhone verification.** Desktop WebKit on macOS is the closest automated indicator for
the spec's primary device family (iPhone Safari), but it is a different GPU process, memory budget, display pipeline and
input stack. A green WebKit run does not verify an iPhone; physical-device results are reported separately (README,
docs/verification.md). The release gate stays the Chromium matrix.

## How the projects map backends

- Cross-backend comparisons (`@webgpu` specs that call `otherBackend`) run from `webkit-webgl2` and compare **WebKit's
  own WebGL 2 with WebKit's own WebGPU**, launched with the project's viewport and devicePixelRatio (K69). Before K69 the
  second image came from a DPR-1 960x540 Chromium launch, so every such spec failed with "image dimensions differ".
- Specs that compute sizes from canvas pixels must use the page's `devicePixelRatio` (Desktop Safari emulates 2).

## WebKit behaviours the kit relies on or works around

### WebGL contexts are freed only by garbage collection (kit fix K69)

WebKit allows 16 active WebGL contexts per page. `WEBGL_lose_context.loseContext()` does **not** release a context's
place in that budget; only garbage collection or WebKit's own recycling does. From the 17th context on, WebKit prints
"There are too many active WebGL contexts on this page, the oldest context will be lost." and force-loses the least
recently used context (printing "loseContext: context already lost" when that one was already lost). The recycled one
can be a live, idle context:

```js
// Playwright WebKit, about:blank. Result: main is lost after the 16th temporary ("...0000011111").
const main = document.createElement('canvas').getContext('webgl2'); main.clear(main.COLOR_BUFFER_BIT);
const keep = [];
for (let i = 0; i < 20; i++) {
  const gl = document.createElement('canvas').getContext('webgl2');
  gl.getExtension('WEBGL_lose_context').loseContext(); keep.push(gl); // still referenced, as a renderer would be
  await new Promise(r => setTimeout(r, 5));
  console.log(i, main.isContextLost());
}
```

Without `keep` (and without a `preventDefault()`ed `webglcontextlost` handler, which also keeps it) the temporaries are
collected and nothing is lost; Chromium frees the context on `loseContext()`. The savestate capability created one
WebGL2 renderer per snapshot, compaction and restore, so `savestate-compaction` hit the budget (10 failures). K69:
`WebGL2Renderer.destroy()` parks its context restorable and `WebGL2Renderer.reuse(canvas)` restores that same context
for the next renderer (`restoreContext()` must be called after the loss event's dispatch task, or WebKit and Chromium
report "context restoration not allowed"); savestates recycle one scratch canvas through every temporary and replaced
renderer. Regression: `savestates.spec.ts` "idle snapshots keep the live game context" (20 snapshots of a paused game).

### WebGL errors are console errors

WebKit reports WebGL errors (`WebGL: INVALID_ENUM: ...`) as console **errors**; Chromium reports them as warnings. Specs
that inject native GL errors on purpose must allow exactly those messages (`gpu-feedback.spec.ts`, bounded counts).

### Scaled NEAREST ties are implementation-defined (not WebKit-specific)

The WebGL 2 renderer's §13 screen passes run at the logical size; a screen pass with LOAD copies the presented
device-resolution image down to it and back up with `blitFramebuffer(..., NEAREST)`. Where a device pixel centre lies
exactly on a logical pixel boundary (`(d - lb.x + 0.5) = k * lb.w / logicalW`), neither polygon coverage of that centre nor
the blit's source pixel is fixed by GL ES 3.0, and implementations differ:

```js
// 160 -> 1800 columns (scale 11.25), source column c has red = c. GL arithmetic: dst d -> src floor((d + 0.5) / 11.25).
gl.blitFramebuffer(0, 0, 160, 1, 0, 0, 1800, 1, gl.COLOR_BUFFER_BIT, gl.NEAREST);
// Apple GPU (WebKit): 7 of 160 ties take the lower column (e.g. d=1012 -> 89, not 90).
// SwiftShader (Chromium): 32 ties take the lower column (e.g. d=22 -> 1), but not d=1012.
```

With Desktop Safari's letterbox (scale 11.25) a legacy-drawn square's edge sits on such tie lines, so a LOAD round trip
moved those edge pixels by one device pixel (673 of 3.7M pixels). `gpu-presentation.spec.ts` therefore compares the
LOAD result device-exactly everywhere except on exact tie lines, where a pixel may only take the old colour of its direct
neighbour across the boundary (`screenRetention` in tests/support/gpu-image.ts; unit-tested). A lost overlay or any
off-tie change still fails.

### glGenerateMipmap's filter is implementation-defined

GL ES 3.0 only recommends a box filter. ANGLE on Metal (WebKit's WebGL 2) generates 3D mip levels with slice weights of
about 7/8 : 1/8 (`x64-gl-fbo` level 2 = 53,110,110), while the kit's WebGPU backend and SwiftShader box-filter
(124,139,139); the fixture's own check accepts any single blend weight (see the comment in examples/x64-gl-fbo/gl.c).
In the WebKit cross-backend comparison, `x64-gl-fbo.spec.ts` leaves out only the quad that samples that level, and only
when the two backends' guest-read level 2 differ; each backend still checks that quad against its own level 2.
