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

/** Static rotated sequences {k*n + rotation} for non-indexed list draws (drawn with base_vertex = first); grown by
 * powers of two, so a steady draw costs no upload. */
export class RotatedSequences {
  private lists = new Map<number, { buffer: GPUBuffer; primitives: number }>();
  constructor(private device: GPUDevice, private retire: (b: GPUBuffer) => void) {}
  get(n: 2 | 3, primitives: number): GPUBuffer {
    const have = this.lists.get(n);
    if (have && have.primitives >= primitives) return have.buffer;
    let cap = 1024; while (cap < primitives) cap *= 2;
    const seq = new Uint32Array(cap * n); for (let i = 0; i < seq.length; i++) seq[i] = i;
    const data = rotateList(seq, n);
    const buffer = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.INDEX, mappedAtCreation: true });
    new Uint32Array(buffer.getMappedRange()).set(data); buffer.unmap();
    if (have) this.retire(have.buffer);
    this.lists.set(n, { buffer, primitives: cap });
    return buffer;
  }
  destroy(): void { for (const l of this.lists.values()) l.buffer.destroy(); this.lists.clear(); }
}
