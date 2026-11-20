// Opt-in GPU pass timing (K53). Requires the 'timestamp-query' device feature; otherwise unavailable.
// Every §13 native render pass gets a begin/end timestamp pair; at frame end the pairs are resolved
// in one extra command buffer (submitted through the uncounted queue entry) and read back
// asynchronously, so `lastMs` reports a frame completed a few frames earlier. Browsers may quantize
// timestamps (Chromium: 100 µs unless WebGPU developer features are enabled).
const PAIRS = 256;

export class WebGPUTiming {
  private readonly set: GPUQuerySet;
  private readonly resolve: GPUBuffer;
  private readonly free: GPUBuffer[] = [];
  private next = 0;
  /** Sum of native pass durations of the most recently read frame, in ms; null before the first result. */
  lastMs: number | null = null;
  /** Passes in that frame without a timestamp slot (more than 256 passes). */
  lastUntimed = 0;
  private untimed = 0;

  constructor(private readonly device: GPUDevice, private readonly submit: (buffers: GPUCommandBuffer[]) => void) {
    this.set = device.createQuerySet({ type: 'timestamp', count: PAIRS * 2 });
    this.resolve = device.createBuffer({ size: PAIRS * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    for (let i = 0; i < 3; i++) this.free.push(device.createBuffer({ size: PAIRS * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
  }

  static supported(device: GPUDevice): boolean { return device.features.has('timestamp-query'); }

  writes(): GPURenderPassTimestampWrites | undefined {
    if (this.next >= PAIRS) { this.untimed++; return undefined; }
    const i = this.next++;
    return { querySet: this.set, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };
  }

  /** Call after the frame's last pass submission. Skips the frame if all read buffers are in flight. */
  endFrame(): void {
    const pairs = this.next, untimed = this.untimed;
    this.next = 0; this.untimed = 0;
    const target = this.free.pop();
    if (!target) return;
    if (!pairs) { this.free.push(target); this.lastMs = 0; this.lastUntimed = untimed; return; }
    const encoder = this.device.createCommandEncoder();
    encoder.resolveQuerySet(this.set, 0, pairs * 2, this.resolve, 0);
    encoder.copyBufferToBuffer(this.resolve, 0, target, 0, pairs * 16);
    this.submit([encoder.finish()]);
    void target.mapAsync(GPUMapMode.READ, 0, pairs * 16).then(() => {
      const t = new BigUint64Array(target.getMappedRange(0, pairs * 16));
      let ns = 0n;
      for (let i = 0; i < pairs; i++) if (t[i * 2 + 1] > t[i * 2]) ns += t[i * 2 + 1] - t[i * 2];
      target.unmap(); this.free.push(target);
      this.lastMs = Number(ns) / 1e6; this.lastUntimed = untimed;
    }).catch(() => { /* device loss: drop the sample */ });
  }

  destroy(): void { this.set.destroy(); this.resolve.destroy(); for (const b of this.free) b.destroy(); }
}
