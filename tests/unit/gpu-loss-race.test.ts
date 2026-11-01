import { expect, it, vi } from 'vitest';
import { BGTRuntime } from '../../bgt/runtime/runtime';
import { WebGPURenderer } from '../../bgt/renderers/webgpu/webgpu';

// Device loss dispatch is asynchronous. A render scheduled between destroy() and handleLost must not drain a
// create+delete queue and thereby manufacture a resource-free fallback decision.
it('simulated loss marks unavailable synchronously, preserves queued GPU work and refuses fallback before handleLost', async () => {
  const pending = [{ kind: 'gpu', op: 0x40 }, { kind: 'gpu', op: 0x42 }];
  const host = {
    frame: { items: pending }, get hasGpuWork() { return this.frame.items.length > 0; },
    render: vi.fn(() => ({ items: pending, vertexCount: 0, commandBytes: 0, submits: 0 })),
    consume: vi.fn(() => { pending.length = 0; }),
  };
  const renderer = Object.assign(Object.create(WebGPURenderer.prototype), {
    kind: 'webgpu', lost: false, gpu: { hasResources: false }, o: { device: { destroy: vi.fn() } },
    restoredCbs: [], unrecoverableCbs: [], drawFrame: vi.fn(async () => null), stats: {},
  });
  const runtime: any = Object.assign(Object.create(BGTRuntime.prototype), {
    host, renderer, failed: false, outsideSlice: false, guard: (f: () => unknown) => f(),
    record: vi.fn(), fail: vi.fn(function(this: any) { this.failed = true; }),
    newCanvas: vi.fn(() => { throw new Error('Fallback must refuse before creating a canvas'); }), frameTimes: [],
  });
  renderer.unrecoverableCbs.push((reason: string) => runtime.switchToWebGL2(reason));
  const loss = renderer.simulateLoss({ unrecoverable: true }); // destroy schedules, but does not dispatch handleLost yet
  await runtime.renderNow(false);
  const queuedBeforeDispatch = pending.length;
  renderer.unrecoverableCbs.forEach((cb: (reason: string) => void) => cb('injected deferred handleLost'));
  await loss;
  expect(renderer.lost).toBe(true);
  expect(queuedBeforeDispatch).toBe(2); expect(host.consume).not.toHaveBeenCalled(); expect(host.render).not.toHaveBeenCalled();
  expect(runtime.fail).toHaveBeenCalledWith('device-lost', expect.stringContaining('Cannot restore live GPU resources'));
  expect(runtime.newCanvas).not.toHaveBeenCalled();
});

it('loss occurring while an asynchronous render is in flight retains the unconsumed command frame', async () => {
  const frame = { items: [{ kind: 'gpu' }], vertexCount: 0, commandBytes: 0, submits: 0 };
  const renderer: any = { lost: false, drawFrame: vi.fn(async () => { renderer.lost = true; return null; }), stats: {} };
  const host = { render: vi.fn(() => frame), consume: vi.fn() };
  const runtime = Object.assign(Object.create(BGTRuntime.prototype), {
    host, renderer, failed: false, outsideSlice: false, guard: (f: () => unknown) => f(), frameTimes: [],
  });
  await runtime.renderNow(false);
  expect(host.render).toHaveBeenCalledOnce(); expect(renderer.drawFrame).toHaveBeenCalledOnce();
  expect(host.consume).not.toHaveBeenCalled(); expect(frame.items).toHaveLength(1);
});
