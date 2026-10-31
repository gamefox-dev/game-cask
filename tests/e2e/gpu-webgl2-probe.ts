// Browser-side §13 backend probes. Native scenes cover the ABI; these isolate driver edge cases.
import { WebGL2Gpu } from '../../bgt/renderers/webgl2/gpu';
import { GPU_OP as OP } from '../../bgt/runtime/abi';
import type { GpuItem } from '../../bgt/renderers/types';

const bits = (n: number) => new Uint32Array(new Float32Array([n]).buffer)[0];
const version = '#version 330 core\n';
const vertex = version + `void main() {
  vec2 p[3]=vec2[3](vec2(-1,1),vec2(-1,-3),vec2(3,1));
  gl_Position=vec4(p[bgt_vertex_index],.5,1);
}`;
const fragment = version + 'layout(location=0) out vec4 o;void main(){o=vec4(.25,.5,.75,1);}';

class Probe {
  readonly canvas = document.createElement('canvas');
  readonly gl: WebGL2RenderingContext;
  readonly errors: string[] = [];
  readonly gpu: WebGL2Gpu;
  constructor() {
    this.canvas.width = this.canvas.height = 8;
    this.gl = this.canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })!;
    this.gpu = new WebGL2Gpu(this.gl, m => this.errors.push(m));
    this.gpu.beginFrame(8, 8, { x: 0, y: 0, w: 8, h: 8, scale: 1 });
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    if (this.gpu.languages !== 6) throw new Error('Conformance requires complete WebGL2 GPU features');
  }
  op(op: number, words: number[] = [], data?: Uint8Array): void {
    const code = this.gpu.execute({ kind: 'gpu', op, words, data } as GpuItem);
    if (code) throw new Error(this.errors.join('\n') || `GPU op ${op} returned ${code}`);
  }
  compile(h: number, stage: number, source: string): { code: number; log: string; calls: number } {
    const result = { code: -999, log: '', calls: 0 };
    this.gpu.execute({ kind: 'gpu', op: OP.SHADER_CREATE, words: [h, stage, 1, 0, source.length, h], source,
      complete: (code, log = '') => { result.code = code; result.log = log; result.calls++; } });
    return result;
  }
  shader(h: number, stage: number, source: string): void {
    const r = this.compile(h, stage, source);
    if (r.code || r.calls !== 1) throw new Error(`Shader ${h}: ${r.log}`);
  }
  pipeline(h: number, vs = 1, fs = 2, colors = [0], mask = 0): number[] {
    const words = [h, vs, fs, 3, 0, 0, 0xffffffff, 0, 0, 7, 0, 255, 255,
      7, 0, 0, 0, 7, 0, 0, 0, 0, mask, 0, 0, colors.length];
    for (const f of colors) words.push(f, 0, 1, 0, 0, 1, 0, 0, 15);
    return words;
  }
  begin(colors = [0], depth = 0, clear = [0, 0, 0, 0], clearDepth = 1): void {
    const words = [colors.length, depth, 0, depth ? 1 : 0, 0, bits(clearDepth), 0];
    for (const h of colors) words.push(h, 0, 1, ...clear.map(bits));
    this.op(OP.PASS_BEGIN, words);
  }
  draw(pipeline = 1): void {
    this.op(OP.PIPELINE, [pipeline]); this.op(OP.DRAW, [3, 1, 0, 0]); this.op(OP.PASS_END);
  }
  pixel(): number[] {
    const raw = new Uint8Array(4);
    this.gl.readPixels(3, 3, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, raw);
    if (this.gl.getError()) throw new Error('Read failed');
    return [...raw];
  }
  sample(texture: number, pipeline = 2, sampler = 1): number[] {
    this.begin(); this.op(OP.TEXTURE, [0, texture, sampler]); this.draw(pipeline); return this.pixel();
  }
  dispose(): void { this.gl.getExtension('WEBGL_lose_context')!.loseContext(); }
}

export function formatsProbe(): Record<string, number[]> {
  const p = new Probe(), out: Record<string, number[]> = {};
  try {
    p.shader(1, 1, vertex); p.shader(2, 2, fragment);
    p.shader(3, 2, version + 'uniform sampler2D bgt_t0;layout(location=0) out vec4 o;' +
      'void main(){o=textureLod(bgt_t0,vec2(.25,.25),0.);}');
    p.op(OP.SAMPLER_CREATE, [1, 0, 0, 0, 0, 0, 0, 7]);
    p.op(OP.PIPELINE_CREATE, p.pipeline(2, 1, 3, [0], 1));
    const uploads = [new Uint8Array([128, 64, 255, 255]), new Uint8Array([128, 64, 255, 255]),
      new Uint8Array([128]), new Uint8Array([128, 64]),
      new Uint8Array(new Uint16Array([0x3800, 0x3400, 0x3c00, 0x3c00]).buffer)];
    for (let format = 0; format < 5; format++) {
      p.op(OP.TEXTURE_CREATE, [10, 1, 1, 1, format, 3]);
      out[`zero${format}`] = p.sample(10);
      p.op(OP.TEXTURE_UPDATE, [10, 0, 0, 0, 1, 1, 0, uploads[format].length], uploads[format]);
      out[`upload${format}`] = p.sample(10);
      p.op(OP.PIPELINE_CREATE, p.pipeline(1, 1, 2, [format]));
      p.begin([10]); p.draw(); out[`render${format}`] = p.sample(10);
      p.op(OP.PIPELINE_DELETE, [1]); p.op(OP.TEXTURE_DELETE, [10]);
    }
    // Uploads, attachment storage and sampling must share the top-left convention.
    p.op(OP.TEXTURE_CREATE, [10, 2, 2, 1, 0, 3]);
    p.op(OP.TEXTURE_UPDATE, [10, 0, 0, 0, 2, 2, 0, 16],
      new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]));
    out.topLeft = p.sample(10);
    p.shader(4, 2, version + 'uniform sampler2D bgt_t0;layout(location=0) out vec4 o;' +
      'void main(){o=texture(bgt_t0,vec2(.25,.75));}');
    p.op(OP.PIPELINE_CREATE, p.pipeline(3, 1, 4, [0], 1)); out.bottomLeft = p.sample(10, 3);
    // Each MRT target has independent blending and write masks, not global state.
    p.shader(5, 2, version + 'layout(location=0) out vec4 a;layout(location=1) out vec4 b;' +
      'void main(){a=vec4(1,0,0,.5);b=vec4(.25,0,0,0);}');
    p.op(OP.TEXTURE_CREATE, [11, 2, 2, 1, 0, 3]);
    const mrt = p.pipeline(4, 1, 5, [0, 0]);
    mrt.splice(26, 9, 0, 1, 6, 7, 0, 1, 7, 0, 15); mrt[43] = 1;
    p.op(OP.PIPELINE_CREATE, mrt); p.begin([10, 11], 0, [0, 0, 1, 1]); p.draw(4);
    out.blended = p.sample(10); out.masked = p.sample(11);
    const constant = p.pipeline(5); constant.splice(26, 9, 0, 1, 10, 0, 0, 10, 0, 0, 15);
    p.op(OP.PIPELINE_CREATE, constant); p.begin(); p.op(OP.BLEND_CONSTANT, [.2, .4, .6, .5].map(bits));
    p.draw(5); out.constant = p.pixel();
    return out;
  } finally { p.dispose(); }
}

export function depthProbe(): Record<string, number[]> {
  const p = new Probe(), out: Record<string, number[]> = {};
  try {
    p.shader(1, 1, vertex);
    p.shader(2, 2, version + 'uniform sampler2D bgt_t0;layout(location=0) out vec4 o;' +
      'void main(){o=vec4(texture(bgt_t0,vec2(.5)).r,0,0,1);}');
    p.shader(3, 2, version + 'uniform sampler2DShadow bgt_t0;layout(location=0) out vec4 o;' +
      'void main(){o=vec4(texture(bgt_t0,vec3(.5,.5,.2)),0,0,1);}');
    p.op(OP.PIPELINE_CREATE, p.pipeline(1, 1, 2, [0], 1));
    p.op(OP.PIPELINE_CREATE, p.pipeline(2, 1, 3, [0], 1));
    p.op(OP.SAMPLER_CREATE, [1, 0, 0, 0, 0, 0, 0, 7]);
    p.op(OP.SAMPLER_CREATE, [2, 0, 0, 0, 0, 0, 1, 1]);
    for (const format of [5, 6]) {
      p.op(OP.TEXTURE_CREATE, [10, 2, 2, 1, format, 3]);
      out[`initial${format}`] = p.sample(10, 1);
      p.begin([], 10, [], .25); p.op(OP.PASS_END);
      out[`depth${format}`] = p.sample(10, 1); out[`compare${format}`] = p.sample(10, 2, 2);
      p.op(OP.TEXTURE_DELETE, [10]);
    }
    return out;
  } finally { p.dispose(); }
}

export function reflectionProbe(): { invalid: { code: number; log: string; calls: number }[]; errors: string[] } {
  const p = new Probe();
  try {
    const bad = ['#version 300 es\nvoid main(){}', version + 'in vec2 pos;void main(){}',
      version + 'layout(location=0) in vec2 p;in vec2 missing;void main(){}',
      version + 'uniform float a,b;void main(){}', version + 'uniform sampler2D wrong;void main(){}',
      version + 'layout(std430) uniform bgt_u0{vec4 p;};void main(){}',
      version + 'void main(){gl_Position=vec4(gl_VertexID);}',
      version + 'void main(){gl_Position=vec4(bgt_internal_vertex);}', version + 'void main(){bad syntax;}'];
    const invalid = bad.map((source, i) => p.compile(10+i, 1, source));
    p.shader(1, 1, vertex);
    p.shader(2, 2, version + 'uniform sampler2D bgt_t0;layout(location=0) out vec4 o;' +
      'void main(){o=texture(bgt_t0,vec2(.5));}');
    p.gpu.execute({ kind: 'gpu', op: OP.PIPELINE_CREATE, words: p.pipeline(1) });
    p.shader(3, 1, version + 'layout(location=0) in ivec2 pos;void main(){gl_Position=vec4(pos,0,1);}');
    p.shader(4, 2, fragment);
    const input = p.pipeline(2, 3, 4); input[23] = input[24] = 1;
    input.splice(26, 0, 8, 0, 0, 0, 0, 1); // FLOAT2 layout versus ivec2 shader
    p.gpu.execute({ kind: 'gpu', op: OP.PIPELINE_CREATE, words: input });
    invalid.push(p.compile(5, 2, version+'layout(location=1+0) out vec4 o;void main(){o=vec4(1);}'));
    for (const [i, declaration, write] of [
      [6, 'layout(location=0) out vec4 o[2];', 'o[0]=vec4(1);o[1]=vec4(1);'],
      [7, 'layout(location=0) out vec4 a;layout(location=1) out vec4 b;', 'a=vec4(1);b=vec4(1);'],
    ] as const) {
      p.shader(i, 2, version+declaration+'void main(){'+write+'}');
      p.gpu.execute({ kind: 'gpu', op: OP.PIPELINE_CREATE, words: p.pipeline(i, 1, i) });
    }
    return { invalid, errors: p.errors };
  } finally { p.dispose(); }
}

export function viewportProbe(): number[][] {
  const p = new Probe();
  try {
    p.shader(1, 1, vertex); p.shader(2, 2, fragment);
    p.op(OP.PIPELINE_CREATE, p.pipeline(1));
    p.begin(); p.op(OP.VIEWPORT, [bits(.75), bits(1.75), bits(5.5), bits(4.5), 0, bits(1)]); p.draw();
    const at = (x: number, topY: number) => {
      const raw = new Uint8Array(4); p.gl.readPixels(x, 7-topY, 1, 1, p.gl.RGBA, p.gl.UNSIGNED_BYTE, raw);
      return [...raw];
    };
    const coverage = [at(0, 2), at(1, 1), at(1, 2), at(5, 5), at(6, 5), at(5, 6)];
    p.shader(3, 1, version+'void main(){gl_Position=vec4(1.0166667,.2222222,.5,1);}');
    const point = p.pipeline(2, 3, 2); point[3] = 0; p.op(OP.PIPELINE_CREATE, point);
    p.begin(); p.op(OP.VIEWPORT, [bits(.75), bits(1.75), bits(6), bits(4.5), 0, bits(1)]);
    p.op(OP.PIPELINE, [2]); p.op(OP.DRAW, [1, 1, 0, 0]); p.op(OP.PASS_END);
    coverage.push(at(6, 3));
    return coverage;
  } finally { p.dispose(); }
}

export function idsProbe(): number[][] {
  const p = new Probe();
  try {
    p.shader(1, 1, version + `out vec3 v;void main(){
      gl_Position=vec4(.125,-.125,.5,1);v=vec3(bgt_vertex_index==0xffffffffu?1.:0.,
      bgt_vertex_index==0u?1.:0.,bgt_instance_index==42u?1.:0.);}`);
    p.shader(2, 2, version + 'in vec3 v;layout(location=0) out vec4 o;void main(){o=vec4(v,1);}');
    const pipe = p.pipeline(1); pipe[3] = 0; p.op(OP.PIPELINE_CREATE, pipe);
    p.begin(); p.op(OP.PIPELINE, [1]); p.op(OP.DRAW, [1, 1, 0xffffffff, 42]); p.op(OP.PASS_END);
    // Point at logical (4,4); storage has the same center for this probe.
    const point = () => {
      const raw = new Uint8Array(4); p.gl.readPixels(4, 3, 1, 1, p.gl.RGBA, p.gl.UNSIGNED_BYTE, raw);
      return [...raw];
    };
    const array = point();
    const bytes = new Uint8Array(new Uint32Array([0, 0xffffffff]).buffer);
    p.op(OP.BUFFER_CREATE, [1, 2, bytes.length, 0, bytes.length], bytes);
    p.begin(); p.op(OP.PIPELINE, [1]); p.op(OP.INDEX_BUFFER, [1, 1, 0, 8]);
    p.op(OP.DRAW_INDEXED, [2, 1, 0, 0, 42]); p.op(OP.PASS_END);
    return [array, point()];
  } finally { p.dispose(); }
}
