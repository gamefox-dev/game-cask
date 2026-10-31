import type { Page } from '@playwright/test';

/** Deterministic present-but-unusable adapter, independent of the host's GPU. */
export async function injectBrokenWebGPU(page: Page, mode: 'device' | 'submission' | 'lost'): Promise<void> {
  await page.addInitScript(mode => {
    const counts = { adapters: 0, devices: 0, submissions: 0 };
    (window as any).__BROKEN_GPU__ = counts;
    const error = () => new DOMException('A valid external Instance reference no longer exists. (injected)', 'OperationError');
    const device = {
      lost: mode === 'lost' ? Promise.resolve({ reason: 'destroyed', message: 'Device was destroyed. (injected)' }) : new Promise(() => {}),
      destroy() {},
      createBuffer: () => ({ destroy() {}, mapAsync: () => new Promise(() => {}) }),
      createCommandEncoder: () => ({ copyBufferToBuffer() {}, finish() { return {}; } }),
      queue: { writeBuffer() {}, submit() { counts.submissions++; if (mode !== 'lost') throw error(); } },
    };
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: {
      async requestAdapter() {
        counts.adapters++;
        return { async requestDevice() {
          counts.devices++;
          if (mode === 'device') throw error();
          return device;
        } };
      },
    } });
    // Also exercise submission failures on Chromium builds that don't expose WebGPU constants.
    if (!('GPUBufferUsage' in window)) Object.defineProperty(window, 'GPUBufferUsage', { value: { COPY_SRC: 4, COPY_DST: 8, MAP_READ: 1 } });
    if (!('GPUMapMode' in window)) Object.defineProperty(window, 'GPUMapMode', { value: { READ: 1 } });
  }, mode);
}
