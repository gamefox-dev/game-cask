// Deterministic device double for shared startup/preflight tests. Browser tests also
// inject a failing adapter on the actual page; healthy hardware runs the real probe.
import { vi } from 'vitest';
export function fakeWebGPU() {
  const buffers: Array<{ data: Uint32Array; destroy: ReturnType<typeof vi.fn>; mapAsync: ReturnType<typeof vi.fn> }> = [];
  let lose!: (info: GPUDeviceLostInfo) => void;
  const lost = new Promise<GPUDeviceLostInfo>(resolve => { lose = resolve; });
  const device = {
    lost,
    destroy: vi.fn(() => lose({ reason: 'destroyed', message: 'Device was destroyed.' } as GPUDeviceLostInfo)),
    createBuffer: vi.fn(() => {
      const b = { data: new Uint32Array(1), mapAsync: vi.fn(async () => {}),
        getMappedRange() { return this.data.buffer; }, unmap: vi.fn(), destroy: vi.fn() };
      buffers.push(b); return b;
    }),
    createCommandEncoder: vi.fn(() => {
      let copy = () => {};
      return { copyBufferToBuffer(src: typeof buffers[number], _a: number, dst: typeof buffers[number]) {
        copy = () => dst.data.set(src.data);
      }, finish: () => copy };
    }),
    queue: { writeBuffer: vi.fn((b, _offset, data) => b.data.set(data)),
      submit: vi.fn((commands: Array<() => void>) => commands.forEach(c => c())),
      onSubmittedWorkDone: vi.fn(async () => {}) },
  };
  const adapter = { requestDevice: vi.fn(async () => device) };
  const gpu = { requestAdapter: vi.fn(async () => adapter) };
  return { gpu, adapter, device, buffers, lose };
}
export function stubWebGPUConstants() {
  vi.stubGlobal('GPUBufferUsage', { COPY_SRC: 4, COPY_DST: 8, MAP_READ: 1 });
  vi.stubGlobal('GPUMapMode', { READ: 1 });
}
