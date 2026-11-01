import { describe, expect, it } from 'vitest';
import * as A from '../../bgt/runtime/abi';
import {
  CommandEncoder, Frame, TextureTable, defaultState, decodeCommands, type DecodeContext,
} from '../../bgt/runtime/commands';
import { GpuState } from '../../bgt/runtime/commands-gpu';
import { type GpuItem, UNSUPPORTED_GPU } from '../../bgt/renderers/types';
import { Requests } from '../../bgt/runtime/requests';

const O = A.GPU_OP;
const F = (f: number) => new Uint32Array(new Float32Array([f]).buffer)[0];
const source = new TextEncoder().encode('valid source for a recording backend');
const pipeline = (patch: Record<number, number> = {}, buffers: number[] = [16, 0],
  attrs: number[] = [0, 0, 0, 3], colors: number[] = [0, 0, 1, 0, 0, 1, 0, 0, 15]) => {
  const words = [1, 1, 2, 3, 0, 0, A.GPU.FORMAT_NONE, 0, 0, 7, 0, 255, 255,
    7, 0, 0, 0, 7, 0, 0, 0, 1, 1, buffers.length / 2, attrs.length / 4, colors.length / 9];
  for (const [index, value] of Object.entries(patch)) words[Number(index)] = value;
  return [...words, ...buffers, ...attrs, ...colors];
};
const begin = [1, 0, 0, 0, 0, F(1), 0, 0, 0, 1, F(0.1), F(0.2), F(0.3), F(1)];
function setup() {
  const frame = new Frame(); frame.reset(64, 64);
  const requests = new Requests();
  const ctx: DecodeContext = {
    state: defaultState(64, 64), frame, textures: new TextureTable(), linearFilter: true, triangles: true,
    gpu: new GpuState({ languages: 7, execute: () => 0 }),
    gpuRequest: (id) => {
      const token = requests.reserve(id);
      return typeof token === 'number' ? token : (data, error) => requests.complete(token, data, error);
    },
  };
  const run = (encoder: CommandEncoder) => {
    const bytes = encoder.finish(), mem = new Uint8Array(32768);
    mem.set(bytes); mem.set(source, 16384);
    return decodeCommands(mem, 0, bytes.length, ctx);
  };
  const send = (op: number, words: number[] = []) => run(new CommandEncoder().gpu(op, words));
  const inPass = (op: number, words: number[] = []) => run(new CommandEncoder()
    .gpu(O.PASS_BEGIN, begin).gpu(op, words).gpu(O.PASS_END, []));
  const compile = () => {
    expect(run(new CommandEncoder()
      .gpu(O.SHADER_CREATE, [1, 1, 0, 16384, source.length, 1])
      .gpu(O.SHADER_CREATE, [2, 2, 0, 16384, source.length, 2])).errors).toEqual([]);
    for (const item of frame.items) if (item.kind === 'gpu' && item.complete) item.complete(0, 'compiled');
  };
  const resources = () => {
    compile();
    expect(run(new CommandEncoder()
      .gpu(O.BUFFER_CREATE, [1, 7, 4096, 0, 0])
      .gpu(O.TEXTURE_CREATE, [1, 8, 8, 4, 0, 3])
      .gpu(O.SAMPLER_CREATE, [1, 1, 1, 2, 0, 1, 0, 7])
      .gpu(O.PIPELINE_CREATE, pipeline())).errors).toEqual([]);
  };
  const bound = () => new CommandEncoder().gpu(O.PASS_BEGIN, begin)
    .gpu(O.PIPELINE, [1]).gpu(O.VERTEX_BUFFER, [0, 1, 0, 4096])
    .gpu(O.INDEX_BUFFER, [1, 0, 0, 256]).gpu(O.UNIFORM_BUFFER, [0, 1, 0, 256])
    .gpu(O.TEXTURE, [0, 1, 1]);
  return { ctx, frame, requests, run, send, inPass, compile, resources, bound };
}

describe('GPU command validation', () => {
  it('accepts every GPU op, preserves exact 2D/GPU ordering, copies uploads and sends validated backend items', () => {
    const t = setup(); t.resources();
    expect(t.run(new CommandEncoder().clear(0xff112233)
      .gpu(O.BUFFER_UPDATE, [1, 1024, 16384, source.length])
      .gpu(O.TEXTURE_UPDATE, [1, 3, 0, 0, 1, 1, 16384, 4])).errors).toEqual([]);
    expect(t.run(t.bound().gpu(O.VIEWPORT, [0, 0, F(64), F(64), 0, F(1)])
      .gpu(O.SCISSOR, [0, 0, 64, 64]).gpu(O.STENCIL_REF, [42])
      .gpu(O.BLEND_CONSTANT, [F(0.25), F(0.5), F(0.75), F(1)])
      .gpu(O.DRAW, [3, 2, 0, 1]).gpu(O.DRAW_INDEXED, [3, 2, 0, 1, 2])
      .gpu(O.PASS_END, []).clear(0xff223344)).errors).toEqual([]);
    expect(t.run(new CommandEncoder() // §13.7 operations, all outside passes
      .gpu(O.TEXTURE_CREATE_EX, [2, 0, 4, 4, 1, 2, 0, 1]).gpu(O.TEXTURE_ALLOCATE_MIPS, [2, 2])
      .gpu(O.TEXTURE_UPDATE_EX, [2, 0, 0, 0, 0, 1, 1, 1, 16384, 4])
      .gpu(O.SAMPLER_CREATE_EX, [2, 1, 1, 2, 0, 1, 0, 0, 7, F(0), F(4)]).gpu(O.TEXTURE_GENERATE_MIPS, [2, 0])
      .gpu(O.TEXTURE_READBACK, [2, 0, 0, 0, 0, 1, 1, 1, 5]).gpu(O.TEXTURE_DELETE, [2]).gpu(O.SAMPLER_DELETE, [2])).errors)
      .toEqual([]);
    expect(t.run(new CommandEncoder().gpu(O.PIPELINE_DELETE, [1])
      .gpu(O.SHADER_DELETE, [1]).gpu(O.SHADER_DELETE, [2]).gpu(O.SAMPLER_DELETE, [1])
      .gpu(O.TEXTURE_DELETE, [1]).gpu(O.BUFFER_DELETE, [1])).errors).toEqual([]);
    const items = t.frame.items.filter((it): it is GpuItem => it.kind === 'gpu');
    expect(new Set(items.map((it) => it.op))).toEqual(new Set(Object.values(O)));
    expect(items.find((it) => it.op === O.BUFFER_UPDATE)?.data).toEqual(source);
    expect(t.ctx.gpu!.bytes).toBe(0);
    const start = t.frame.items.findIndex((it) => it.kind === 'gpu' && it.op === O.PASS_BEGIN);
    const end = t.frame.items.findIndex((it) => it.kind === 'gpu' && it.op === O.PASS_END);
    expect(t.frame.items[start - 1].kind).toBe('gpu');
    expect(t.frame.items[end + 1].kind).toBe('draw');
    const seen: number[] = [];
    const backend = { languages: 7, execute: (item: GpuItem) => { seen.push(item.op); return 0; } };
    for (const item of items) expect(backend.execute(item)).toBe(0);
    expect(seen).toEqual(items.map((item) => item.op));
  });

  it('all op layouts are exact, unsupported by default, and framing is side-effect-free', () => {
    const sizes = new Map<number, number>();
    for (const [name, op] of Object.entries(O)) sizes.set(op,
      name === 'PASS_END' ? 0 : A.GPU_LAYOUT[name.toLowerCase() as keyof typeof A.GPU_LAYOUT]);
    for (const [op, bytes] of sizes) {
      const t = setup(); t.ctx.gpu = undefined;
      const words = new Array(bytes / 4).fill(0);
      expect(t.send(op, words).status, String(op)).toBe(A.E_UNSUPPORTED);
      expect(t.send(op, [...words, 0]).status, String(op)).toBe(A.E_UNSUPPORTED);
      t.ctx.gpu = new GpuState({ languages: 7, execute: () => 0 });
      expect(t.send(op, [...words, 0]).status, String(op)).toBe(A.E_INVALID);
      expect(t.frame.items).toHaveLength(0);
    }
    expect(UNSUPPORTED_GPU.execute({ kind: 'gpu', op: O.PASS_END, words: [] })).toBe(A.E_UNSUPPORTED);
    const t = setup(), bytes = new CommandEncoder().gpu(O.BUFFER_CREATE, [1, 1, 16, 0, 0]).finish();
    new DataView(bytes.buffer).setUint32(20, 100, true);
    expect(decodeCommands(bytes, 0, bytes.length, t.ctx).status).toBe(A.E_BOUNDS);
    expect(t.ctx.gpu!.buffers.size).toBe(0);
  });

  it.each([
    [O.BUFFER_CREATE, [0, 1, 16, 0, 0], A.E_INVALID],
    [O.BUFFER_CREATE, [1, 8, 16, 0, 0], A.E_INVALID],
    [O.BUFFER_CREATE, [1, 1, 0x4000001, 0, 0], A.E_LIMIT],
    [O.BUFFER_CREATE, [1, 1, 16, 0, 4], A.E_INVALID],
    [O.BUFFER_CREATE, [1, 1, 16, 32760, 16], A.E_BOUNDS],
    [O.TEXTURE_CREATE, [1, 0, 8, 1, 0, 1], A.E_INVALID],
    [O.TEXTURE_CREATE, [1, 8192, 8, 1, 0, 1], A.E_LIMIT],
    [O.TEXTURE_CREATE, [1, 8, 8, 5, 0, 1], A.E_INVALID],
    [O.TEXTURE_CREATE, [1, 8, 8, 1, 7, 1], A.E_INVALID],
    [O.SAMPLER_CREATE, [1, 2, 0, 0, 0, 0, 0, 7], A.E_INVALID],
    [O.SAMPLER_CREATE, [1, 0, 0, 0, 0, 0, 2, 7], A.E_INVALID],
    [O.SHADER_CREATE, [1, 3, 1, 16384, 8, 1], A.E_INVALID],
    [O.SHADER_CREATE, [1, 1, 0, 16384, 1048577, 1], A.E_LIMIT],
    [O.BUFFER_DELETE, [7], A.E_NOT_FOUND],
    [O.BUFFER_UPDATE, [7, 0, 0, 1], A.E_NOT_FOUND],
    [O.TEXTURE_DELETE, [7], A.E_NOT_FOUND],
    [O.TEXTURE_UPDATE, [7, 0, 0, 0, 1, 1, 0, 4], A.E_NOT_FOUND],
    [O.SAMPLER_DELETE, [7], A.E_NOT_FOUND],
    [O.SHADER_DELETE, [7], A.E_NOT_FOUND],
    [O.PIPELINE_DELETE, [7], A.E_NOT_FOUND],
    [O.PIPELINE_CREATE, pipeline(), A.E_NOT_FOUND],
    [O.PASS_BEGIN, [0, 0, 0, 0, 0, F(1), 0], A.E_INVALID],
    [O.PASS_END, [], A.E_STATE],
    [O.PIPELINE, [1], A.E_STATE],
    [O.DRAW, [3, 1, 0, 0], A.E_STATE],
  ])('rejects invalid resource/state op %i with %i', (op, words, error) => {
    expect(setup().send(op, words).status).toBe(error);
  });

  it('rejects duplicate resources, update ranges, depth uploads, shader dependencies and memory errors', () => {
    const t = setup(); t.resources();
    expect(t.send(O.BUFFER_CREATE, [1, 1, 16, 0, 0]).status).toBe(A.E_STATE);
    expect(t.send(O.BUFFER_UPDATE, [1, 4090, 16384, 16]).status).toBe(A.E_BOUNDS);
    expect(t.send(O.TEXTURE_UPDATE, [1, 4, 0, 0, 1, 1, 16384, 4]).status).toBe(A.E_INVALID);
    expect(t.send(O.TEXTURE_UPDATE, [1, 3, 1, 0, 1, 1, 16384, 4]).status).toBe(A.E_BOUNDS);
    expect(t.send(O.TEXTURE_UPDATE, [1, 3, 0, 0, 1, 1, 16384, 8]).status).toBe(A.E_INVALID);
    expect(t.send(O.TEXTURE_UPDATE, [1, 3, 0, 0, 1, 1, 32767, 4]).status).toBe(A.E_BOUNDS);
    expect(t.send(O.TEXTURE_CREATE, [2, 8, 8, 1, 5, 2]).status).toBe(0);
    expect(t.send(O.TEXTURE_UPDATE, [2, 0, 0, 0, 1, 1, 16384, 4]).status).toBe(A.E_UNSUPPORTED);
    expect(t.send(O.SHADER_DELETE, [1]).status).toBe(A.E_STATE);
    expect(t.send(O.SHADER_CREATE, [3, 1, 0, 16384, source.length, 1]).status).toBe(A.E_STATE);
    expect(t.ctx.gpu!.shaders.has(3)).toBe(false);
  });

  it.each([
    [O.VIEWPORT, [0, 0, F(65), F(1), 0, F(1)], A.E_INVALID],
    [O.VIEWPORT, [0, 0, F(1), F(1), F(NaN), F(1)], A.E_INVALID],
    [O.SCISSOR, [64, 0, 1, 1], A.E_BOUNDS],
    [O.STENCIL_REF, [256], A.E_INVALID],
    [O.BLEND_CONSTANT, [0, 0, 0, F(Infinity)], A.E_INVALID],
    [O.VERTEX_BUFFER, [8, 1, 0, 16], A.E_INVALID],
    [O.VERTEX_BUFFER, [0, 7, 0, 16], A.E_NOT_FOUND],
    [O.VERTEX_BUFFER, [0, 1, 4096, 16], A.E_BOUNDS],
    [O.UNIFORM_BUFFER, [0, 1, 4, 16], A.E_INVALID],
    [O.INDEX_BUFFER, [1, 2, 0, 16], A.E_INVALID],
    [O.TEXTURE, [0, 7, 1], A.E_NOT_FOUND],
    [O.DRAW, [3, 1, 0, 0], A.E_STATE],
    [O.PIPELINE, [7], A.E_NOT_FOUND],
    [O.BUFFER_DELETE, [1], A.E_STATE],
    [O.PASS_BEGIN, begin, A.E_STATE],
  ])('rejects invalid pass op %i', (op, words, error) => {
    const t = setup(); t.resources();
    expect(t.inPass(op, words).status).toBe(error);
  });

  it('enforces pipeline layouts, masks, formats, readiness and draw fetch bounds', () => {
    const t = setup();
    t.send(O.SHADER_CREATE, [1, 1, 0, 16384, source.length, 1]);
    t.send(O.SHADER_CREATE, [2, 2, 0, 16384, source.length, 2]);
    expect(t.send(O.PIPELINE_CREATE, pipeline()).status).toBe(A.E_STATE);
    for (const item of t.frame.items) if (item.kind === 'gpu') item.complete?.(0);
    for (const [offset, value] of [[3, 5], [6, 0], [7, 2], [10, 1], [13, 8], [21, 256]]) {
      expect(t.send(O.PIPELINE_CREATE, pipeline({ [offset]: value })).status).toBe(A.E_INVALID);
    }
    expect(t.send(O.PIPELINE_CREATE, pipeline({}, [16, 2])).status).toBe(A.E_INVALID);
    expect(t.send(O.PIPELINE_CREATE, pipeline({}, [4096, 0])).status).toBe(A.E_LIMIT);
    expect(t.send(O.PIPELINE_CREATE, pipeline({}, [16, 0], [0, 0, 4, 3])).status).toBe(A.E_INVALID);
    expect(t.send(O.PIPELINE_CREATE, pipeline({}, [16, 0], [0, 0, 0, 13])).status).toBe(A.E_INVALID);
    expect(t.send(O.PIPELINE_CREATE, pipeline()).status).toBe(0);
    t.send(O.BUFFER_CREATE, [1, 7, 4096, 0, 0]);
    t.send(O.TEXTURE_CREATE, [1, 8, 8, 1, 0, 1]);
    t.send(O.SAMPLER_CREATE, [1, 0, 0, 0, 0, 0, 0, 7]);
    expect(t.run(t.bound().gpu(O.DRAW, [0, 1, 0, 0]).gpu(O.PASS_END, [])).status).toBe(A.E_INVALID);
    expect(t.run(t.bound().gpu(O.DRAW, [3, 1, 256, 0]).gpu(O.PASS_END, [])).status).toBe(A.E_BOUNDS);
    expect(t.run(t.bound().gpu(O.DRAW_INDEXED, [3, 1, 0, -1, 0]).gpu(O.PASS_END, [])).status).toBe(A.E_BOUNDS);
    expect(t.run(t.bound().gpu(O.DRAW_INDEXED, [300, 1, 0, 0, 0]).gpu(O.PASS_END, [])).status)
      .toBe(A.E_BOUNDS);
    expect(t.run(t.bound().gpu(O.DRAW, [3, 65536, 0, 0]).gpu(O.PASS_END, [])).status).toBe(A.E_LIMIT);
    const missing = new CommandEncoder().gpu(O.PASS_BEGIN, begin).gpu(O.PIPELINE, [1])
      .gpu(O.DRAW, [3, 1, 0, 0]).gpu(O.PASS_END, []);
    expect(t.run(missing).status).toBe(A.E_STATE);
  });

  it('rejects feedback, mismatched attachments/formats, and 2D interruption without corrupting pass state', () => {
    const t = setup(); t.resources();
    const offscreen = [...begin]; offscreen[7] = 1;
    expect(t.run(new CommandEncoder().gpu(O.PASS_BEGIN, offscreen).gpu(O.TEXTURE, [0, 1, 1])
      .clear(0).gpu(O.PASS_END, []).clear(1)).errors.map((e) => e.code)).toEqual([A.E_STATE, A.E_STATE]);
    t.send(O.TEXTURE_CREATE, [2, 8, 8, 1, 5, 2]);
    const mismatch = [...begin]; mismatch[1] = 2;
    expect(t.send(O.PASS_BEGIN, mismatch).status).toBe(A.E_INVALID);
    expect(t.ctx.gpu!.pass).toBeUndefined();
    const depthPass = [...offscreen]; depthPass[1] = 2;
    expect(t.run(new CommandEncoder().gpu(O.PASS_BEGIN, depthPass).gpu(O.PIPELINE, [1])
      .gpu(O.PASS_END, [])).status).toBe(A.E_STATE);
    expect(t.send(O.PASS_BEGIN, begin).status).toBe(A.E_STATE); // missing end closes implicitly
    expect(t.ctx.gpu!.pass).toBeUndefined();
    expect(t.frame.items.at(-1)).toMatchObject({ kind: 'gpu', op: O.PASS_END });
  });

  it('copies guest uploads immediately, rejects oversized inline counts and shares the 2D frame budget', () => {
    const t = setup();
    const bytes = new CommandEncoder().gpu(O.BUFFER_CREATE, [1, 1, 16, 4096, 16]).finish();
    const mem = new Uint8Array(8192); mem.set(bytes); mem.fill(42, 4096, 4112);
    expect(decodeCommands(mem, 0, bytes.length, t.ctx).status).toBe(0);
    mem.fill(0);
    expect((t.frame.items[0] as GpuItem).data).toEqual(new Uint8Array(16).fill(42));
    expect(t.ctx.gpu!.buffers.get(1)!.shadow).toEqual(new Uint8Array(16).fill(42));
    const header = pipeline().slice(0, 26); header[23] = 9;
    expect(t.send(O.PIPELINE_CREATE, header).status).toBe(A.E_LIMIT);
    expect(t.send(O.PASS_BEGIN, [5, 0, 0, 0, 0, F(1), 0]).status).toBe(A.E_LIMIT);
    t.frame.gpuVertices = A.LIMITS.verticesPerFrame;
    expect(t.run(new CommandEncoder().clear(0)).status).toBe(A.E_LIMIT);
    t.frame.reset(64, 64);
    expect(t.frame.gpuUploadBytes).toBe(0); expect(t.frame.gpuVertices).toBe(0);
  });

  it('shader compile logs use deferred request results, include errors and survive handle deletion/reuse', () => {
    const t = setup();
    expect(t.send(O.SHADER_CREATE, [1, 1, 0, 16384, source.length, 1]).status).toBe(0);
    const shader = t.frame.items.at(-1) as GpuItem;
    expect(t.requests.status(1)).toBe(0);
    t.send(O.SHADER_DELETE, [1]);
    shader.complete!(A.E_IO, 'line 3: syntax error');
    expect(t.requests.status(1)).toBe(0);
    t.requests.advance();
    expect(t.requests.status(1)).toBe(1);
    const data = new Uint8Array(128), size = t.requests.read(1, data);
    expect(new DataView(data.buffer).getInt32(0, true)).toBe(A.E_IO);
    expect(new TextDecoder().decode(data.subarray(4, size))).toBe('line 3: syntax error');
    expect(t.ctx.gpu!.shaders.size).toBe(0);
  });

  it.each([0, 1, 2, 3, 4, 5, 6])('allocates format %i and accounts every mip byte', (format) => {
    const t = setup();
    expect(t.send(O.TEXTURE_CREATE, [1, 8, 4, 4, format, 3]).status).toBe(0);
    expect(t.ctx.gpu!.bytes).toBe((32 + 8 + 2 + 1) * [4, 4, 1, 2, 8, 4, 4][format]);
    expect(t.send(O.TEXTURE_DELETE, [1]).status).toBe(0);
    expect(t.ctx.gpu!.bytes).toBe(0);
  });

  it('accepts MRT/depth, depth-only, instanced vertex fetch and signed base-vertex fetch', () => {
    const t = setup(); t.resources();
    t.send(O.TEXTURE_CREATE, [2, 8, 8, 1, 1, 3]);
    t.send(O.TEXTURE_CREATE, [3, 8, 8, 1, 5, 3]);
    const mrt = [2, 3, 0, 1, 1, F(0.5), 42, 1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0];
    expect(t.run(new CommandEncoder().gpu(O.PASS_BEGIN, mrt).gpu(O.PASS_END, [])).status).toBe(0);
    expect(t.run(new CommandEncoder().gpu(O.PASS_BEGIN, [0, 3, 0, 1, 1, F(1), 0])
      .gpu(O.PASS_END, [])).status).toBe(0);
    t.send(O.PIPELINE_DELETE, [1]);
    expect(t.send(O.PIPELINE_CREATE, pipeline({}, [16, 1])).status).toBe(0);
    expect(t.run(t.bound().gpu(O.DRAW, [3, 2, 0, 255]).gpu(O.PASS_END, [])).status).toBe(A.E_BOUNDS);
    expect(t.run(t.bound().gpu(O.DRAW, [3, 2, 0, 254]).gpu(O.PASS_END, [])).status).toBe(0);
    // Fill u16 indices with 0x6176 from source 'va'; negative base brings them into range.
    t.send(O.BUFFER_UPDATE, [1, 0, 16384, 2]);
    const negative = -(source[0] | (source[1] << 8));
    expect(t.run(t.bound().gpu(O.DRAW_INDEXED, [1, 1, 0, negative, 0])
      .gpu(O.PASS_END, [])).status).toBe(0);
    expect(t.run(t.bound().gpu(O.DRAW, [1, 2, 0, 0xffffffff]).gpu(O.PASS_END, [])).status).toBe(A.E_BOUNDS);
  });

  it('failed commands do not consume upload budgets, mutate resources, or leak request slots', () => {
    const t = setup(); t.resources();
    t.frame.gpuUploadBytes = A.GPU_LIMITS.budget - 1;
    const before = t.ctx.gpu!.buffers.get(1)!.shadow.slice();
    expect(t.send(O.BUFFER_UPDATE, [1, 0, 16384, 4]).status).toBe(A.E_LIMIT);
    expect(t.ctx.gpu!.buffers.get(1)!.shadow).toEqual(before);
    expect(t.frame.gpuUploadBytes).toBe(A.GPU_LIMITS.budget - 1);
    expect(t.send(O.SHADER_CREATE, [3, 1, 0, 16384, source.length, 3]).status).toBe(A.E_LIMIT);
    expect(t.requests.status(3)).toBe(A.E_NOT_FOUND);
    t.ctx.gpu!.bytes = A.GPU_LIMITS.budget;
    expect(t.send(O.BUFFER_CREATE, [2, 1, 16, 0, 0]).status).toBe(A.E_LIMIT);
    expect(t.ctx.gpu!.buffers.has(2)).toBe(false);
  });

  it('advertises exactly the supported shader languages and preserves zero-initialized index semantics', () => {
    const t = setup();
    t.ctx.gpu = new GpuState({ languages: 1, execute: () => 0 });
    expect(t.send(O.SHADER_CREATE, [1, 1, 1, 16384, source.length, 1]).status).toBe(A.E_UNSUPPORTED);
    expect(t.ctx.gpu.shaders.size).toBe(0);
    expect(t.requests.status(1)).toBe(A.E_NOT_FOUND);
  });

  describe('§13.7 texture and sampler extensions', () => {
    const create = (h: number, dim: number, w: number, hh: number, d: number, mips: number, format: number, usage = 1) =>
      [h, dim, w, hh, d, mips, format, usage];
    it('accepts 3D / 2D-array / new-format textures, extended samplers, mip generation and read-back', () => {
      const t = setup();
      expect(t.run(new CommandEncoder()
        .gpu(O.TEXTURE_CREATE_EX, create(1, A.GPU.DIM_3D, 4, 4, 4, 3, A.GPU.FORMAT_RGBA8))
        .gpu(O.TEXTURE_CREATE_EX, create(2, A.GPU.DIM_2D_ARRAY, 8, 8, 3, 4, A.GPU.FORMAT_R16F))
        .gpu(O.TEXTURE_CREATE_EX, create(3, A.GPU.DIM_2D, 8, 8, 1, 1, A.GPU.FORMAT_RGB10A2, 3))
        .gpu(O.TEXTURE_CREATE_EX, create(4, A.GPU.DIM_2D, 2, 2, 1, 2, A.GPU.FORMAT_RGBA32F))
        .gpu(O.TEXTURE_UPDATE_EX, [1, 1, 0, 0, 1, 2, 2, 1, 16384, 16])
        .gpu(O.TEXTURE_UPDATE_EX, [2, 0, 1, 1, 2, 2, 2, 1, 16384, 8])
        .gpu(O.SAMPLER_CREATE_EX, [1, 1, 1, 2, 0, 1, 2, 0, 7, F(0.5), F(4)])
        .gpu(O.TEXTURE_GENERATE_MIPS, [1, 0]).gpu(O.TEXTURE_GENERATE_MIPS, [2, 1])).errors).toEqual([]);
      const bytes = t.ctx.gpu!.textures.get(1)!.bytes;
      expect(bytes).toBe(4 * 4 * 4 * 4 + 2 * 2 * 2 * 4 + 1 * 1 * 1 * 4); // depth halves per mip for 3D
      expect(t.ctx.gpu!.textures.get(2)!.bytes).toBe((64 + 16 + 4 + 1) * 3 * 2); // layers constant
      // Read-back reserves the request and delivers exactly once through the §12 allocator.
      const before = t.frame.items.length;
      expect(t.run(new CommandEncoder().gpu(O.TEXTURE_READBACK, [1, 1, 0, 0, 0, 2, 2, 2, 9])).errors).toEqual([]);
      const item = t.frame.items[before] as GpuItem;
      expect(item.op).toBe(O.TEXTURE_READBACK);
      item.readback!(new Uint8Array(2 * 2 * 2 * 4).fill(7));
      t.requests.advance();
      expect(t.requests.status(9)).toBe(1);
      const out = new Uint8Array(64); expect(t.requests.read(9, out)).toBe(32); expect(out[0]).toBe(7);
    });
    it.each([
      ['dimension', [1, 3, 4, 4, 1, 1, 0, 1], A.E_INVALID],
      ['2D with depth', [1, 0, 4, 4, 2, 1, 0, 1], A.E_INVALID],
      ['format', [1, 0, 4, 4, 1, 1, 13, 1], A.E_INVALID],
      ['volume edge', [1, 1, 4, 4, 257, 1, 0, 1], A.E_LIMIT],
      ['array layers', [1, 2, 4, 4, 257, 1, 0, 1], A.E_LIMIT],
      ['3D mips', [1, 1, 4, 4, 4, 4, 0, 1], A.E_INVALID],
      ['3D depth format', [1, 1, 4, 4, 4, 1, 6, 1], A.E_UNSUPPORTED],
      ['layered attachment', [1, 2, 4, 4, 2, 1, 0, 3], A.E_UNSUPPORTED],
      ['usage', [1, 0, 4, 4, 1, 1, 0, 4], A.E_INVALID],
    ])('rejects TEXTURE_CREATE_EX %s', (_name, words, error) => {
      expect(setup().send(O.TEXTURE_CREATE_EX, words as number[]).status).toBe(error);
    });
    it('rejects invalid updates, samplers, read-backs, mip generation and state', () => {
      const t = setup();
      expect(t.send(O.TEXTURE_CREATE, [5, 4, 4, 1, 0, 1]).status).toBe(0);
      expect(t.send(O.TEXTURE_CREATE, [6, 4, 4, 1, A.GPU.FORMAT_R32F, 1]).status).toBe(A.E_INVALID); // legacy op rejects
      t.send(O.TEXTURE_CREATE_EX, create(1, A.GPU.DIM_3D, 2, 2, 4, 2, 0));
      t.send(O.TEXTURE_CREATE_EX, create(2, A.GPU.DIM_2D, 4, 4, 1, 1, A.GPU.FORMAT_DEPTH32F, 2));
      expect(t.send(O.TEXTURE_UPDATE, [1, 0, 0, 0, 1, 1, 16384, 4]).status).toBe(A.E_STATE); // legacy on volume
      expect(t.send(O.TEXTURE_UPDATE_EX, [1, 0, 0, 0, 3, 2, 2, 2, 16384, 32]).status).toBe(A.E_BOUNDS);
      expect(t.send(O.TEXTURE_UPDATE_EX, [1, 0, 0, 0, 0, 2, 2, 2, 16384, 31]).status).toBe(A.E_INVALID);
      expect(t.send(O.TEXTURE_UPDATE_EX, [1, 2, 0, 0, 0, 1, 1, 1, 16384, 4]).status).toBe(A.E_INVALID);
      expect(t.send(O.TEXTURE_UPDATE_EX, [1, 1, 0, 0, 0, 1, 1, 3, 16384, 12]).status).toBe(A.E_BOUNDS); // mip 1 depth is 2
      expect(t.send(O.TEXTURE_UPDATE_EX, [2, 0, 0, 0, 0, 1, 1, 1, 16384, 4]).status).toBe(0);
      expect(t.send(O.TEXTURE_UPDATE_EX, [9, 0, 0, 0, 0, 1, 1, 1, 16384, 4]).status).toBe(A.E_NOT_FOUND);
      expect(t.send(O.SAMPLER_CREATE_EX, [1, 0, 0, 0, 0, 0, 3, 0, 7, F(0), F(1)]).status).toBe(A.E_INVALID);
      expect(t.send(O.SAMPLER_CREATE_EX, [1, 0, 0, 0, 0, 0, 0, 0, 7, F(2), F(1)]).status).toBe(A.E_INVALID);
      expect(t.send(O.SAMPLER_CREATE_EX, [1, 0, 0, 0, 0, 0, 0, 0, 7, F(NaN), F(1)]).status).toBe(A.E_INVALID);
      expect(t.send(O.SAMPLER_CREATE_EX, [1, 0, 0, 0, 0, 0, 0, 0, 7, F(-1), F(1)]).status).toBe(A.E_INVALID);
      expect(t.send(O.SAMPLER_CREATE_EX, [1, 0, 0, 0, 0, 0, 0, 0, 7, F(0), F(1001)]).status).toBe(A.E_INVALID);
      expect(t.send(O.SAMPLER_CREATE_EX, [1, 0, 0, 0, 0, 0, 0, 1, 7, F(0), F(1)]).status).toBe(0);
      expect(t.send(O.SAMPLER_CREATE_EX, [1, 0, 0, 0, 0, 0, 0, 0, 7, F(0), F(1)]).status).toBe(A.E_STATE);
      expect(t.send(O.TEXTURE_READBACK, [2, 0, 0, 0, 0, 1, 1, 1, 8]).status).toBe(0);
      expect(t.requests.close(8)).toBe(0);
      expect(t.send(O.TEXTURE_READBACK, [1, 0, 0, 0, 0, 3, 2, 1, 3]).status).toBe(A.E_BOUNDS);
      expect(t.send(O.TEXTURE_READBACK, [1, 0, 0, 0, 0, 0, 2, 1, 3]).status).toBe(A.E_INVALID);
      expect(t.send(O.TEXTURE_READBACK, [1, 0, 0, 0, 0, 2, 2, 1, 0]).status).toBe(A.E_INVALID); // request id 0
      expect(t.send(O.TEXTURE_READBACK, [1, 0, 0, 0, 0, 2, 2, 1, 3]).status).toBe(0);
      expect(t.send(O.TEXTURE_READBACK, [1, 0, 0, 0, 0, 2, 2, 1, 3]).status).toBe(A.E_STATE); // duplicate request
      expect(t.send(O.TEXTURE_GENERATE_MIPS, [1, 2]).status).toBe(A.E_INVALID);
      expect(t.send(O.TEXTURE_GENERATE_MIPS, [2, 0]).status).toBe(A.E_UNSUPPORTED);
      expect(t.send(O.TEXTURE_GENERATE_MIPS, [9, 0]).status).toBe(A.E_NOT_FOUND);
    });
    it('treats the new resource ops as outside passes and reports them E_UNSUPPORTED without a GPU', () => {
      const t = setup(); t.resources();
      for (const [op, words] of [[O.TEXTURE_CREATE_EX, create(7, 0, 4, 4, 1, 1, 0)],
        [O.TEXTURE_UPDATE_EX, [1, 0, 0, 0, 0, 1, 1, 1, 16384, 4]], [O.SAMPLER_CREATE_EX, [7, 0, 0, 0, 0, 0, 0, 0, 7, 0, F(1)]],
        [O.TEXTURE_READBACK, [1, 0, 0, 0, 0, 1, 1, 1, 7]], [O.TEXTURE_GENERATE_MIPS, [1, 0]]] as [number, number[]][]) {
        expect(t.inPass(op, words).status, String(op)).toBe(A.E_STATE);
      }
      const bare = setup(); bare.ctx.gpu = undefined;
      expect(bare.send(O.TEXTURE_GENERATE_MIPS, [1, 0]).status).toBe(A.E_UNSUPPORTED);
      // A legacy comparison sampler is still rejected on color textures after normalization.
      expect(t.send(O.TEXTURE_CREATE_EX, create(8, 0, 4, 4, 1, 1, A.GPU.FORMAT_R16F, 3)).status).toBe(0);
      expect(t.send(O.SAMPLER_CREATE, [8, 0, 0, 0, 0, 0, 1, 3]).status).toBe(0);
      expect(t.ctx.gpu!.samplers.get(8)).toEqual([8, 0, 0, 0, 0, 0, 0, 1, 3, F(0), F(1000)]);
      expect(t.inPass(O.TEXTURE, [0, 8, 8]).status).toBe(A.E_INVALID);
    });
  });
});
