// K62: provoking vertex. §13 GLSL flat varyings take the value of the LAST vertex of each primitive (GL's default
// convention, which WebGL 2 implements natively). WebGPU's @interpolate(flat) takes the first vertex, so for GLSL
// pipelines with flat fragment inputs the executor draws each line/triangle with its last vertex first: triangles
// are rotated cyclically (c, a, b), which keeps the winding, lines are swapped (b, a). Points are unaffected.
// Vertex order, IDs and every captured transform-feedback value are unchanged (capture runs on the original draw).

/** Rotated list order for indices `v` of a line (2) or triangle (3) list; a trailing partial primitive is dropped. */
export function rotateList(v: ArrayLike<number>, n: 2 | 3): Uint32Array<ArrayBuffer> {
  const count = v.length - v.length % n, out = new Uint32Array(count);
  for (let i = 0; i < count; i += n) {
    if (n === 2) { out[i] = v[i + 1]; out[i + 1] = v[i]; }
    else { out[i] = v[i + 2]; out[i + 1] = v[i]; out[i + 2] = v[i + 1]; }
  }
  return out;
}

export function sequenceCapacity(primitives:number):number {
  let cap=1024;while(cap<primitives)cap*=2;return cap;
}
export function indexRingSize(bytes:number):number {
  let size=1<<20;while(size<bytes)size*=2;return size;
}

/** Static rotated sequences {k*n + rotation} for non-indexed list draws (drawn with base_vertex = first); grown by
 * powers of two, so a steady draw costs no upload. */
export class RotatedSequences {
  private lists = new Map<number, { buffer: GPUBuffer; primitives: number }>();
  constructor(private device: GPUDevice, private retire: (b: GPUBuffer) => void) {}
  get(n: 2 | 3, primitives: number): GPUBuffer {
    const have = this.lists.get(n);
    if (have && have.primitives >= primitives) return have.buffer;
    const cap=sequenceCapacity(primitives);
    const seq = new Uint32Array(cap * n); for (let i = 0; i < seq.length; i++) seq[i] = i;
    const data = rotateList(seq, n);
    const buffer = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.INDEX, mappedAtCreation: true });
    new Uint32Array(buffer.getMappedRange()).set(data); buffer.unmap();
    if (have) this.retire(have.buffer);
    this.lists.set(n, { buffer, primitives: cap });
    return buffer;
  }
  get bytes(): number { let n=0;for(const l of this.lists.values())n+=l.buffer.size;return n; }
  destroy(): void { for (const l of this.lists.values()) l.buffer.destroy(); this.lists.clear(); }
}

/** K62 (vK62): rotated copies of indexed draws, appended to an index ring by queue writes (a fresh region no encoded
 * command reads, so the write is ordered before every use). Entries are keyed by the caller (globally unique store
 * identity + contents version + range), reused while the ring lives; a full ring is retired (destroyed after the
 * pending submit) and a new one started, so a buffer rewritten every frame costs a queue write, not a GPU buffer. */
export class RotatedIndexRing {
  private buffer?: GPUBuffer; private size = 0; private at = 0;
  private entries = new Map<string, { offset: number; bytes: number }>();
  /** Buffers created (census for tests). */
  created = 0;
  constructor(private device: GPUDevice, private retire: (b: GPUBuffer) => void) {}
  get(key: string, make: () => Uint32Array<ArrayBuffer>): { buffer: GPUBuffer; offset: number; bytes: number } {
    const hit = this.entries.get(key);
    if (hit && this.buffer) return { buffer: this.buffer, ...hit };
    const data = make(), bytes = Math.max(4, data.byteLength);
    if (!this.buffer || this.at + bytes > this.size) {
      if (this.buffer) this.retire(this.buffer);
      const size=indexRingSize(bytes);
      this.buffer = this.device.createBuffer({ size, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      this.size = size; this.at = 0; this.entries.clear(); this.created++;
    }
    const entry = { offset: this.at, bytes };
    if (data.byteLength) this.device.queue.writeBuffer(this.buffer, this.at, data);
    this.at += bytes; this.entries.set(key, entry);
    return { buffer: this.buffer, ...entry };
  }
  get bytes(): number { return this.buffer?.size??0; }
  destroy(): void { this.buffer?.destroy(); this.buffer = undefined; this.entries.clear(); }
}
