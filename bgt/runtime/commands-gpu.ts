// v0.3 GPU validation. No browser/GPU objects and no guest-memory references survive submission.
import {
  BGT_OK, E_BOUNDS, E_INVALID, E_LIMIT, E_NOT_FOUND, E_STATE, E_UNSUPPORTED,
  GPU, GPU_LAYOUT, GPU_LIMITS, GPU_OP,
} from './abi';
import type { DecodeContext } from './commands';
import type { GpuBackend, GpuItem } from '../renderers/types';

type BufferEntry = { usage: number; shadow: Uint8Array<ArrayBuffer> };
type TextureEntry = { width: number; height: number; mips: number; format: number; usage: number; bytes: number };
type ShaderEntry = { stage: number; language: number; ready: boolean; bytes: number };
type PipelineEntry = {
  words: number[]; buffers: number[][]; attrs: number[][]; colors: number[][];
};
type Binding = { handle: number; offset: number; size: number; format?: number };
type Pass = {
  width: number; height: number; formats: number[]; depth: number; attachments: Set<number>;
  pipeline?: PipelineEntry; vertices: Map<number, Binding>; uniforms: Map<number, Binding>;
  textures: Set<number>; index?: Binding;
};

/** Persistent guest resource validation state, one per host, never shared between games. */
export class GpuState {
  readonly buffers = new Map<number, BufferEntry>();
  readonly textures = new Map<number, TextureEntry>();
  readonly samplers = new Map<number, number[]>();
  readonly shaders = new Map<number, ShaderEntry>();
  readonly pipelines = new Map<number, PipelineEntry>();
  bytes = 0;
  pass?: Pass;
  constructor(readonly backend: GpuBackend) {}
}

const fixedSizes = new Map<number, number>(Object.entries(GPU_OP)
  .filter(([name]) => name !== 'PIPELINE_CREATE' && name !== 'PASS_BEGIN')
  .map(([name, op]) => [op, name === 'PASS_END' ? 0 : GPU_LAYOUT[name.toLowerCase() as keyof typeof GPU_LAYOUT]]));
const vertexSizes = [4, 8, 12, 16, 4, 4, 8, 12, 16, 4, 8, 12, 16];
const pixelSizes = [4, 4, 1, 2, 8, 4, 4];
const validHandle = (h: number) => h > 0 && h <= GPU_LIMITS.handles;
const float = (word: number) => new Float32Array(new Uint32Array([word]).buffer)[0];
const bool = (v: number) => v <= 1;
const textureSize = (t: TextureEntry, mip: number) => ({
  width: Math.max(1, Math.floor(t.width / 2 ** mip)),
  height: Math.max(1, Math.floor(t.height / 2 ** mip)),
});

/** Gate first: old hosts/modules must keep reporting formerly unknown GPU opcodes as unsupported. */
export function executeGpu(op: number, dv: DataView, p: number, n: number, mem: Uint8Array,
  ctx: DecodeContext): number {
  const g = ctx.gpu;
  if (!g || !g.backend.languages) return E_UNSUPPORTED;
  const size = fixedSizes.get(op);
  if (size !== undefined && n !== size) return E_INVALID;
  if (op === GPU_OP.PIPELINE_CREATE) {
    if (n < 104) return E_INVALID;
    const b = dv.getUint32(p + 92, true), a = dv.getUint32(p + 96, true), c = dv.getUint32(p + 100, true);
    if (b > 8 || a > 16 || c > 4) return E_LIMIT;
    if (n !== 104 + b * 8 + a * 16 + c * 36) return E_INVALID;
  }
  if (op === GPU_OP.PASS_BEGIN) {
    if (n < 28) return E_INVALID;
    const c = dv.getUint32(p, true);
    if (c > 4) return E_LIMIT;
    if (n !== 28 + c * 28) return E_INVALID;
  }
  const w = Array.from({ length: n / 4 }, (_, i) => dv.getUint32(p + i * 4, true));
  const h = w[0];
  const item: GpuItem = { kind: 'gpu', op, words: w };
  const emit = () => {
    ctx.frame.gpuUploadBytes += item.data?.length ?? (item.source === undefined ? 0 : w[4]);
    ctx.frame.items.push(item); return BGT_OK;
  };
  const copy = (ptr: number, len: number): Uint8Array<ArrayBuffer> | number => {
    if (ptr + len > mem.byteLength) return E_BOUNDS;
    if (ctx.frame.gpuUploadBytes + len > GPU_LIMITS.budget) return E_LIMIT;
    return new Uint8Array(mem.subarray(ptr, ptr + len));
  };
  // All resource operations are outside passes. Dynamic/binding/draw operations are inside.
  if (op <= GPU_OP.PIPELINE_DELETE && g.pass) return E_STATE;
  if (op >= GPU_OP.PASS_END && !g.pass) return E_STATE;
  const fresh = (map: Map<number, unknown>) => !validHandle(h) ? E_INVALID : map.has(h) ? E_STATE : BGT_OK;
  const budget = (bytes: number) => g.bytes + bytes <= GPU_LIMITS.budget;
  switch (op) {
    case GPU_OP.BUFFER_CREATE: {
      const e = fresh(g.buffers); if (e) return e;
      if (!w[1] || (w[1] & ~7) || !w[2]) return E_INVALID;
      if (w[2] > GPU_LIMITS.bufferSize || !budget(w[2])) return E_LIMIT;
      if (w[4] !== 0 && w[4] !== w[2]) return E_INVALID;
      const data = copy(w[3], w[4]); if (typeof data === 'number') return data;
      item.data = data;
      const shadow = new Uint8Array(w[2]); shadow.set(data);
      g.buffers.set(h, { usage: w[1], shadow }); g.bytes += w[2];
      return emit();
    }
    case GPU_OP.BUFFER_UPDATE: {
      const b = g.buffers.get(h); if (!b) return E_NOT_FOUND;
      if (!w[3]) return E_INVALID;
      if (w[1] + w[3] > b.shadow.length) return E_BOUNDS;
      const data = copy(w[2], w[3]); if (typeof data === 'number') return data;
      b.shadow.set(data, w[1]); item.data = data;
      return emit();
    }
    case GPU_OP.BUFFER_DELETE: {
      const b = g.buffers.get(h); if (!b) return E_NOT_FOUND;
      g.bytes -= b.shadow.length; g.buffers.delete(h); return emit();
    }
    case GPU_OP.TEXTURE_CREATE: {
      const e = fresh(g.textures); if (e) return e;
      if (!w[1] || !w[2] || !w[3] || w[4] > 6 || !w[5] || (w[5] & ~3)) return E_INVALID;
      if (w[1] > GPU_LIMITS.textureDimension || w[2] > GPU_LIMITS.textureDimension) return E_LIMIT;
      if (w[3] > 1 + Math.floor(Math.log2(Math.max(w[1], w[2])))) return E_INVALID;
      let bytes = 0;
      const t = { width: w[1], height: w[2], mips: w[3], format: w[4], usage: w[5], bytes: 0 };
      for (let mip = 0; mip < w[3]; mip++) {
        const s = textureSize(t, mip); bytes += s.width * s.height * pixelSizes[w[4]];
      }
      if (!budget(bytes)) return E_LIMIT;
      t.bytes = bytes; g.bytes += bytes; g.textures.set(h, t); return emit();
    }
    case GPU_OP.TEXTURE_UPDATE: {
      const t = g.textures.get(h); if (!t) return E_NOT_FOUND;
      if (t.format >= 5) return E_UNSUPPORTED; // depth uploads deliberately excluded
      if (w[1] >= t.mips || !w[4] || !w[5]) return E_INVALID;
      const s = textureSize(t, w[1]);
      if (w[2] + w[4] > s.width || w[3] + w[5] > s.height) return E_BOUNDS;
      if (w[7] !== w[4] * w[5] * pixelSizes[t.format]) return E_INVALID;
      const data = copy(w[6], w[7]); if (typeof data === 'number') return data;
      item.data = data; return emit();
    }
    case GPU_OP.TEXTURE_DELETE:
      if (!g.textures.delete(h)) return E_NOT_FOUND;
      // bytes are recomputed to avoid retaining deleted resources.
      g.bytes = [...g.buffers.values()].reduce((n, b) => n + b.shadow.length, 0)
        + [...g.textures.values()].reduce((n, t) => n + t.bytes, 0)
        + [...g.shaders.values()].reduce((n, s) => n + s.bytes, 0);
      return emit();
    case GPU_OP.SAMPLER_CREATE: {
      const e = fresh(g.samplers); if (e) return e;
      if (w[1] > 1 || w[2] > 1 || w[3] > 2 || w[4] > 2 || w[5] > 2 || !bool(w[6]) || w[7] > 7) {
        return E_INVALID;
      }
      g.samplers.set(h, w); return emit();
    }
    case GPU_OP.SAMPLER_DELETE:
      if (!g.samplers.delete(h)) return E_NOT_FOUND;
      return emit();
    case GPU_OP.SHADER_CREATE: {
      const e = fresh(g.shaders); if (e) return e;
      if (w[1] < 1 || w[1] > 3 || w[2] > 2 || !w[4] || (w[1] === 3 && w[2] !== 0)) return E_INVALID;
      if (!(g.backend.languages & (1 << w[2])) || !ctx.gpuRequest) return E_UNSUPPORTED;
      if (w[4] > GPU_LIMITS.shaderBytes || !budget(w[4])) return E_LIMIT;
      const data = copy(w[3], w[4]); if (typeof data === 'number') return data;
      try { item.source = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { return E_INVALID; }
      if (item.source.includes('\0')) return E_INVALID;
      const complete = ctx.gpuRequest(w[5]); if (typeof complete === 'number') return complete;
      const shader = { stage: w[1], language: w[2], ready: false, bytes: w[4] };
      g.shaders.set(h, shader); g.bytes += w[4];
      let completed = false;
      item.complete = (code, log = '') => {
        if (completed) return;
        completed = true;
        if (g.shaders.get(h) === shader) shader.ready = code === BGT_OK;
        const encoded = new TextEncoder().encode(log);
        let end = Math.min(encoded.length, GPU_LIMITS.shaderBytes);
        while (end < encoded.length && (encoded[end] & 0xc0) === 0x80) end--;
        const text = encoded.subarray(0, end);
        const result = new Uint8Array(4 + text.length);
        new DataView(result.buffer).setInt32(0, code, true); result.set(text, 4); complete(result);
      };
      return emit();
    }
    case GPU_OP.SHADER_DELETE: {
      const shader = g.shaders.get(h); if (!shader) return E_NOT_FOUND;
      if ([...g.pipelines.values()].some((v) => v.words[1] === h || v.words[2] === h)) return E_STATE;
      g.bytes -= shader.bytes; g.shaders.delete(h); return emit();
    }
    case GPU_OP.PIPELINE_CREATE: {
      const e = fresh(g.pipelines); if (e) return e;
      const vs = g.shaders.get(w[1]), fs = g.shaders.get(w[2]);
      if (!vs || !fs) return E_NOT_FOUND;
      if (!vs.ready || !fs.ready) return E_STATE;
      if (!(vs.stage & 1) || !(fs.stage & 2) || vs.language !== fs.language) return E_INVALID;
      if (w[3] > 4 || w[4] > 2 || w[5] > 1 || ![GPU.FORMAT_NONE, 5, 6].includes(w[6])) return E_INVALID;
      if (!bool(w[7]) || !bool(w[8]) || w[9] > 7 || !bool(w[10]) || w[11] > 255 || w[12] > 255) {
        return E_INVALID;
      }
      if (w.slice(13, 21).some((v) => v > 7) || w[21] > 255 || w[22] > 255) return E_INVALID;
      if ((w[7] || w[8]) && w[6] === GPU.FORMAT_NONE) return E_INVALID;
      if (w[10] && w[6] !== GPU.FORMAT_DEPTH24_STENCIL8) return E_INVALID;
      let pos = 26;
      const buffers = Array.from({ length: w[23] }, () => { const a = w.slice(pos, pos + 2); pos += 2; return a; });
      const attrs = Array.from({ length: w[24] }, () => { const a = w.slice(pos, pos + 4); pos += 4; return a; });
      const colors = Array.from({ length: w[25] }, () => { const a = w.slice(pos, pos + 9); pos += 9; return a; });
      if (buffers.some(([stride, step]) => !stride || stride % 4 || step > 1)) return E_INVALID;
      if (buffers.some(([stride]) => stride > GPU_LIMITS.stride)) return E_LIMIT;
      const locations = new Set<number>();
      for (const [location, buffer, offset, format] of attrs) {
        if (location >= 16 || locations.has(location) || buffer >= buffers.length || format > 12) return E_INVALID;
        if (offset % (format === 4 ? 1 : 4) || offset + vertexSizes[format] > buffers[buffer][0]) return E_INVALID;
        locations.add(location);
      }
      for (const c of colors) {
        if (c[0] > 4 || !bool(c[1]) || c[2] > 11 || c[3] > 11 || c[4] > 4
          || c[5] > 11 || c[6] > 11 || c[7] > 4 || c[8] > 15) return E_INVALID;
      }
      g.pipelines.set(h, { words: w, buffers, attrs, colors }); return emit();
    }
    case GPU_OP.PIPELINE_DELETE:
      if (!g.pipelines.delete(h)) return E_NOT_FOUND;
      return emit();
    case GPU_OP.PASS_BEGIN: {
      if (g.pass) return E_STATE;
      if (!w[0] && !w[1]) return E_INVALID;
      if (w[3] > 1 || w[4] > 1 || !Number.isFinite(float(w[5])) || float(w[5]) < 0
        || float(w[5]) > 1 || w[6] > 255) return E_INVALID;
      let width = 0, height = 0;
      const attachments = new Set<number>(), formats: number[] = [];
      const attach = (handle: number, mip: number, depth: boolean): number => {
        if (attachments.has(handle)) return E_STATE;
        attachments.add(handle);
        let tw: number, th: number, format: number;
        if (!handle && !depth) {
          if (w[0] !== 1 || mip) return E_INVALID;
          tw = ctx.frame.logicalW; th = ctx.frame.logicalH; format = 0;
        } else {
          const t = g.textures.get(handle); if (!t) return E_NOT_FOUND;
          if (!(t.usage & 2) || (t.format >= 5) !== depth || mip >= t.mips) return E_INVALID;
          const s = textureSize(t, mip); tw = s.width; th = s.height; format = t.format;
        }
        if (width && (width !== tw || height !== th)) return E_INVALID;
        width = tw; height = th;
        if (!depth) formats.push(format);
        return BGT_OK;
      };
      for (let c = 0; c < w[0]; c++) {
        const pos = 7 + c * 7;
        if (w[pos + 2] > 1 || w.slice(pos + 3, pos + 7).some((v) => !Number.isFinite(float(v)))) return E_INVALID;
        const e = attach(w[pos], w[pos + 1], false); if (e) return e;
      }
      let depth: number = GPU.FORMAT_NONE;
      if (w[1]) {
        const e = attach(w[1], w[2], true); if (e) return e;
        depth = g.textures.get(w[1])!.format;
        if (depth !== 5 && w[4] !== 0) return E_INVALID;
      } else if (w[2] || w[3] || w[4]) return E_INVALID;
      g.pass = { width, height, formats, depth, attachments,
        vertices: new Map(), uniforms: new Map(), textures: new Set() };
      return emit();
    }
    case GPU_OP.PASS_END:
      g.pass = undefined; return emit();
  }
  const pass = g.pass!;
  switch (op) {
    case GPU_OP.PIPELINE: {
      const pipeline = g.pipelines.get(h); if (!pipeline) return E_NOT_FOUND;
      if (pipeline.words[6] !== pass.depth || pipeline.colors.length !== pass.formats.length
        || pipeline.colors.some((c, i) => c[0] !== pass.formats[i])) return E_STATE;
      pass.pipeline = pipeline; return emit();
    }
    case GPU_OP.VIEWPORT: {
      const v = w.map(float);
      if (v.some((a) => !Number.isFinite(a)) || v[0] < 0 || v[1] < 0 || v[2] <= 0 || v[3] <= 0
        || v[0] + v[2] > pass.width || v[1] + v[3] > pass.height || v[4] < 0 || v[5] > 1 || v[4] > v[5]) {
        return E_INVALID;
      }
      return emit();
    }
    case GPU_OP.SCISSOR:
      if (w[0] + w[2] > pass.width || w[1] + w[3] > pass.height) return E_BOUNDS;
      return emit();
    case GPU_OP.STENCIL_REF:
      if (h > 255) return E_INVALID;
      return emit();
    case GPU_OP.BLEND_CONSTANT:
      if (w.some((v) => !Number.isFinite(float(v)) || float(v) < 0 || float(v) > 1)) return E_INVALID;
      return emit();
    case GPU_OP.VERTEX_BUFFER:
    case GPU_OP.UNIFORM_BUFFER:
    case GPU_OP.INDEX_BUFFER: {
      const index = op === GPU_OP.INDEX_BUFFER;
      const slot = index ? 0 : h, handle = index ? h : w[1];
      if (slot >= 8 || (index && w[1] > 1)) return E_INVALID;
      const b = g.buffers.get(handle); if (!b) return E_NOT_FOUND;
      const usage = index ? 2 : op === GPU_OP.UNIFORM_BUFFER ? 4 : 1;
      if (!(b.usage & usage) || !w[3]) return E_INVALID;
      if (w[2] + w[3] > b.shadow.length) return E_BOUNDS;
      const align = index ? (w[1] ? 4 : 2) : usage === 4 ? GPU_LIMITS.uniformAlignment : 4;
      if (w[2] % align || (usage === 4 && w[3] % 16) || (index && w[3] % align)) return E_INVALID;
      if (usage === 4 && w[3] > GPU_LIMITS.uniformRange) return E_LIMIT;
      const binding = { handle, offset: w[2], size: w[3], format: index ? w[1] : undefined };
      if (index) pass.index = binding;
      else (usage === 4 ? pass.uniforms : pass.vertices).set(slot, binding);
      return emit();
    }
    case GPU_OP.TEXTURE: {
      if (h >= 8) return E_INVALID;
      const t = g.textures.get(w[1]), s = g.samplers.get(w[2]);
      if (!t || !s) return E_NOT_FOUND;
      if (!(t.usage & 1) || (s[6] && t.format < 5)) return E_INVALID;
      if (pass.attachments.has(w[1])) return E_STATE;
      pass.textures.add(h); return emit();
    }
    case GPU_OP.DRAW:
    case GPU_OP.DRAW_INDEXED: {
      const pipeline = pass.pipeline; if (!pipeline) return E_STATE;
      if (!h || !w[1]) return E_INVALID;
      if (w[1] > 65535 || ctx.frame.vertexCount + ctx.frame.gpuVertices + h * w[1] > 1572864) return E_LIMIT;
      for (let slot = 0; slot < 8; slot++) {
        if (((pipeline.words[21] >> slot) & 1) && !pass.uniforms.has(slot)) return E_STATE;
        if (((pipeline.words[22] >> slot) & 1) && !pass.textures.has(slot)) return E_STATE;
      }
      let maxVertex = w[2] + h - 1;
      const indexed = op === GPU_OP.DRAW_INDEXED;
      if (indexed) {
        const ib = pass.index; if (!ib) return E_STATE;
        const size = ib.format ? 4 : 2;
        if ((w[2] + h) * size > ib.size) return E_BOUNDS;
        const shadow = g.buffers.get(ib.handle)!.shadow;
        const view = new DataView(shadow.buffer);
        const base = w[3] | 0;
        maxVertex = 0;
        for (let i = 0; i < h; i++) {
          const offset = ib.offset + (w[2] + i) * size;
          const vertex = (size === 2 ? view.getUint16(offset, true) : view.getUint32(offset, true)) + base;
          if (vertex < 0 || vertex > 0xffffffff) return E_BOUNDS;
          maxVertex = Math.max(maxVertex, vertex);
        }
      }
      const firstInstance = w[indexed ? 4 : 3];
      if (firstInstance + w[1] > 0x100000000 || maxVertex > 0xffffffff) return E_BOUNDS;
      for (let slot = 0; slot < pipeline.buffers.length; slot++) {
        const binding = pass.vertices.get(slot); if (!binding) return E_STATE;
        const [stride, step] = pipeline.buffers[slot];
        const last = step ? firstInstance + w[1] - 1 : maxVertex;
        const extent = Math.max(0, ...pipeline.attrs.filter((a) => a[1] === slot)
          .map((a) => a[2] + vertexSizes[a[3]]));
        if (extent && last * stride + extent > binding.size) return E_BOUNDS;
      }
      ctx.frame.gpuVertices += h * w[1];
      return emit();
    }
    default: return E_UNSUPPORTED;
  }
}
