---
name: browser-validation
description: Exercise a BGT game in a real browser (Playwright, WebGPU + WebGL 2) through the deterministic __BGT_TEST__ API — specs, the resource tour, and probe scripts — capture evidence (screenshots, pixels, state hashes, peek, logs), review it with the visual checklist, write tests that can fail, and classify the result as booted / interactive / playable.
---

# Browser validation

## Run
- Kit suites: `npm run test:e2e` (projects `chromium-webgl2`, `chromium-webgpu`, `chromium-auto`). They never
  build or run `port/`.
- Port: Playwright specs in `port/tests/` that import from `../../tests/e2e/fixtures` and load
  `/?game=<id>&backend=<b>&paused=1&ephemeral=1`. Run them with `npm run test:port` (projects `port-webgl2`,
  `port-webgpu`, enabled by `BGT_PORT_TESTS=1`).
- Result files are `reports/<prefix>-results.json`, `<prefix>-artifacts/`, `<prefix>-html/`. `test:e2e` uses the prefix
  `e2e`, `test:port` uses `e2e-port`. A direct `npx playwright test` without `BGT_RESULTS_PREFIX` writes `e2e-adhoc-*`,
  so it never overwrites kit or port results. Prefer `npm run probe` for exploration.
- Manual look: `npm run dev`, open `http://localhost:5173/?game=<id>&debug=1` (diagnostics overlay). Leave a dev
  server you did not start alone; tests and probes start their own servers.

## Differential oracle (pipeline games)
`npm run oracle -- port [frames]` builds the game twice: lifted, and interpret-only. It drives both with the same
deterministic clicks and keys and compares the API-call trace hash every frame (report: `reports/oracle-<id>.json`).
- Identical traces mean lifted control flow matches the shared semantics.
- The first divergent frame localises a lifter bug: report the frame and the APIs around it.
- The oracle cannot detect errors in the shared semantics or the platform profile. Browser evidence covers those.

## Kit metrics (always report them)
`diagnostics().metrics` (pipeline games):
- execution: `interp_insns` (0 = fully lifted), `interp_code_entries` (entries into non-lifted code),
  `tail_calls_lifted` (lifted tail jumps resolved to lifted code; not interpretation), `continues_interpreted`
  (lifted frames that had to continue in the interpreter), `generic_insn_execs` (instructions executed through the
  shared semantic core inside lifted code)
- platform: `api_calls`, `apis_hit`, `stubs` (declared no-ops that were called; ordinals as `#N`)
- GDI: `gdi_ops` (program drawing only), `chrome_ops` (profile UI; may change on extra renders), `gdi_approx_rop`, `gdi_unsupported`, `gdi_pixel_reads`, `gdi_cpu_replays` (reads answered by CPU
  replay of the recorded ops), `gdi_getpixel_noread` (reads that were impossible: no history for that surface)
- frames: `yields`, `peek_yields`, `trace_hash`

The pipeline summary from the build adds generated vs hand-written LOC, data seeds and override count. Put these first.

## The test API (`window.__BGT_TEST__`)
`pause()`, `step(n)` (fixed timestep + render + GPU completion), `input([...])`, `readPixels()`,
`screenshot()`, `stateHash()`, `debugState()`, `diagnostics()`, `backend()`, `simulateDeviceLoss()`, and
`peek(addr, len)`: **read-only, test-only** copy (`Uint8Array`, ≤ 64 KiB) of the game's guest memory (pipeline games:
the emulated address space), or `null` if unmapped. From a spec use `peekBytes(page, addr, len)` (any length, returns a
Buffer). Tests may read state with it; nothing may write guest state. `debugState().modules` gives module bases.
For pipeline games `debugState().ui` exposes the profile's layout read-only: the menu bar and open popup (item text,
id, flags, rectangles), the message box, and every visible window/dialog/control (class, text, style, rectangles).

## Tests must be able to fail
Every port test:
1. states the breakage it would catch: `catches('drag does not move the card')` (from `tests/support/evidence.ts`,
   re-exported by the fixtures). It is recorded as a test annotation and the validator checks it.
2. asserts a **change**, not just "no errors": `expectChange(page, action, { hash: true, region })` fails unless the
   state hash differs after the action and/or the region changed. Prefer a specific region and value (a card moved
   to x, a score digit changed) over "something changed".
3. uses tolerances only as wide as cross-backend differences need (a few LSBs), never "anything passes".
A test whose assertions would still pass with the feature broken is a `test`-layer queue item.

## Resource tour (Win32 games)
`tests/support/tour.ts` opens every menu item of the game through **real input** (clicks on the profile-drawn menu
bar and items, rectangles from `debugState().ui`), screenshots each result, records errors/aborts/new stubs/new APIs
and metric deltas per item, dismisses message boxes and dialogs (Esc, then the Cancel/OK button), and reloads the game
between items. Items whose label looks like exit/quit/close are listed but skipped unless `includeExit: true`.
It never pokes game state. Output: `reports/tour/index.json` + PNGs (private).
```ts
// port/tests/tour.spec.ts
import { test, expect } from '../../tests/e2e/fixtures';
import { runTour } from '../../tests/support/tour';
test('resource tour', async ({ page, backendParam, collector }, testInfo) => {
  collector.allow(/guest:/);
  const index = await runTour(page, { game: '<id>', backend: backendParam, outDir: `reports/tour/${backendParam}` });
  expect(index.items.filter((i) => i.aborted)).toEqual([]); // every abort is a queue item
});
```
Or from a probe script: `await p.tour({ outDir: 'reports/tour' })`. Review every PNG with the checklist below.

## Probe mode (exploration without a spec)
`npm run probe -- --game <id> [--backend webgl2|webgpu] --script <file.mjs> [--out reports/probe] [--params seed=2]`
runs your script against the test API in headless Chromium on its own server, and writes artifacts to `reports/probe/`
(`probe.json` with the log, console and errors, plus PNGs). Build the game first (`npm run build:port`).
```js
// scratch/look.mjs
export default async function (p) {
  await p.start();                                  // load paused, wait for ready (p.start({ seed: '2' }) reloads)
  await p.step(30);
  await p.click(120, 40);                           // logical px; pointer down, step, up, step
  await p.key('Escape');
  await p.screenshot('after-click');                // reports/probe/after-click.png
  await p.crop('corner', { x: 100, y: 160, w: 12, h: 12 }, 16);   // zoomed nearest-neighbour crop
  p.log(await p.metrics(), await p.pixel(10, 10), await p.peek(0x01007170, 16));
  await p.tour({ outDir: 'reports/probe/tour' });
}
```
Also available: `p.page` (Playwright page), `p.input(events)`, `p.diagnostics()`, `p.debugState()`, `p.stateHash()`,
`p.readPixels()`.

## Visual review checklist
Look at every screenshot you cite (Read tool on the PNG), and at zoomed crops for details. Check:
1. **Text fits its box**: no label clipped or wrapped by a control, menu, caption or status bar; no literal `&`.
2. **Clipping and z-order**: child windows (status bars, toolbars, controls) are not overdrawn by the parent's
   drawing; popups, dialogs and message boxes are above the game; nothing draws outside its window.
3. **Control appearance matches its style bits**: compare each class, `style`, `exstyle`, `rect` and `client` in
   `debugState().ui.windows` (also in the tour index and `p.debugState()` in the probe); radio buttons vs check boxes, default push button, group boxes,
   separators in menus, disabled (grey) items, checked menu items.
4. **Animations frame by frame**: step 1 frame at a time through transitions (`p.step(1)` + `p.screenshot`) and look
   for stale pixels, black wedges, tearing, or uncleared areas.
5. **Colours and corners at zoom**: crop corners and edges at 8–16×; compare colours against the resources (palette
   entries, bitmap bytes) before calling anything authentic.
Write a one-line verdict per reviewed screenshot into the queue item or `reports/visual-review.md`
(`<file>: ok` or `<file>: <problem> → Qn`).

## Evidence ladder (use the strongest you can)
1. A deterministic state assertion (`peek`, `debugState`, `stateHash`) after scripted input.
2. A pixel assertion: a region changed, a color census or centroid moved, cross-backend diff under a tolerance.
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
- A level is a milestone, not the end: the port is done when the work queue is resolved (see `CLAUDE.md`).

## GPU notes
- `chromium-webgl2` typically renders with SwiftShader (software). `chromium-webgpu` needs a real adapter
  (`BGT_REQUIRE_WEBGPU=1` makes absence a failure instead of a skip).
- Same-backend reruns should be pixel-identical. Cross-backend comparisons need a tolerance.
- iPhone Safari: only a physical device counts. Record device, iOS version and what was tried, or "not performed".
