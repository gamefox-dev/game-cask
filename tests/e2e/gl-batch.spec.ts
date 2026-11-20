// SPDX-License-Identifier: CC0-1.0. Original fixture (examples/x64-gl-batch), never game assets.
// K53 frame batching: one ABI submission per GL frame, merged same-attachment native passes and (WebGPU)
// one frame command encoder. Breakage caught: per-call submits, a pass split per draw, reordered or
// stale streamed uploads (pixels would differ from the unmerged native path), lost clears/loads.
import { test, expect, openGame, assertBackend, step, diagnostics, readPixels, hardwarePixels } from './fixtures';
import type { Page } from '@playwright/test';

const steady = async (page: Page) => {
  for (let i = 0; i < 200; i++) {
    await step(page, 1);
    if ((await diagnostics(page)).lastFrame.drawCalls === 41) break;
  }
  await step(page, 3);
  return diagnostics(page);
};
test('x64-gl-batch: whole-frame batching and pass merging keep exact pixels', async ({ page, backendParam }, info) => {
  const run = async (batch: string) => {
    expect(await openGame(page, backendParam, { game: 'x64-gl-batch', gpubatch: batch })).toBe('ready');
    await assertBackend(page, backendParam, info);
    const d = await steady(page);
    const pixels = await readPixels(page);
    return { d, pixels, after: await diagnostics(page) };
  };
  const merged = await run('1'), split = await run('0');
  for (const { d } of [merged, split]) {
    expect(d.commandErrors.count).toBe(0); expect(d.errors).toEqual([]);
    expect(d.logs.filter(l => /FAIL|error/.test(l.message))).toEqual([]);
    expect(d.lastFrame.drawCalls).toBe(41);
    // C profile: the frame's 43 wire passes, 82 uploads and 2 texture updates travel in one deferred list.
    expect(d.lastFrame.submits).toBe(1); expect(d.lastFrame.continuationSubmits).toBe(1);
  }
  const m = merged.d.lastFrame, s = split.d.lastFrame;
  // Four target spans (scene, glow, scene, screen): every other §13 pass continues the open native pass.
  if (backendParam === 'webgpu') {
    expect(m.mergedPasses).toBe(39); expect(s.mergedPasses).toBe(0);
    expect(m.nativePasses).toBeLessThan(s.nativePasses);
    // Renderer frame encoder + presentation + retained snapshot copy, versus one submit per §13 pass.
    expect(m.nativeSubmits).toBeLessThanOrEqual(4); expect(s.nativeSubmits).toBeGreaterThanOrEqual(43);
    expect(m.bufferRenames).toBeGreaterThan(0);
  } else {
    expect(m.mergedPasses).toBe(39); expect(s.mergedPasses).toBe(0);
    expect(m.nativePasses).toBe(4); expect(s.nativePasses).toBe(43);
  }
  // Same guest frame on the same backend: merged and per-pass native execution store identical pixels.
  expect(merged.pixels.width).toBe(split.pixels.width);
  if (hardwarePixels()) expect(Buffer.compare(merged.pixels.data, split.pixels.data)).toBe(0);
  // The composite is not a cleared screen: scene sprites and glow reach the default framebuffer.
  const b = merged.d.letterbox, px = merged.pixels;
  let lit = 0;
  for (let y = 0; y < 224; y += 8) for (let x = 0; x < 256; x += 8) {
    const at = (Math.floor(b.y + (y + 0.5) * b.h / 224) * px.width + Math.floor(b.x + (x + 0.5) * b.w / 256)) * 4;
    if (px.data[at] + px.data[at + 1] + px.data[at + 2] > 120) lit++;
  }
  expect(lit).toBeGreaterThan(20);
});
