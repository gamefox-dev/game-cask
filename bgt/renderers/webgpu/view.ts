// K62: §13 viewports may extend past the attachment (GL accepts any viewport up to GL_MAX_VIEWPORT_DIMS and clips
// rasterization to the target). WebGPU requires the native viewport inside the attachment, so the executor clamps
// it and compensates in the vertex transform: the clip volume maps onto the clamped rectangle exactly where the
// unclamped viewport would have put it. Window coordinates (and so coverage, interpolation and the fragment
// position) are the GL viewport's; depth is untouched. A viewport that misses the attachment rasterizes nothing.

/** Native (clamped) viewport and the clip-space transform x' = x*sx + w*ox, y' = y*sy + w*oy (top-left, +y down). */
export interface ClampedViewport { native: [number, number, number, number]; transform: [number, number, number, number]; empty: boolean }
export const IDENTITY_VIEW: readonly number[] = [1, 1, 0, 0];

export function clampViewport(x: number, y: number, w: number, h: number, width: number, height: number): ClampedViewport {
  const x0 = Math.max(x, 0), x1 = Math.min(x + w, width), y0 = Math.max(y, 0), y1 = Math.min(y + h, height);
  if (!(x1 > x0) || !(y1 > y0)) return { native: [0, 0, width, height], transform: [1, 1, 0, 0], empty: true };
  if (x0 === x && y0 === y && x1 === x + w && y1 === y + h) return { native: [x, y, w, h], transform: [1, 1, 0, 0], empty: false };
  const cw = x1 - x0, ch = y1 - y0;
  // xw = x + (xd + 1) w/2 must equal x0 + (xd' + 1) cw/2; yw = y + (1 - yd) h/2 must equal y0 + (1 - yd') ch/2.
  return { native: [x0, y0, cw, ch], empty: false,
    transform: [w / cw, h / ch, (w + 2 * (x - x0)) / cw - 1, 1 - (h + 2 * (y - y0)) / ch] };
}

const SLOT = 256, SLOTS = 256;
/** Per-draw transforms in a uniform ring addressed by dynamic offset (group 2, binding 0, vertex stage). Offset 0
 * is the identity. A slot is written once (queue write before the encoder that reads it is submitted) and reused
 * for equal transforms; a full ring is retired (destroyed after the pending submit) and a new one started. */
export class ViewTransforms {
  readonly layout: GPUBindGroupLayout;
  group!: GPUBindGroup;
  private buffer!: GPUBuffer;
  private slots = new Map<string, number>();
  constructor(private device: GPUDevice, private retire: (b: GPUBuffer) => void) {
    this.layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX,
      buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }] });
    this.start();
  }
  private start(): void {
    this.buffer = this.device.createBuffer({ size: SLOT * SLOTS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.buffer, 0, new Float32Array(IDENTITY_VIEW));
    this.group = this.device.createBindGroup({ layout: this.layout, entries: [{ binding: 0, resource: { buffer: this.buffer, size: 16 } }] });
    this.slots.clear();
  }
  offset(t: readonly number[]): number {
    const values = Float32Array.from(t);
    if (values[0] === 1 && values[1] === 1 && values[2] === 0 && values[3] === 0) return 0;
    const key = values.join(',');
    let at = this.slots.get(key);
    if (at !== undefined) return at;
    if (this.slots.size >= SLOTS - 1) { this.retire(this.buffer); this.start(); }
    at = (this.slots.size + 1) * SLOT; this.slots.set(key, at);
    this.device.queue.writeBuffer(this.buffer, at, values);
    return at;
  }
  destroy(): void { this.buffer.destroy(); }
}
