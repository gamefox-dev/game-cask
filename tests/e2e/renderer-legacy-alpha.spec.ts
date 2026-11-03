// SPDX-License-Identifier: CC0-1.0
import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';

// Known-answer alpha on all legacy destinations. Removing either screen pipeline
// write mask must fail, while offscreen alpha must remain fractional.
test('legacy draws preserve opaque physical and logical screens, not offscreen alpha', async ({ page, backendParam, collector }, info) => {
  void collector; expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, info);
  const result = await page.evaluate(async ({ root, kind }) => {
    const { Frame } = await import(root + '/runtime/commands.ts');
    const { WebGPURenderer } = await import(root + '/renderers/webgpu/webgpu.ts');
    const { WebGL2Renderer } = await import(root + '/renderers/webgl2/webgl2.ts');
    const { GPU_OP } = await import(root + '/runtime/abi.ts');
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const renderer = kind === 'webgpu' ? await WebGPURenderer.create(canvas, { debug: true }) : WebGL2Renderer.create(canvas, { debug: true });
    if (!renderer) throw Error(kind + ' unavailable');
    renderer.resize(16, 8); let offscreen: number[] = [], logicalNative: number[] = [];
    const draw = (frame: any, target: number) => {
      const first = frame.vertexCount;
      for (const [x, y] of [[0,0],[16,0],[16,8],[0,0],[16,8],[0,8]]) frame.vertex(x, y, 0, 0, 0x80000040);
      frame.items.push({ kind: 'draw', target, first, count: 6, texture: 0, filter: 0, blend: 0, clip: { x: 0, y: 0, w: 16, h: 8 } });
    };
    const frame = new Frame(); frame.reset(16, 8);
    frame.items.push({ kind: 'texCreate', handle: 1, width: 16, height: 8, renderTarget: true });
    draw(frame, 1);
    frame.items.push({ kind: 'readback', target: 1, x: 0, y: 0, w: 1, h: 1, complete: (data: Uint8Array) => offscreen = [...data] });
    draw(frame, 0);
    const lb = { x: 0, y: 0, w: 16, h: 8, scale: 1 };
    const physical = await renderer.drawFrame(frame, lb, true); await renderer.finish();
    // A GPU screen pass promotes WebGPU from the physical legacy path to the
    // retained logical surface. Draw legacy vertices there on the next frame.
    const f = new Frame(); f.reset(16, 8);
    f.items.push({ kind: 'gpu', op: GPU_OP.PASS_BEGIN, words: [1,0,0,0,0,0,0,0,0,0,0,0,0,0] },
      { kind: 'gpu', op: GPU_OP.PASS_END, words: [] });
    await renderer.drawFrame(f, lb, false); f.reset(16, 8); draw(f, 0);
    // Ordered target-0 readback runs before presentation: WebGPU copies the retained
    // logical texture, and WebGL reads its native default framebuffer. Presented
    // output alone cannot catch a missing logical-screen mask (presentation forces alpha1).
    f.items.push({ kind: 'readback', target: 0, x: 0, y: 0, w: 1, h: 1, complete: (data: Uint8Array) => logicalNative = [...data] });
    const logical = await renderer.drawFrame(f, lb, true); await renderer.finish(); renderer.destroy();
    return { offscreen, logicalNative, physical: [...physical!.data.subarray(0,4)], logical: [...logical!.data.subarray(0,4)] };
  }, { root: '/@fs' + resolve('bgt'), kind: backendParam });
  expect(result.offscreen).toEqual([64, 0, 0, 128]);
  expect(result.physical).toEqual([64, 0, 0, 255]);
  expect(result.logicalNative).toEqual([64, 0, 0, 255]);
  expect(result.logical).toEqual([64, 0, 0, 255]);
});
