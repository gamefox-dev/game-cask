import { WebGL2Gpu } from '../../bgt/renderers/webgl2/gpu';
import { GPU_OP as OP } from '../../bgt/runtime/abi';
import type { GpuItem } from '../../bgt/renderers/types';

// Isolated real browser context loss; shader completion and queued resource replay during the lost interval.
export async function lossProbe() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })!;
  const errors: string[] = [], gpu = new WebGL2Gpu(gl, m => errors.push(m));
  const op = (op: number, words: number[] = [], data?: Uint8Array) => {
    const code = gpu.execute({ kind: 'gpu', op, words, data } as GpuItem);
    if (code) throw new Error(errors.join('\n') || `GPU ${op} returned ${code}`);
  };
  const shader = (h: number, stage: number, source: string) => {
    let status = -99;
    gpu.execute({ kind: 'gpu', op: OP.SHADER_CREATE, words: [h, stage, 1, 0, source.length, h], source,
      complete: code => { status = code; } });
    if (status) throw new Error(`Compile ${status}`);
  };
  const vs = '#version 330 core\nvoid main(){vec2 p[3]=vec2[3](vec2(-1,1),vec2(-1,-3),vec2(3,1));'+
    'gl_Position=vec4(p[bgt_vertex_index],.5,1);}';
  shader(1, 1, vs);
  shader(2, 2, '#version 330 core\nlayout(std140) uniform bgt_u0{vec4 color;};'+
    'layout(location=0) out vec4 o;void main(){o=color;}');
  op(OP.BUFFER_CREATE, [1, 4, 16, 0, 0]);
  op(OP.BUFFER_UPDATE, [1, 0, 0, 16], new Uint8Array(new Float32Array([0, 1, 0, 1]).buffer));
  const pipe = [1, 1, 2, 3, 0, 0, 0xffffffff, 0, 0, 7, 0, 255, 255,
    7, 0, 0, 0, 7, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 15];
  op(OP.PIPELINE_CREATE, pipe);
  const ext = gl.getExtension('WEBGL_lose_context')!;
  const lost = new Promise<void>(resolve => canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); resolve();
  }, { once: true }));
  ext.loseContext(); await lost;
  let calls = 0, status = 0, log = '';
  gpu.execute({ kind: 'gpu', op: OP.SHADER_CREATE, words: [3, 1, 1, 0, vs.length, 3], source: vs,
    complete: (code, text) => { calls++; status = code; log = text ?? ''; } });
  let failedCalls = 0;
  gpu.execute({ kind: 'gpu', op: OP.SHADER_CREATE, words: [4, 1, 1, 0, 12, 4], source: 'invalid GLSL',
    complete: () => { failedCalls++; } });
  gpu.execute({ kind: 'gpu', op: OP.SHADER_DELETE, words: [4] });
  const update = gpu.execute({ kind: 'gpu', op: OP.BUFFER_UPDATE, words: [1, 0, 0, 16],
    data: new Uint8Array(new Float32Array([1, 0, 0, 1]).buffer) });
  const restored = new Promise<void>(resolve => canvas.addEventListener('webglcontextrestored', () => resolve(),
    { once: true }));
  await new Promise(resolve => setTimeout(resolve, 50)); ext.restoreContext(); await restored;
  gpu.restore();
  gpu.beginFrame(4, 4, { x: 0, y: 0, w: 4, h: 4, scale: 1 });
  op(OP.PASS_BEGIN, [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
  op(OP.PIPELINE, [1]); op(OP.UNIFORM_BUFFER, [0, 1, 0, 16]); op(OP.DRAW, [3, 1, 0, 0]); op(OP.PASS_END);
  const pixel = new Uint8Array(4); gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  ext.loseContext();
  return { calls, failedCalls, status, log, update, errors, pixel: [...pixel] };
}
