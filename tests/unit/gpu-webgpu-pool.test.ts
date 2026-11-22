// @bgt-examples: none
// SPDX-License-Identifier: CC0-1.0. vK67: the WebGPU executor's buffer recycle pool (rename targets, transform-feedback
// capture temporaries). Breakage caught: exact-size keys (varying capture sizes never reuse and fill the cap), a full
// pool refusing new entries forever instead of evicting the oldest, entries that are never released, and pool bytes
// that are not reported.
import { describe, expect, it, vi } from 'vitest';
import { WebGPUCommands, sizeClass } from '../../bgt/renderers/webgpu/gpu';

interface FakeBuffer { size: number; usage: number; destroyed: boolean; destroy(): void }
function executor() {
  const created: FakeBuffer[] = [];
  const device = {
    limits: {}, queue: { submit: vi.fn(), writeBuffer: vi.fn() },
    createBuffer: ({ size, usage }: { size: number; usage: number }) => {
      const b: FakeBuffer = { size, usage, destroyed: false, destroy() { this.destroyed = true; } }; created.push(b); return b;
    },
    createCommandEncoder: vi.fn(),
  };
  const gpu = new WebGPUCommands(device as unknown as GPUDevice, () => {});
  const p = gpu as unknown as { pooled(size: number, usage: number): FakeBuffer; recycle(b: FakeBuffer): void; flush(): void };
  return { gpu, p, created };
}

describe('vK67 WebGPU buffer recycle pool', () => {
  it('size classes are idempotent 256-byte multiples with at most 25 % slack', () => {
    for (let n = 1; n < 1 << 20; n = Math.ceil(n * 1.37) + 3) {
      const c = sizeClass(n);
      expect(c).toBeGreaterThanOrEqual(n); expect(c % 256).toBe(0); expect(sizeClass(c)).toBe(c);
      if (n > 1024) expect(c / n).toBeLessThanOrEqual(1.25);
    }
  });

  it('reuses one class for varying sizes, drops exact-size stores, evicts oldest-first and by age, reports bytes', () => {
    const { gpu, p, created } = executor();
    const a = p.pooled(5000, 8); expect(a.size).toBe(5120);
    p.recycle(a); expect(gpu.pooledBytes).toBe(5120);
    expect(p.pooled(4500, 8)).toBe(a); expect(gpu.pooledBytes).toBe(0); // a different size of the same class reuses it
    const exact = { size: 5000, usage: 8, destroyed: false, destroy() { this.destroyed = true; } };
    p.recycle(exact); expect(exact.destroyed).toBe(true); expect(gpu.pooledBytes).toBe(0); // a guest store's exact size
    // Over the 32 MiB cap the oldest entries go, not the newest.
    const big = Array.from({ length: 5 }, () => p.pooled(8 << 20, 8));
    for (const b of big) { p.recycle(b); p.flush(); }
    expect(gpu.pooledBytes).toBe(32 << 20);
    expect(big[0].destroyed).toBe(true); expect(big.slice(1).every(b => !b.destroyed)).toBe(true);
    // Unused entries are released after the age limit (600 flushes, checked every 64).
    for (let i = 0; i < 700; i++) p.flush();
    expect(gpu.pooledBytes).toBe(0); expect(big.every(b => b.destroyed)).toBe(true);
    expect(created.length).toBe(6);
  });
});
