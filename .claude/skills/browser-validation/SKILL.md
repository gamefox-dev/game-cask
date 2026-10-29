---
name: browser-validation
description: Exercise a BGT game in a real browser (Playwright, WebGPU + WebGL 2) through the deterministic __BGT_TEST__ API, capture evidence (screenshots, pixels, state hashes, logs), and classify the result as booted / interactive / playable.
---

# Browser validation

## Run
- Kit suites: `npm run test:e2e` (projects `chromium-webgl2`, `chromium-webgpu`, `chromium-auto`).
- Port: write Playwright specs that use `tests/e2e/fixtures.ts`, load `/?game=<id>&backend=<b>&paused=1&ephemeral=1`,
  and run under both GPU projects. Results go to `reports/e2e-results.json` + `reports/e2e-html/`.
  Artifacts (screenshots/traces) go to `reports/e2e-artifacts/`, which is private.
- Manual look: `npm run dev`, open `http://localhost:5173/?game=<id>&debug=1` (diagnostics overlay).

## The test API (`window.__BGT_TEST__`)
`pause()`, `step(n)` (fixed timestep + render + GPU completion), `input([...])`, `readPixels()`,
`screenshot()`, `stateHash()`, `debugState()`, `diagnostics()`, `backend()`, `simulateDeviceLoss()`.

## Evidence ladder (use the strongest you can)
1. A deterministic state assertion (`debugState`/`stateHash`) after scripted input.
2. A pixel assertion: a color census or centroid moved, a region changed, cross-backend diff under a tolerance.
3. A screenshot attached to the test (for human/validator review).
4. Console/diagnostics are clean: `errors: []`, `commandErrors.count == 0`, `assets.missing == []`.
   The `collector` fixture fails the test on page errors, console errors or failed requests.

## Classification (be strict)
- **booted (L1)**: `ready()`, no errors, and the first screen is **authentic** (matches the original's look;
  cite what makes it authentic).
- **interactive (L2)**: a scripted input produces a reproducible visible change (state + pixels) consistent with
  the original's controls.
- **playable (L3)**: a complete representative loop (e.g. start → play → score/lose/win → continue) runs to completion
  in the browser via scripted input, on at least one backend, with no errors.
- Anything less is reported as the lower level. "Renders something" is not L1.

## GPU notes
- `chromium-webgl2` typically renders with SwiftShader (software). `chromium-webgpu` needs a real adapter
  (`BGT_REQUIRE_WEBGPU=1` makes absence a failure instead of a skip).
- Same-backend reruns should be pixel-identical. Cross-backend comparisons need a tolerance.
- iPhone Safari: only a physical device counts. Record device, iOS version and what was tried, or "not performed".
