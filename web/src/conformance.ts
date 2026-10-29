// Visual conformance scene: one canonical command stream covering the v0.1
// 2D feature set, rendered by the selected backend and read back. The e2e
// suite checks pixel probes on each backend and compares backends to each
// other. ?backend=webgpu|webgl2
import {
  BLEND_ADD,
  BLEND_ALPHA,
  BLEND_OPAQUE,
  BLEND_PREMULTIPLIED,
  FILTER_LINEAR,
  FILTER_NEAREST,
} from '../../bgt/runtime/abi';
import { CommandEncoder, DecodeContext, Frame, TextureTable, decodeCommands, defaultState, rgba } from '../../bgt/runtime/commands';
import { WebGL2Renderer } from '../../bgt/renderers/webgl2/webgl2';
import { WebGPURenderer } from '../../bgt/renderers/webgpu/webgpu';
import { computeLetterbox, Renderer } from '../../bgt/renderers/types';

export interface Probe {
  name: string;
  x: number; // logical
  y: number;
  expect: [number, number, number];
  tol: number;
}

const L = 128; // logical size
const SCALE = 2;

export function buildScene(): { bytes: Uint8Array; texData: Uint8Array; probes: Probe[] } {
  // Texture data lives in a side buffer that we pass as "linear memory";
  // command pointers are offsets into it, exactly like a wasm game.
  const tex = new Uint8Array(4096);
  // tex1: 4x4 checkerboard, 1-texel cells, (0,0) black
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const v = (x + y) % 2 ? 255 : 0;
      tex.set([v, v, v, 255], 1024 + (y * 4 + x) * 4);
    }
  // tex2: 2x1 black, white
  tex.set([0, 0, 0, 255, 255, 255, 255, 255], 1152);
  // red texel for partial update
  tex.set([255, 0, 0, 255], 1168);

  const e = new CommandEncoder()
    .clear(rgba(20, 20, 20))
    .blend(BLEND_ALPHA)
    .rect(0, 0, 32, 32, rgba(255, 0, 0))
    .rect(32, 0, 32, 32, rgba(0, 255, 0))
    .rect(64, 0, 32, 32, rgba(0, 0, 255))
    .rect(96, 0, 32, 32, rgba(0, 0, 255))
    .rect(96, 0, 32, 32, rgba(255, 0, 0, 128))
    .rect(0, 32, 32, 32, rgba(100, 100, 100))
    .blend(BLEND_ADD)
    .rect(0, 32, 32, 32, rgba(100, 50, 0, 255))
    .blend(BLEND_ALPHA)
    .rect(32, 32, 32, 32, rgba(255, 255, 255))
    .blend(BLEND_PREMULTIPLIED)
    .rect(32, 32, 32, 32, rgba(0, 0, 128, 128))
    .blend(BLEND_OPAQUE)
    .rect(64, 32, 32, 32, rgba(255, 255, 0, 0))
    .blend(BLEND_ALPHA)
    .scissor(true, 96, 32, 16, 32)
    .rect(96, 32, 32, 32, rgba(255, 0, 255))
    .scissor(false)
    .viewport(0, 64, 64, 32)
    .rect(0, 0, 16, 16, rgba(0, 255, 255))
    .rect(56, 0, 40, 8, rgba(255, 255, 255))
    .viewport(0, 0, L, L)
    .texCreate(1, 4, 4)
    .texUpdate(1, 0, 0, 4, 4, 1024, 64)
    .texture(1, FILTER_NEAREST)
    .rect(64, 64, 32, 32, rgba(255, 255, 255))
    .texCreate(2, 2, 1)
    .texUpdate(2, 0, 0, 2, 1, 1152, 8)
    .texture(2, FILTER_LINEAR)
    .rect(96, 64, 32, 8, rgba(255, 255, 255))
    .texture(0, FILTER_NEAREST)
    .transform(0, 1, -1, 0, 20, 96)
    .rect(0, 0, 16, 4, rgba(255, 128, 0))
    .transform(1, 0, 0, 1, 0, 0)
    .triangles([
      [32, 96, 0, 0, rgba(128, 255, 0)],
      [64, 96, 0, 0, rgba(128, 255, 0)],
      [32, 128, 0, 0, rgba(128, 255, 0)],
    ])
    .texUpdate(1, 0, 0, 1, 1, 1168, 4)
    .texture(1, FILTER_NEAREST)
    .rect(96, 96, 32, 32, rgba(255, 255, 255))
    .texture(2, FILTER_NEAREST)
    .texDelete(2) // deleting the bound texture rebinds built-in white (handle 0)
    .rect(64, 96, 16, 16, rgba(128, 128, 128));

  const probes: Probe[] = [
    { name: 'clear', x: 120, y: 40, expect: [20, 20, 20], tol: 2 },
    { name: 'rect red', x: 16, y: 16, expect: [255, 0, 0], tol: 2 },
    { name: 'rect green', x: 48, y: 16, expect: [0, 255, 0], tol: 2 },
    { name: 'rect blue', x: 80, y: 16, expect: [0, 0, 255], tol: 2 },
    { name: 'alpha blend', x: 112, y: 16, expect: [128, 0, 127], tol: 3 },
    { name: 'additive blend', x: 16, y: 48, expect: [200, 150, 100], tol: 3 },
    { name: 'premultiplied blend', x: 48, y: 48, expect: [127, 127, 255], tol: 3 },
    { name: 'opaque ignores alpha', x: 80, y: 48, expect: [255, 255, 0], tol: 2 },
    { name: 'scissor inside', x: 100, y: 48, expect: [255, 0, 255], tol: 2 },
    { name: 'scissor outside', x: 120, y: 56, expect: [20, 20, 20], tol: 2 },
    { name: 'viewport offset', x: 8, y: 72, expect: [0, 255, 255], tol: 2 },
    { name: 'viewport clip inside', x: 60, y: 68, expect: [255, 255, 255], tol: 2 },
    { name: 'viewport clip outside', x: 68, y: 68, expect: [0, 0, 0], tol: 2 },
    { name: 'nearest texel (0,0) black', x: 68, y: 68, expect: [0, 0, 0], tol: 2 },
    { name: 'nearest texel (1,0) white', x: 76, y: 68, expect: [255, 255, 255], tol: 2 },
    { name: 'nearest texel (1,1) black', x: 76, y: 76, expect: [0, 0, 0], tol: 2 },
    { name: 'linear filter midpoint', x: 112, y: 68, expect: [128, 128, 128], tol: 24 },
    { name: 'linear filter left edge', x: 97, y: 68, expect: [0, 0, 0], tol: 24 },
    { name: 'transform rotate', x: 18, y: 104, expect: [255, 128, 0], tol: 2 },
    { name: 'transform outside', x: 10, y: 99, expect: [20, 20, 20], tol: 2 },
    { name: 'triangle inside', x: 36, y: 100, expect: [128, 255, 0], tol: 2 },
    { name: 'triangle outside', x: 60, y: 124, expect: [20, 20, 20], tol: 2 },
    { name: 'partial update applied later', x: 100, y: 100, expect: [255, 0, 0], tol: 2 },
    { name: 'partial update keeps rest', x: 108, y: 100, expect: [255, 255, 255], tol: 2 },
    { name: 'texture 0 after delete', x: 72, y: 104, expect: [128, 128, 128], tol: 2 },
  ];
  // The 'viewport clip outside' and 'nearest texel (0,0)' probes overlap by
  // design: the texture rect is drawn after the viewport rect.
  return { bytes: e.finish(), texData: tex, probes };
}

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const want = q.get('backend') ?? 'webgl2';
  const canvas = document.createElement('canvas');
  canvas.width = L * SCALE;
  canvas.height = L * SCALE;
  canvas.style.width = `${L * SCALE}px`;
  canvas.style.height = `${L * SCALE}px`;
  document.getElementById('app')!.append(canvas);
  const out = window as unknown as { __CONF__: unknown };
  try {
    let r: Renderer | null = null;
    if (want === 'webgpu') r = await WebGPURenderer.create(canvas, { debug: true });
    else r = WebGL2Renderer.create(canvas, { debug: true });
    if (!r) {
      out.__CONF__ = { done: true, backend: want, unavailable: true };
      return;
    }
    const errors: string[] = [];
    r.onError((m) => errors.push(m));
    const { bytes, texData, probes } = buildScene();
    const mem = new Uint8Array(bytes.length + texData.length);
    mem.set(texData, 0);
    mem.set(bytes, texData.length); // texData offsets stay valid; commands at the end
    const frame = new Frame();
    frame.reset(L, L);
    const ctx: DecodeContext = { state: defaultState(L, L), frame, textures: new TextureTable(), linearFilter: true, triangles: true };
    const res = decodeCommands(mem, texData.length, bytes.length, ctx);
    const lb = computeLetterbox(canvas.width, canvas.height, L, L, true);
    const px = await r.drawFrame(frame, lb, true);
    await r.finish();
    let s = '';
    for (let i = 0; i < px!.data.length; i += 0x8000) s += String.fromCharCode(...px!.data.subarray(i, i + 0x8000));
    out.__CONF__ = {
      done: true,
      backend: r.kind,
      decode: res,
      width: px!.width,
      height: px!.height,
      scale: SCALE,
      base64: btoa(s),
      probes,
      drawCalls: r.stats.drawCalls,
      passes: r.stats.passes,
      errors,
    };
  } catch (e) {
    out.__CONF__ = { done: true, backend: want, error: (e as Error).message };
  }
}

void main();
