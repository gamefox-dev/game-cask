// SPDX-License-Identifier: CC0-1.0
import { test, expect } from 'vitest';
import { BGTRuntime } from '../../bgt/runtime/runtime';
import { Frame } from '../../bgt/runtime/commands';

// Isolate render dispatch from DOM/GPU work: disabled recording must not add a
// microtask or allocate a letterbox snapshot before the existing draw await.
test('disabled recorder dispatches synchronously with the original letterbox', async () => {
  const frame = new Frame(); frame.reset(8, 4);
  const letterbox = { x: 0, y: 0, w: 8, h: 4, scale: 1 };
  let dispatched = 0;
  const rt: any = Object.create(BGTRuntime.prototype);
  Object.assign(rt, {
    failed: false, outsideSlice: null, frameTimes: [], loadStarted: 0,
    firstFrameMs: null, gpuWallMs: 0, gpuSubmitTotalMs: 0, letterbox,
    host: { frameIndex: 1, render: () => frame, consume: () => {} },
    renderer: { lost: false, stats: {}, drawFrame: (f: Frame, lb: unknown) => {
      expect(f).toBe(frame); expect(lb).toBe(letterbox); dispatched++; return null;
    } },
  });
  // Reading dimensions/copying metadata is recorder-only work too.
  Object.defineProperty(rt, 'canvas', { get: () => { throw new Error('disabled recorder read dimensions'); } });
  const done = rt.renderNow(false);
  const immediate = dispatched;
  await done;
  expect(immediate).toBe(1);
});
