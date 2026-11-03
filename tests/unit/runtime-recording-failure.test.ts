// SPDX-License-Identifier: CC0-1.0
import { test, expect } from 'vitest';
import { BGTRuntime } from '../../bgt/runtime/runtime';
import { Frame } from '../../bgt/runtime/commands';

test('a rejected recording sink releases deferred resize and completes readbacks', async () => {
  const frame = new Frame(); frame.reset(8, 4);
  let completed = 0, resized = 0, drawn = 0;
  frame.items.push({ kind: 'readback', target: 0, x: 0, y: 0, w: 1, h: 1, complete: () => { completed++; } });
  const rt: any = Object.create(BGTRuntime.prototype);
  Object.assign(rt, {
    failed: false, outsideSlice: null, frameTimes: [], errors: [], loadStarted: 0,
    firstFrameMs: null, gpuWallMs: 0, gpuSubmitTotalMs: 0,
    canvas: { width: 8, height: 4 }, letterbox: { x: 0, y: 0, w: 8, h: 4, scale: 1 },
    host: { frameIndex: 1, render: () => frame, consume: () => {} },
    renderer: { lost: false, stats: {}, drawFrame: () => { drawn++; return null; } },
    frameObserver: async () => {
      expect(rt.recordingFrame).toBe(true);
      // Real applySize must defer without accessing DOM while the sink is pending.
      BGTRuntime.prototype['applySize'].call(rt);
      expect(rt.recordingResizePending).toBe(true);
      throw new Error('sink failed');
    },
    applySize: () => { resized++; },
  });
  await rt.renderNow(false);
  expect(drawn).toBe(0); expect(completed).toBe(1); expect(resized).toBe(1);
  expect(rt.recordingFrame).toBe(false); expect(rt.recordingResizePending).toBe(false);
  expect(rt.errors.map((e: any) => e.message)).toEqual(['sink failed']);
});
