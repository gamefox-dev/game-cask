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
