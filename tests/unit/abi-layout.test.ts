// The TS mirror (bgt/runtime/abi.ts) and the C header must agree exactly,
// and the C encoder (bgt_cmd.h) must produce what the TS decoder expects.
import { describe, expect, it, beforeAll } from 'vitest';
import * as A from '../../bgt/runtime/abi';
import { CommandEncoder, Frame, TextureTable, decodeCommands, defaultState, rgba } from '../../bgt/runtime/commands';
import { compileC } from '../support/compile';

let ex: Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory };
let submitted: Uint8Array | null = null;

beforeAll(async () => {
  const wasm = await compileC('tests/fixtures/c/abi_probe.c');
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(wasm), {
    bgt: {
      submit_commands: (p: number, l: number) => {
        submitted = new Uint8Array(ex.memory.buffer.slice(p, p + l));
        return 0;
      },
    },
  });
  ex = instance.exports as never;
});

describe('ABI layout', () => {
  it('bgt_io_t offsets, sizes and constants match abi.ts', () => {
    const t = new Uint32Array(ex.memory.buffer, ex.probe_table(), ex.probe_count());
    const signed = (v: number) => v | 0;
    const expected = [
      A.IO.SIZE, A.IO.TOUCH_SIZE, A.SPRITE_SIZE, A.VERTEX_SIZE,
      A.IO.abi_version, A.IO.backend, A.IO.caps, A.IO.audio_sample_rate, A.IO.seed, A.IO.display_width,
      A.IO.display_height, A.IO.arg0, A.IO.logical_width, A.IO.logical_height, A.IO.flags, A.IO.arg1,
      A.IO.frame, A.IO.buttons, A.IO.buttons_pressed, A.IO.buttons_released, A.IO.keys, A.IO.keys_pressed,
      A.IO.pointer_x, A.IO.pointer_y, A.IO.pointer_buttons, A.IO.pointer_inside, A.IO.axes, A.IO.touch_count,
      A.IO.events, A.IO.touches,
      A.ABI_VERSION, A.CMD_MAGIC, A.CMD_VERSION,
      A.OP.CLEAR, A.OP.VIEWPORT, A.OP.SCISSOR, A.OP.TRANSFORM, A.OP.BLEND, A.OP.TEXTURE,
      A.OP.TEX_CREATE, A.OP.TEX_UPDATE, A.OP.TEX_DELETE, A.OP.SPRITES, A.OP.TRIANGLES,
      A.E_INVALID, A.E_BOUNDS, A.E_LIMIT, A.E_UNSUPPORTED, A.E_NOT_FOUND, A.E_IO, A.E_STATE,
      A.LIMITS.submitBytes, A.LIMITS.commands, A.LIMITS.submitsPerFrame, A.LIMITS.verticesPerFrame,
      A.LIMITS.textures, A.LIMITS.textureDim, A.LIMITS.textureBytes, A.LIMITS.logicalDim,
      A.BUTTONS.UP, A.BUTTONS.START, A.BUTTONS.R, A.CAP_DIRECT_DRAW, A.EVENT_FOCUS_LOST, A.FLAG_INTEGER_SCALE,
      4, 29, 40, 44, 79, 82, 225, A.DT_US,
      A.OP.READBACK, A.CAP_READBACK, A.CAP_STREAM_FILES, 16, 12,
    ];
    expect([...t].map((v, i) => (expected[i] < 0 ? signed(v) : v))).toEqual(expected);
  });

  it('C encoder output is byte-identical to the TS encoder and decodes cleanly', () => {
    expect(ex.probe_encode()).toBe(0);
    const c = submitted!;
    const ts = new CommandEncoder()
      .clear(rgba(1, 2, 3, 4))
      .viewport(1, -2, 300, 200)
      .scissor(true, 4, 5, 6, 7)
      .transform(1.5, 0, 0, 2, -3, 4)
      .blend(A.BLEND_ADD)
      .texCreate(9, 4, 4)
      .texUpdate(9, 0, 0, 4, 4, 4096, 64)
      .texture(9, A.FILTER_LINEAR)
      .sprites([
        [1, 2, 3, 4, 0, 0, 1, 1, 0xffffffff],
        [5, 6, 7, 8, 0.25, 0.5, 0.75, 1, 0x80808080],
      ])
      .triangles([0, 1, 2].map((i) => [i, i * 2, 0, 1, 0xff00ff00] as [number, number, number, number, number]))
      .texDelete(9)
      .finish();
    expect(Buffer.from(c).toString('hex')).toBe(Buffer.from(ts).toString('hex'));

    const mem = new Uint8Array(8192);
    mem.set(c, 0);
    const frame = new Frame();
    frame.reset(320, 240);
    const res = decodeCommands(mem, 0, c.length, { state: defaultState(320, 240), frame, textures: new TextureTable(), linearFilter: true, triangles: true });
    expect(res.errors).toEqual([]);
    expect(res.executed).toBe(11); // the two sprites were coalesced into one SPRITES command
  });

  it('C/TS v0.3 readback encoders agree without changing the v0.2 stream layout',()=>{
    expect(ex.probe_readback()).toBe(0);
    expect(Buffer.from(submitted!)).toEqual(Buffer.from(new CommandEncoder().readback(77,9,1,2,3,4).finish()));
  });

  it('C encoder reports overflow instead of writing past its buffer', () => {
    expect(ex.probe_overflow()).toBe(A.E_LIMIT);
  });
});

// Independent C/TS layout and every C helper's byte stream, including variable tails.
describe('v0.3 GPU ABI layout', () => {
  let gpu: typeof ex;
  beforeAll(async () => {
    const wasm = await compileC('tests/fixtures/c/gpu_probe.c');
    const instance = await WebAssembly.instantiate(await WebAssembly.compile(wasm), {
      bgt: { submit_commands: (p: number, n: number) => {
        submitted = new Uint8Array(gpu.memory.buffer.slice(p, p + n)); return 0;
      } },
    });
    gpu = instance.exports as never;
  });
  it('every GPU struct size/member offset, enum, opcode and extended limits agree', () => {
    const actual = new Uint32Array(gpu.memory.buffer, gpu.gpu_layout(), gpu.gpu_layout_count());
    expect([...actual]).toEqual([
      A.GPU_LIMITS.handles, A.GPU_LIMITS.budget, A.GPU_LIMITS.bufferSize, A.GPU_LIMITS.textureDimension,
      A.GPU_LIMITS.vertexBuffers, A.GPU_LIMITS.attributes, A.GPU_LIMITS.slots, A.GPU_LIMITS.colorAttachments,
      A.GPU_LIMITS.uniformAlignment, A.GPU_LIMITS.uniformRange, A.GPU_LIMITS.stride, A.GPU_LIMITS.shaderBytes,
      A.GPU_LIMITS_SIZE, A.CAP_GPU, A.GPU_LIMITS_SIZE, ...Object.values(A.GPU_LIMITS_OFFSETS),
      A.GPU_LAYOUT.buffer_create, 0, 4, 8, 12, 16, A.GPU_LAYOUT.buffer_update, 0, 4,
      8, 12, A.GPU_LAYOUT.buffer_delete, 0, A.GPU_LAYOUT.texture_create, 0, 4, 8, 12, 16, 20,
      A.GPU_LAYOUT.texture_update, 0, 4, 8, 12, 16, 20, 24, 28, A.GPU_LAYOUT.texture_delete, 0,
      A.GPU_LAYOUT.sampler_create, 0, 4, 8, 12, 16, 20, 24, 28, A.GPU_LAYOUT.sampler_delete, 0,
      A.GPU_LAYOUT.shader_create, 0, 4, 8, 12, 16, 20, A.GPU_LAYOUT.shader_delete, 0,
      A.GPU_LAYOUT.pipeline_delete, 0, A.GPU_LAYOUT.pipeline, 0, A.GPU_LAYOUT.viewport, 0, 4, 8, 12, 16, 20,
      A.GPU_LAYOUT.scissor, 0, 4, 8, 12, A.GPU_LAYOUT.stencil_ref, 0, A.GPU_LAYOUT.blend_constant, 0, 4, 8, 12,
      A.GPU_LAYOUT.vertex_buffer, 0, 4, 8, 12, A.GPU_LAYOUT.index_buffer, 0, 4, 8, 12,
      A.GPU_LAYOUT.uniform_buffer, 0, 4, 8, 12, A.GPU_LAYOUT.texture, 0, 4, 8, A.GPU_LAYOUT.draw, 0, 4, 8, 12,
      A.GPU_LAYOUT.draw_indexed, 0, 4, 8, 12, 16, A.GPU_LAYOUT.pipeline_create, 0, 4, 8, 12, 16, 20, 24, 28, 32,
      36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100, A.GPU_LAYOUT.vertex_layout, 0, 4,
      A.GPU_LAYOUT.attribute, 0, 4, 8, 12, A.GPU_LAYOUT.color_target, 0, 4, 8, 12, 16, 20, 24, 28, 32,
      A.GPU_LAYOUT.pass_begin, 0, 4, 8, 12, 16, 20, 24, A.GPU_LAYOUT.color_attachment, 0, 4, 8, 12, 16, 20, 24,
      A.GPU_LAYOUT.texture_create_ex, 0, 4, 8, 12, 16, 20, 24, 28,
      A.GPU_LAYOUT.texture_update_ex, 0, 4, 8, 12, 16, 20, 24, 28, 32, 36,
      A.GPU_LAYOUT.sampler_create_ex, 0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40,
      A.GPU_LAYOUT.texture_readback, 0, 4, 8, 12, 16, 20, 24, 28, 32,
      A.GPU_LAYOUT.texture_generate_mips, 0, 4,
      A.GPU.BUFFER_VERTEX, A.GPU.BUFFER_INDEX, A.GPU.BUFFER_UNIFORM, A.GPU.TEXTURE_SAMPLED,
      A.GPU.TEXTURE_ATTACHMENT, A.GPU.FORMAT_RGBA8, A.GPU.FORMAT_RGBA8_SRGB, A.GPU.FORMAT_R8, A.GPU.FORMAT_RG8,
      A.GPU.FORMAT_RGBA16F, A.GPU.FORMAT_DEPTH24_STENCIL8, A.GPU.FORMAT_DEPTH32F,
      A.GPU.FORMAT_RGB10A2, A.GPU.FORMAT_R16F, A.GPU.FORMAT_RG16F, A.GPU.FORMAT_R32F, A.GPU.FORMAT_RG32F,
      A.GPU.FORMAT_RGBA32F, A.GPU.DIM_2D, A.GPU.DIM_3D, A.GPU.DIM_2D_ARRAY, A.GPU_LIMITS.volumeDimension,
      A.GPU_LIMITS.arrayLayers, A.GPU.FORMAT_NONE,
      A.GPU.FILTER_NEAREST, A.GPU.FILTER_LINEAR, A.GPU.MIP_NONE, A.GPU.MIP_NEAREST, A.GPU.MIP_LINEAR,
      A.GPU.WRAP_CLAMP, A.GPU.WRAP_REPEAT, A.GPU.WRAP_MIRROR, A.GPU.COMPARE_NEVER, A.GPU.COMPARE_LESS,
      A.GPU.COMPARE_EQUAL, A.GPU.COMPARE_LEQUAL, A.GPU.COMPARE_GREATER, A.GPU.COMPARE_NOT_EQUAL,
      A.GPU.COMPARE_GEQUAL, A.GPU.COMPARE_ALWAYS, A.GPU.STENCIL_KEEP, A.GPU.STENCIL_ZERO, A.GPU.STENCIL_REPLACE,
      A.GPU.STENCIL_INCREMENT_CLAMP, A.GPU.STENCIL_DECREMENT_CLAMP, A.GPU.STENCIL_INVERT,
      A.GPU.STENCIL_INCREMENT_WRAP, A.GPU.STENCIL_DECREMENT_WRAP, A.GPU.STAGE_VERTEX, A.GPU.STAGE_FRAGMENT,
      A.GPU.STAGE_COMBINED, A.GPU.LANG_WGSL, A.GPU.LANG_GLSL330, A.GPU.LANG_GLSLES300, A.GPU.TOPOLOGY_POINTS,
      A.GPU.TOPOLOGY_LINES, A.GPU.TOPOLOGY_LINE_STRIP, A.GPU.TOPOLOGY_TRIANGLES, A.GPU.TOPOLOGY_TRIANGLE_STRIP,
      A.GPU.CULL_NONE, A.GPU.CULL_FRONT, A.GPU.CULL_BACK, A.GPU.FRONT_CCW, A.GPU.FRONT_CW, A.GPU.BLEND_ZERO,
      A.GPU.BLEND_ONE, A.GPU.BLEND_SRC_COLOR, A.GPU.BLEND_ONE_MINUS_SRC_COLOR, A.GPU.BLEND_DST_COLOR,
      A.GPU.BLEND_ONE_MINUS_DST_COLOR, A.GPU.BLEND_SRC_ALPHA, A.GPU.BLEND_ONE_MINUS_SRC_ALPHA,
      A.GPU.BLEND_DST_ALPHA, A.GPU.BLEND_ONE_MINUS_DST_ALPHA, A.GPU.BLEND_CONSTANT,
      A.GPU.BLEND_ONE_MINUS_CONSTANT, A.GPU.BLEND_ADD, A.GPU.BLEND_SUBTRACT, A.GPU.BLEND_REVERSE_SUBTRACT,
      A.GPU.BLEND_MIN, A.GPU.BLEND_MAX, A.GPU.VERTEX_FLOAT, A.GPU.VERTEX_FLOAT2, A.GPU.VERTEX_FLOAT3,
      A.GPU.VERTEX_FLOAT4, A.GPU.VERTEX_UNORM8X4, A.GPU.VERTEX_SINT, A.GPU.VERTEX_SINT2, A.GPU.VERTEX_SINT3,
      A.GPU.VERTEX_SINT4, A.GPU.VERTEX_UINT, A.GPU.VERTEX_UINT2, A.GPU.VERTEX_UINT3, A.GPU.VERTEX_UINT4,
      A.GPU.STEP_VERTEX, A.GPU.STEP_INSTANCE, A.GPU.INDEX_UINT16, A.GPU.INDEX_UINT32, A.GPU.LOAD_LOAD,
      A.GPU.LOAD_CLEAR, A.GPU_OP.BUFFER_CREATE, A.GPU_OP.BUFFER_UPDATE, A.GPU_OP.BUFFER_DELETE,
      A.GPU_OP.TEXTURE_CREATE, A.GPU_OP.TEXTURE_UPDATE, A.GPU_OP.TEXTURE_DELETE, A.GPU_OP.SAMPLER_CREATE,
      A.GPU_OP.SAMPLER_DELETE, A.GPU_OP.SHADER_CREATE, A.GPU_OP.SHADER_DELETE, A.GPU_OP.PIPELINE_CREATE,
      A.GPU_OP.PIPELINE_DELETE, A.GPU_OP.PASS_BEGIN, A.GPU_OP.PASS_END, A.GPU_OP.PIPELINE, A.GPU_OP.VIEWPORT,
      A.GPU_OP.SCISSOR, A.GPU_OP.STENCIL_REF, A.GPU_OP.BLEND_CONSTANT, A.GPU_OP.VERTEX_BUFFER,
      A.GPU_OP.INDEX_BUFFER, A.GPU_OP.UNIFORM_BUFFER, A.GPU_OP.TEXTURE, A.GPU_OP.DRAW, A.GPU_OP.DRAW_INDEXED,
      A.GPU_OP.TEXTURE_CREATE_EX, A.GPU_OP.TEXTURE_UPDATE_EX, A.GPU_OP.SAMPLER_CREATE_EX,
      A.GPU_OP.TEXTURE_READBACK, A.GPU_OP.TEXTURE_GENERATE_MIPS,
    ]);
  });
  it('all 30 C GPU encoders exactly match the TS wire-word encoder', () => {
    expect(gpu.gpu_encode()).toBe(0);
    const expected = new CommandEncoder()
      .gpu(A.GPU_OP.BUFFER_CREATE, [1,2,3,4,5])
      .gpu(A.GPU_OP.BUFFER_UPDATE, [1,2,3,4])
      .gpu(A.GPU_OP.BUFFER_DELETE, [1])
      .gpu(A.GPU_OP.TEXTURE_CREATE, [1,2,3,4,5,6])
      .gpu(A.GPU_OP.TEXTURE_UPDATE, [1,2,3,4,5,6,7,8])
      .gpu(A.GPU_OP.TEXTURE_DELETE, [1])
      .gpu(A.GPU_OP.SAMPLER_CREATE, [1,2,3,4,5,6,7,8])
      .gpu(A.GPU_OP.SAMPLER_DELETE, [1])
      .gpu(A.GPU_OP.SHADER_CREATE, [1,2,3,4,5,6])
      .gpu(A.GPU_OP.SHADER_DELETE, [1])
      .gpu(A.GPU_OP.PIPELINE_CREATE, [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,1,1,1,
        16,0,0,0,0,3,0,1,1,0,0,1,0,0,15])
      .gpu(A.GPU_OP.PIPELINE_DELETE, [1])
      .gpu(A.GPU_OP.PASS_BEGIN, [1,2,3,4,5,6,7,0,0,0,0,0,0,0])
      .gpu(A.GPU_OP.PASS_END, [])
      .gpu(A.GPU_OP.PIPELINE, [1])
      .gpu(A.GPU_OP.VIEWPORT, [1,2,3,4,5,6])
      .gpu(A.GPU_OP.SCISSOR, [1,2,3,4])
      .gpu(A.GPU_OP.STENCIL_REF, [1])
      .gpu(A.GPU_OP.BLEND_CONSTANT, [1,2,3,4])
      .gpu(A.GPU_OP.VERTEX_BUFFER, [1,2,3,4])
      .gpu(A.GPU_OP.INDEX_BUFFER, [1,2,3,4])
      .gpu(A.GPU_OP.UNIFORM_BUFFER, [1,2,3,4])
      .gpu(A.GPU_OP.TEXTURE, [1,2,3])
      .gpu(A.GPU_OP.DRAW, [1,2,3,4])
      .gpu(A.GPU_OP.DRAW_INDEXED, [1,2,3,4,5])
      .gpu(A.GPU_OP.TEXTURE_CREATE_EX, [1,2,3,4,5,6,7,8])
      .gpu(A.GPU_OP.TEXTURE_UPDATE_EX, [1,2,3,4,5,6,7,8,9,10])
      .gpu(A.GPU_OP.SAMPLER_CREATE_EX, [1,2,3,4,5,6,7,8,9,10,11])
      .gpu(A.GPU_OP.TEXTURE_READBACK, [1,2,3,4,5,6,7,8,9])
      .gpu(A.GPU_OP.TEXTURE_GENERATE_MIPS, [1,2])
      .finish();
    expect(submitted).toEqual(expected);
  });
});
