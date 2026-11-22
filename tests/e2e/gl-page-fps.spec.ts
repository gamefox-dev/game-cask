// SPDX-License-Identifier: CC0-1.0. Original fixture (examples/x64-gl-pacing), never game assets.
// K67 (Q116, Q115): a GPU-bound merged frame (stream renames, instanced draws reading generic current attributes, a
// long full-screen effect) runs its real page loop as fast as the per-pass native path (`?gpubatch=0`), with one ABI
// submit and one GPUQueue.submit per frame. Breakage caught: WebKit paces a WebGPU canvas from the GPU execution
// window of the command buffer that uses the canvas texture; when presentation shared the whole merged frame's
// command buffer, WebKit 27.2 stepped requestAnimationFrame down its divisor ladder (85 Hz display: 85 -> 17 Hz,
// game: 5 Hz) while `?gpubatch=0` kept the full rate. Also caught: instanced current-attribute draws uploading
// synchronously to private buffer 1023 (K60: 2 ABI submits per instanced draw, 9 per frame here), and any
// reordering (merged pixels must equal per-pass pixels). Runs on every project, including webkit-webgpu
// (BGT_ALL_BROWSERS=1); skipped on software rasterizers, where the effect pass alone takes seconds per frame.
import { test, expect, openGame, assertBackend, step, diagnostics, readPixels, hardwarePixels } from './fixtures';
import type { Page } from '@playwright/test';
import type { PageWindowSummary } from '../../bgt/runtime/page-fps';

const BATCHES_RENAMED = 16; // of 32 stream batches x 2 buffers (first uses of a frame write in place)
const counter = (d: Awaited<ReturnType<typeof diagnostics>>, key: string) => (d.metrics as Record<string, number>)[key];
const steady = async (page: Page) => {
  for (let i = 0; i < 200; i++) {
    await step(page, 1);
    if ((await diagnostics(page)).logs.some(l => l.message.includes('x64-gl-pacing PASS frame state'))) break;
  }
  for (let i = 0; i < 4; i++) await step(page, 1);
};

test('x64-gl-pacing: a GPU-bound merged frame keeps the per-pass page frame rate and one submit', async ({ page, backendParam }, info) => {
  test.setTimeout(180_000);
  const run = async (batch: string) => {
    expect(await openGame(page, backendParam, { game: 'x64-gl-pacing', gpubatch: batch })).toBe('ready');
    await assertBackend(page, backendParam, info);
    const d0 = await diagnostics(page);
    test.skip(!!d0.gpuDevice?.software, `software rasterizer (${d0.gpuDevice?.renderer}): the effect pass is GPU-bound by design`);
    await steady(page);
    const before = await diagnostics(page);
    await step(page, 1);
    const d = await diagnostics(page), pixels = await readPixels(page);
    // Back-to-back stepping first, as the game benchmark does: frames presented faster than the GPU retires them
    // make WebKit's pacer step down; it must be able to step back up in the page loop that follows.
    await page.evaluate(async () => { for (let i = 0; i < 150; i++) await (window as any).__BGT_TEST__.step(1); });
    // One window right after the burst (a pause of more than 350 ms between presents resets WebKit's pacer).
    const fps = await page.evaluate(() => (window as any).__BGT_TEST__.measurePage(4000, 1500)) as PageWindowSummary;
    return { before, d, pixels, fps };
  };
  const merged = await run('1'), split = await run('0');
  for (const { before, d } of [merged, split]) {
    expect(d.commandErrors.count).toBe(0); expect(d.errors).toEqual([]);
    expect(d.logs.filter(l => /FAIL|error/.test(l.message))).toEqual([]);
    expect(d.lastFrame.drawCalls).toBe(32 + 4 + 1 + 1);
    // Q115: the frame end is the only ABI submit; instanced constants ride in the batched uniform upload.
    expect(d.lastFrame.submits).toBe(1);
    expect(counter(d, 'gl_sync_submits') - counter(before, 'gl_sync_submits')).toBe(0);
  }
  // Q116: the real page loop of the merged path keeps (most of) the per-pass path's presents per second.
  const rate = (s: PageWindowSummary) => s.presents_per_second ?? 0;
  info.annotations.push({ type: 'page-fps', description: `merged ${rate(merged.fps).toFixed(1)} / per-pass ` +
    `${rate(split.fps).toFixed(1)} presents/s (rAF ${merged.fps.raf_per_second?.toFixed(1)} / ${split.fps.raf_per_second?.toFixed(1)})` });
  expect(merged.fps.presents, 'merged page loop presents').toBeGreaterThan(20);
  expect(rate(merged.fps) / rate(split.fps), `merged ${rate(merged.fps)} vs per-pass ${rate(split.fps)} presents/s`).toBeGreaterThan(0.8);
  const m = merged.d.lastFrame;
  if (backendParam === 'webgpu') {
    // One GPUQueue.submit: the merged frame plus a separate presentation command buffer.
    expect(m.nativeSubmits).toBe(1); expect(m.commandBuffers).toBe(2);
    expect(m.bufferRenames).toBeGreaterThanOrEqual(BATCHES_RENAMED); // re-specified stream buffers inside one merged frame
    expect(split.d.lastFrame.nativeSubmits).toBeGreaterThan(4);
  }
  if (hardwarePixels()) expect(Buffer.compare(merged.pixels.data, split.pixels.data)).toBe(0);
  // Not a cleared screen: stream quads, sprites and the effect reach the default framebuffer.
  const px = merged.pixels, colours = new Set<string>();
  for (let y = 0; y < px.height; y += 7) for (let x = 0; x < px.width; x += 7) {
    const at = (y * px.width + x) * 4; colours.add(`${px.data[at] >> 4},${px.data[at + 1] >> 4},${px.data[at + 2] >> 4}`);
  }
  expect(colours.size).toBeGreaterThan(12);
});
