import {
  test, expect, openGame, step, debugState, diagnostics, readPixels, stateHash,
} from './fixtures';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ collector }) => { void collector; });

interface State {
  phase: number; frame: number; pixel: number; read: number; error: number; compiled: number; events: number;
  caps: number; languages: number;
}
async function boot(page: Page, scene: number, backend = 'webgl2'): Promise<State> {
  expect(await openGame(page, backend, { game: 'gpu-scenes', arg0: String(scene), debug: '1' })).toBe('ready');
  for (let i = 0; i < 8; i++) {
    await step(page, 1);
    if ((await debugState<State>(page))?.read) break;
  }
  const s = await debugState<State>(page);
  expect(s.phase, 'CAP_GPU and compiled resources must be usable').toBe(1);
  expect(s.caps & (1 << 12)).toBe(1 << 12); expect(s.languages).toBe(backend === 'webgpu' ? 7 : 6);
  expect(s.compiled).toBe(12); expect(s.error, JSON.stringify(await diagnostics(page))).toBe(0); expect(s.read).toBe(1);
  expect(await stateHash(page)).toBe('000c0101');
  const d = await diagnostics(page);
  expect(d.backend).toBe(backend); expect(d.commandErrors.count).toBe(0); expect(d.errors).toEqual([]);
  return s;
}
async function sample(page: Page, x: number, y: number): Promise<number[]> {
  const [p, d] = await Promise.all([readPixels(page), diagnostics(page)]), b = d.letterbox;
  const dx = Math.floor(b.x+(x+.5)*b.w/160), dy = Math.floor(b.y+(y+.5)*b.h/128);
  return [...p.data.subarray((dy*p.width+dx)*4, (dy*p.width+dx)*4+4)];
}
function near(actual: number[], expected: number[], tolerance = 2): void {
  for (let c = 0; c < expected.length; c++) expect(Math.abs(actual[c]-expected[c])).toBeLessThanOrEqual(tolerance);
}
function requestPixel(s: State): number[] { return [s.pixel&255, (s.pixel>>>8)&255, (s.pixel>>>16)&255, s.pixel>>>24]; }

// Catches indexed/base-vertex rebasing, varying interpolation and top-left orientation regressions.
test('GPU shared: indexed RGB triangle, GLSL330 and ordered ABI readback', async ({ page, backendParam }) => {

  const s = await boot(page, 0, backendParam);
  near(await sample(page, 80, 64), [63, 65, 127, 255], 4);
  near(requestPixel(s), [63, 65, 127, 255], 4);
  near(await sample(page, 80, 22), [12, 14, 229, 255], 5);
  near(await sample(page, 5, 5), [0, 0, 0, 255]);
});

// Catches ignored mip selection and incorrect separate-alpha blending.
test('GPU shared: alpha textured quad uses uploaded mip one', async ({ page, backendParam }) => {

  const s = await boot(page, 1, backendParam);
  near(await sample(page, 80, 64), [128, 0, 128, 255]);
  near(requestPixel(s), [128, 0, 128, 255]);
});

// Catches dropping a second color output, feedback mistakes and render-target sampling orientation.
test('GPU shared: two rendered color attachments are sampled together', async ({ page, backendParam }) => {

  const s = await boot(page, 2, backendParam);
  near(await sample(page, 80, 20), [128, 0, 128, 255]);
  near(await sample(page, 80, 100), [0, 128, 128, 255]);
  near(await sample(page, 80, 64), [0, 128, 128, 255]);
  near(requestPixel(s), [0, 128, 128, 255]);
});

// Catches ignored stencil reference/mask, depth comparison/write, and scissor conversion.
test('GPU shared: near red wins depth only inside stencil mask', async ({ page, backendParam }) => {

  const s = await boot(page, 3, backendParam);
  near(await sample(page, 40, 64), [255, 0, 0, 255]);
  near(await sample(page, 120, 64), [0, 0, 0, 255]);
  near(requestPixel(s), [0, 0, 0, 255]);
});

// Catches non-instanced fallback draws, broken instance attributes and instance-index builtin semantics.
test('GPU shared: 1,000 instance-buffer sprites including final instance', async ({ page, backendParam }) => {

  const s = await boot(page, 4, backendParam);
  near(await sample(page, 2, 2), [0, 255, 255, 255]);
  near(await sample(page, 158, 125), [255, 0, 255, 255]);
  near(requestPixel(s), await sample(page, 80, 64));
});

// Catches missing ordered buffer updates, uniformBlockBinding and stale uniform ranges.
test('GPU shared: std140 uniform buffer animation changes pixels', async ({ page, backendParam }) => {

  const s = await boot(page, 5, backendParam), before = await sample(page, 80, 64);
  near(requestPixel(s), [Math.round(255/59), Math.round(255*58/59), 0, 255], 5);
  await step(page, 20);
  const after = await sample(page, 80, 64);
  expect(after[0]-before[0]).toBeGreaterThan(70); expect(before[1]-after[1]).toBeGreaterThan(70);
});

// Catches ES version handling and native bottom-left fragment coordinate leakage.
test('GPU shared: GLSLES300 portable fragment positions are top-left', async ({ page, backendParam }) => {

  const s = await boot(page, 6, backendParam);
  near(await sample(page, 80, 20), [255, 255, 0, 255]);
  near(await sample(page, 80, 100), [0, 255, 255, 255]);
  near(requestPixel(s), [0, 255, 255, 255]);
});

// Catches GPU/2D reordering, state leakage and screen LOAD erasing earlier 2D output.
test('GPU shared: legacy 2D, GPU load/viewport, then legacy 2D share one screen', async ({ page, backendParam }) => {

  const s = await boot(page, 7, backendParam);
  near(await sample(page, 10, 10), [30, 40, 50, 255]);
  near(await sample(page, 50, 40), [0, 255, 0, 255]);
  near(await sample(page, 80, 60), [255, 0, 0, 255]);
  near(requestPixel(s), [255, 0, 0, 255]);
});

// Catches fixture regressions accidentally leaving one of the 25 execution paths unexercised.
test('GPU WebGL2: native C submits and executes every section 13 opcode', async ({ page, backendParam }) => {
  test.skip(backendParam !== 'webgl2', 'WebGL2-specific backend contract');
  const seen = new Set<string>();
  for (const scene of [0, 1, 3, 5, 7]) {
    await boot(page, scene);
    const d = await diagnostics(page);
    for (const [op, count] of Object.entries(d.coverage.ops)) if (count > 0) seen.add(op);
  }
  for (let op = 0x40; op <= 0x58; op++) expect(seen.has(String(op)), `opcode 0x${op.toString(16)}`).toBe(true);
});

// Catches resource-handle invalidation across actual browser context loss (not just a manual redraw).
for (const scene of [0, 1, 2, 3, 4, 6, 7, 8, 9]) {
  test(`GPU WebGL2: scene ${scene} resources survive browser context loss`, async ({ page, backendParam }) => {
    test.skip(backendParam !== 'webgl2', 'WebGL2-specific backend contract');
    await boot(page, scene);
    const positions = [[80, 64], [40, 64], [158, 125], [80, 22], [5, 5]];
    const before = await Promise.all(positions.map(([x, y]) => sample(page, x, y)));
    await page.evaluate(() => (window as any).__BGT_TEST__.simulateDeviceLoss());
    await step(page, 2);
    for (let i = 0; i < positions.length; i++) {
      near(await sample(page, ...positions[i] as [number, number]), before[i]);
    }
    const d = await diagnostics(page);
    expect(d.deviceResets).toBeGreaterThan(0);
    expect((await debugState<State>(page)).events & 18).toBe(18); // reset + attachment contents lost
    expect(d.errors.filter(e => e.kind !== 'device-lost')).toEqual([]);
    expect(d.commandErrors.count).toBe(0);
  });
}
