// §13 execution. GPU attachments use GL row zero as BGT's top row, just like legacy targets.
import type { GpuBackend, GpuItem, Letterbox } from '../types';
import { GPU_OP as OP } from '../../runtime/abi';
import { fragmentOutputs, translateShader } from './shaders';

interface IndexedBlend {
  enableiOES(target: number, index: number): void;
  disableiOES(target: number, index: number): void;
  blendEquationSeparateiOES(index: number, rgb: number, alpha: number): void;
  blendFuncSeparateiOES(index: number, sr: number, dr: number, sa: number, da: number): void;
  colorMaskiOES(index: number, r: boolean, g: boolean, b: boolean, a: boolean): void;
}
interface BufferObject { object: WebGLBuffer; words: number[]; data: Uint8Array<ArrayBuffer> }
interface TextureObject { object: WebGLTexture; words: number[]; levels: Uint8Array<ArrayBuffer>[] }
interface ShaderObject { object: WebGLShader; words: number[]; source: string }
interface PipelineObject { object: WebGLProgram; words: number[]; vao: WebGLVertexArrayObject }
const float = (word: number) => new Float32Array(new Uint32Array([word]).buffer)[0];

export class WebGL2Gpu implements GpuBackend {
  readonly languages: number;
  private indexed: IndexedBlend | null;
  private buffers = new Map<number, BufferObject>();
  private textures = new Map<number, TextureObject>();
  private samplers = new Map<number, { object: WebGLSampler; words: number[] }>();
  private shaders = new Map<number, ShaderObject>();
  private pipelines = new Map<number, PipelineObject>();
  private framebuffer: WebGLFramebuffer;
  private screen: WebGLTexture | null = null;
  private screenSize = [0, 0];
  private frame = { width: 1, height: 1, lb: { x: 0, y: 0, w: 1, h: 1, scale: 1 } };
  private screenPass = false;
  private width = 1;
  private height = 1;
  private pipeline?: PipelineObject;
  private vertices = new Map<number, readonly number[]>();
  private index?: readonly number[];
  private uniforms = new Map<number, readonly number[]>();
  private textureBindings = new Map<number, readonly number[]>();
  private stencil = 0;
  private viewport = [0, 0, 1, 1];
  private scratchIndex: WebGLBuffer;
  private scratchIds: WebGLTexture | null = null;
  private scratchAttributes = new Map<number, WebGLBuffer>();
  private deferred: GpuItem[] = [];

  constructor(private gl: WebGL2RenderingContext, private error: (message: string) => void) {
    this.indexed = gl.getExtension('OES_draw_buffers_indexed') as IndexedBlend | null;
    const formats = gl.getExtension('EXT_color_buffer_float');
    this.languages = this.indexed && formats && gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 4096 &&
      gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) >= 65536 &&
      gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) <= 256 &&
      gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) >= 4 && gl.getParameter(gl.MAX_DRAW_BUFFERS) >= 4 &&
      gl.getParameter(gl.MAX_VERTEX_ATTRIBS) >= 16 && gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS) >= 8 &&
      gl.getParameter(gl.MAX_VERTEX_UNIFORM_BLOCKS) >= 8 && gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_BLOCKS) >= 8 &&
      gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) >= 9 &&
      gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) >= 8 ? 6 : 0;
    this.framebuffer = gl.createFramebuffer()!;
    this.scratchIndex = gl.createBuffer()!;
  }

  beginFrame(width: number, height: number, lb: Letterbox): void { this.frame = { width, height, lb }; }

  private format(format: number): [number, number, number, number] {
    const g = this.gl;
    return [
      [g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, 4], [g.SRGB8_ALPHA8, g.RGBA, g.UNSIGNED_BYTE, 4],
      [g.R8, g.RED, g.UNSIGNED_BYTE, 1], [g.RG8, g.RG, g.UNSIGNED_BYTE, 2],
      [g.RGBA16F, g.RGBA, g.HALF_FLOAT, 8], [g.DEPTH24_STENCIL8, g.DEPTH_STENCIL, g.UNSIGNED_INT_24_8, 4],
      [g.DEPTH_COMPONENT32F, g.DEPTH_COMPONENT, g.FLOAT, 4],
    ][format] as [number, number, number, number];
  }
  private compare(value: number): number {
    const g = this.gl;
    return [g.NEVER, g.LESS, g.EQUAL, g.LEQUAL, g.GREATER, g.NOTEQUAL, g.GEQUAL, g.ALWAYS][value];
  }
  private stencilOp(value: number): number {
    const g = this.gl;
    return [g.KEEP, g.ZERO, g.REPLACE, g.INCR, g.DECR, g.INVERT, g.INCR_WRAP, g.DECR_WRAP][value];
  }

  execute(item: GpuItem): number {
    if (this.gl.isContextLost()) {
      item.complete?.(-6, 'WebGL context lost');
      // A shader failed by device loss remains a CPU-side failed handle, never a live native module.
      // Recompiling that failed source on restore could abort before its queued deletion is reached.
      if (item.op <= OP.PIPELINE_DELETE && item.op !== OP.SHADER_CREATE) {
        this.deferred.push({ ...item, complete: undefined });
      }
      return -6;
    }
    try {
      // Defer compilation completion until native error checking is done: exactly one callback.
      let compilation: [number, string?] | undefined;
      this.dispatch(item.op === OP.SHADER_CREATE ? {
        ...item, complete: (code, log) => { compilation = [code, log]; },
      } : item);
      const code = this.gl.getError();
      if (code !== this.gl.NO_ERROR) throw new Error(`GL error 0x${code.toString(16)}`);
      if (compilation) item.complete?.(...compilation);
      return 0;
    } catch (e) {
      const message = `GPU op 0x${item.op.toString(16)}: ${(e as Error).message}`;
      if (item.op === OP.SHADER_CREATE) item.complete?.(-6, message);
      else this.error(message);
      return -6;
    }
  }

  private dispatch(item: GpuItem): void {
    const g = this.gl, w = [...item.words], h = w[0];
    switch (item.op) {
      case OP.BUFFER_CREATE: {
        const object = g.createBuffer()!;
        const data = new Uint8Array(w[2]);
        if (item.data) data.set(item.data);
        g.bindBuffer(g.COPY_WRITE_BUFFER, object); g.bufferData(g.COPY_WRITE_BUFFER, data, g.DYNAMIC_DRAW);
        this.buffers.set(h, { object, words: w, data }); break;
      }
      case OP.BUFFER_UPDATE: {
        const b = this.buffers.get(h)!; b.data.set(item.data!, w[1]);
        g.bindBuffer(g.COPY_WRITE_BUFFER, b.object); g.bufferSubData(g.COPY_WRITE_BUFFER, w[1], item.data!); break;
      }
      case OP.BUFFER_DELETE: g.deleteBuffer(this.buffers.get(h)!.object); this.buffers.delete(h); break;
      case OP.TEXTURE_CREATE: {
        const object = g.createTexture()!, format = this.format(w[4]), levels: Uint8Array<ArrayBuffer>[] = [];
        g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, object);
        g.texStorage2D(g.TEXTURE_2D, w[3], format[0], w[1], w[2]);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAX_LEVEL, w[3] - 1);
        for (let mip = 0; mip < w[3]; mip++) {
          const width = Math.max(1, w[1] >> mip), height = Math.max(1, w[2] >> mip);
          levels.push(new Uint8Array(width * height * format[3]));
          if (w[4] >= 5) {
            const initialization = g.createFramebuffer()!;
            g.bindFramebuffer(g.FRAMEBUFFER, initialization);
            const attachment = w[4] === 5 ? g.DEPTH_STENCIL_ATTACHMENT : g.DEPTH_ATTACHMENT;
            g.framebufferTexture2D(g.FRAMEBUFFER, attachment, g.TEXTURE_2D, object, mip);
            g.drawBuffers([g.NONE]); g.readBuffer(g.NONE);
            g.disable(g.SCISSOR_TEST); g.depthMask(true); g.stencilMask(255);
            if (w[4] === 5) g.clearBufferfi(g.DEPTH_STENCIL, 0, 1, 0);
            else g.clearBufferfv(g.DEPTH, 0, [1]);
            g.deleteFramebuffer(initialization);
          }
        }
        this.textures.set(h, { object, words: w, levels }); break;
      }
      case OP.TEXTURE_UPDATE: {
        const t = this.textures.get(h)!, format = this.format(t.words[4]), stride = Math.max(1, t.words[1] >> w[1]);
        for (let y = 0; y < w[5]; y++) {
          t.levels[w[1]].set(item.data!.subarray(y*w[4]*format[3], (y+1)*w[4]*format[3]),
            ((y+w[3])*stride+w[2])*format[3]);
        }
        g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, t.object);
        const data = t.words[4] === 4 ? new Uint16Array(item.data!.buffer) : item.data!;
        g.texSubImage2D(g.TEXTURE_2D, w[1], w[2], w[3], w[4], w[5], format[1], format[2], data); break;
      }
      case OP.TEXTURE_DELETE: g.deleteTexture(this.textures.get(h)!.object); this.textures.delete(h); break;
      case OP.SAMPLER_CREATE: {
        const object = g.createSampler()!, wraps = [g.CLAMP_TO_EDGE, g.REPEAT, g.MIRRORED_REPEAT];
        const filters = [[g.NEAREST, g.LINEAR], [g.NEAREST_MIPMAP_NEAREST, g.LINEAR_MIPMAP_NEAREST],
          [g.NEAREST_MIPMAP_LINEAR, g.LINEAR_MIPMAP_LINEAR]];
        g.samplerParameteri(object, g.TEXTURE_MIN_FILTER, filters[w[3]][w[1]]);
        g.samplerParameteri(object, g.TEXTURE_MAG_FILTER, w[2] ? g.LINEAR : g.NEAREST);
        g.samplerParameteri(object, g.TEXTURE_WRAP_S, wraps[w[4]]);
        g.samplerParameteri(object, g.TEXTURE_WRAP_T, wraps[w[5]]);
        g.samplerParameteri(object, g.TEXTURE_COMPARE_MODE, w[6] ? g.COMPARE_REF_TO_TEXTURE : g.NONE);
        g.samplerParameteri(object, g.TEXTURE_COMPARE_FUNC, this.compare(w[7]));
        // NONE means base level even when the texture has allocated mip levels.
        g.samplerParameterf(object, g.TEXTURE_MAX_LOD, w[3] ? 1000 : 0);
        this.samplers.set(h, { object, words: w }); break;
      }
      case OP.SAMPLER_DELETE: g.deleteSampler(this.samplers.get(h)!.object); this.samplers.delete(h); break;
      case OP.SHADER_CREATE: {
        const source = translateShader(item.source!, w[1], w[2]);
        const object = g.createShader(w[1] === 1 ? g.VERTEX_SHADER : g.FRAGMENT_SHADER)!;
        g.shaderSource(object, source); g.compileShader(object);
        const log = g.getShaderInfoLog(object) ?? '';
        if (!g.getShaderParameter(object, g.COMPILE_STATUS)) { g.deleteShader(object); throw new Error(log); }
        this.shaders.set(h, { object, words: w, source: item.source! }); item.complete?.(0, log); break;
      }
      case OP.SHADER_DELETE: g.deleteShader(this.shaders.get(h)?.object ?? null); this.shaders.delete(h); break;
      case OP.PIPELINE_CREATE: this.createPipeline(w); break;
      case OP.PIPELINE_DELETE: {
        const p = this.pipelines.get(h)!; g.deleteProgram(p.object); g.deleteVertexArray(p.vao);
        this.pipelines.delete(h); break;
      }
      case OP.PASS_BEGIN: this.beginPass(w); break;
      case OP.PASS_END: this.endPass(); break;
      case OP.PIPELINE: this.pipeline = this.pipelines.get(h)!; this.applyPipeline(); break;
      case OP.VIEWPORT:
        this.viewport = w.slice(0, 4).map(float);
        g.depthRange(float(w[4]), float(w[5])); break;
      case OP.SCISSOR: g.scissor(w[0], w[1], w[2], w[3]); break;
      case OP.STENCIL_REF: this.stencil = h; if (this.pipeline) this.applyStencil(); break;
      case OP.BLEND_CONSTANT: g.blendColor(float(w[0]), float(w[1]), float(w[2]), float(w[3])); break;
      case OP.VERTEX_BUFFER: this.vertices.set(h, w); break;
      case OP.INDEX_BUFFER: this.index = w; break;
      case OP.UNIFORM_BUFFER: this.uniforms.set(h, w); break;
      case OP.TEXTURE: this.textureBindings.set(h, w); break;
      case OP.DRAW: this.draw(w, false); break;
      case OP.DRAW_INDEXED: this.draw(w, true); break;
      default: throw new Error('Unknown GPU opcode');
    }
  }

  private createPipeline(w: number[]): void {
    const g = this.gl, object = g.createProgram()!;
    try {
      g.attachShader(object, this.shaders.get(w[1])!.object);
      g.attachShader(object, this.shaders.get(w[2])!.object); g.linkProgram(object);
      if (!g.getProgramParameter(object, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(object) ?? 'Link failed');
      g.useProgram(object);
      g.uniform1i(g.getUniformLocation(object, 'bgt_internal_ids'), 8);
      for (let i = 0; i < g.getProgramParameter(object, g.ACTIVE_UNIFORM_BLOCKS); i++) {
        const name = g.getActiveUniformBlockName(object, i)!, match = /^bgt_u([0-7])$/.exec(name);
        if (!match || !(w[21] & (1 << +match[1]))) throw new Error(`Undeclared uniform block ${name}`);
        g.uniformBlockBinding(object, i, +match[1]);
      }
      for (let i = 0; i < g.getProgramParameter(object, g.ACTIVE_UNIFORMS); i++) {
        const u = g.getActiveUniform(object, i)!;
        const location = g.getUniformLocation(object, u.name);
        if (!location || u.name.startsWith('bgt_internal_')) continue;
        const match = /^bgt_t([0-7])$/.exec(u.name);
        if (!match || u.size !== 1 || !(w[22] & (1 << +match[1])) ||
          !(u.type === g.SAMPLER_2D || u.type === g.SAMPLER_2D_SHADOW)) throw new Error(`Illegal uniform ${u.name}`);
        g.uniform1i(location, +match[1]);
      }
      for (let i = 0; i < g.getProgramParameter(object, g.ACTIVE_ATTRIBUTES); i++) {
        const a = g.getActiveAttrib(object, i)!, location = g.getAttribLocation(object, a.name);
        if (a.name.startsWith('gl_') && location < 0) continue;
        const start = 26 + w[23]*2;
        const index = Array.from({ length: w[24] }, (_, j) => start+j*4).find(j => w[j] === location);
        const types = [g.FLOAT, g.FLOAT_VEC2, g.FLOAT_VEC3, g.FLOAT_VEC4, g.FLOAT_VEC4,
          g.INT, g.INT_VEC2, g.INT_VEC3, g.INT_VEC4, g.UNSIGNED_INT, g.UNSIGNED_INT_VEC2,
          g.UNSIGNED_INT_VEC3, g.UNSIGNED_INT_VEC4];
        if (index === undefined || a.size !== 1 || types[w[index+3]] !== a.type) {
          throw new Error(`Vertex input mismatch ${a.name}`);
        }
      }
      // Outputs must have explicit locations, and cannot address absent color attachments.
      for (const output of fragmentOutputs(this.shaders.get(w[2])!.source)) {
        const names = output.array ? Array.from({ length: g.getParameter(g.MAX_DRAW_BUFFERS) },
          (_, i) => `${output.name}[${i}]`) : [output.name];
        for (const name of names) {
          const location = g.getFragDataLocation(object, name);
          if (location >= 0 && (location >= w[25] || !/^(float|vec[234])$/.test(output.type))) {
            throw new Error('Color output mismatch');
          }
        }
      }
      this.pipelines.set(w[0], { object, words: w, vao: g.createVertexArray()! });
    } catch (e) { g.deleteProgram(object); throw e; }
  }

  private beginPass(w: number[]): void {
    const g = this.gl;
    this.pipeline = undefined; this.vertices.clear(); this.uniforms.clear(); this.textureBindings.clear();
    this.index = undefined; this.stencil = 0; this.screenPass = w[0] === 1 && w[7] === 0;
    const texture = w[0] ? this.textures.get(w[7]) : this.textures.get(w[1]);
    const mip = w[0] ? w[8] : w[2];
    this.width = this.screenPass ? this.frame.width : Math.max(1, texture!.words[1] >> mip);
    this.height = this.screenPass ? this.frame.height : Math.max(1, texture!.words[2] >> mip);
    if (this.screenPass) {
      if (!this.screen || this.screenSize[0] !== this.width || this.screenSize[1] !== this.height) {
        g.deleteTexture(this.screen); this.screen = g.createTexture()!;
        g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, this.screen);
        g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA8, this.width, this.height);
        this.screenSize = [this.width, this.height];
      }
    }
    g.bindFramebuffer(g.FRAMEBUFFER, this.framebuffer);
    for (let i = 0; i < 4; i++) {
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0+i, g.TEXTURE_2D,
        i < w[0] ? (this.screenPass ? this.screen : this.textures.get(w[7+i*7])!.object) : null,
        i < w[0] ? w[8+i*7] : 0);
    }
    g.framebufferTexture2D(g.FRAMEBUFFER, g.DEPTH_STENCIL_ATTACHMENT, g.TEXTURE_2D, null, 0);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.TEXTURE_2D, null, 0);
    if (w[1]) {
      const depth = this.textures.get(w[1])!;
      g.framebufferTexture2D(g.FRAMEBUFFER, depth.words[4] === 5 ? g.DEPTH_STENCIL_ATTACHMENT : g.DEPTH_ATTACHMENT,
        g.TEXTURE_2D, depth.object, w[2]);
    }
    g.drawBuffers(w[0] ? Array.from({ length: w[0] }, (_, i) => g.COLOR_ATTACHMENT0+i) : [g.NONE]);
    g.readBuffer(w[0] ? g.COLOR_ATTACHMENT0 : g.NONE);
    if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete GPU pass');
    g.disable(g.SCISSOR_TEST); g.depthMask(true); g.stencilMask(255);
    for (let i = 0; i < 4; i++) this.indexed!.colorMaskiOES(i, true, true, true, true);
    if (this.screenPass && w[9] === 0) {
      const b = this.frame.lb, H = g.drawingBufferHeight;
      g.bindFramebuffer(g.READ_FRAMEBUFFER, null);
      g.blitFramebuffer(b.x, H-b.y, b.x+b.w, H-b.y-b.h, 0, 0, this.width, this.height,
        g.COLOR_BUFFER_BIT, g.NEAREST);
      g.bindFramebuffer(g.FRAMEBUFFER, this.framebuffer);
    }
    for (let i = 0; i < w[0]; i++) {
      const base = 7+i*7;
      if (w[base+2]) g.clearBufferfv(g.COLOR, i, w.slice(base+3, base+7).map(float));
    }
    if (w[1] && w[3]) g.clearBufferfv(g.DEPTH, 0, [float(w[5])]);
    if (w[1] && w[4]) g.clearBufferiv(g.STENCIL, 0, [w[6]]);
    this.viewport = [0, 0, this.width, this.height];
    g.viewport(0, 0, this.width, this.height); g.depthRange(0, 1);
    g.enable(g.SCISSOR_TEST); g.scissor(0, 0, this.width, this.height); g.blendColor(0, 0, 0, 0);
  }

  private endPass(): void {
    const g = this.gl;
    if (this.screenPass) {
      const b = this.frame.lb, H = g.drawingBufferHeight;
      g.disable(g.SCISSOR_TEST); g.bindFramebuffer(g.DRAW_FRAMEBUFFER, null);
      g.bindFramebuffer(g.READ_FRAMEBUFFER, this.framebuffer); g.readBuffer(g.COLOR_ATTACHMENT0);
      g.blitFramebuffer(0, 0, this.width, this.height, b.x, H-b.y, b.x+b.w, H-b.y-b.h,
        g.COLOR_BUFFER_BIT, g.NEAREST);
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null); this.pipeline = undefined;
  }

  private applyStencil(): void {
    const g = this.gl, w = this.pipeline!.words;
    for (const [side, base] of [[g.FRONT, 13], [g.BACK, 17]]) {
      g.stencilFuncSeparate(side, this.compare(w[base]), this.stencil, w[11]);
      g.stencilOpSeparate(side, this.stencilOp(w[base+1]), this.stencilOp(w[base+2]), this.stencilOp(w[base+3]));
    }
    g.stencilMask(w[12]);
  }
  private applyPipeline(): void {
    const g = this.gl, p = this.pipeline!, w = p.words;
    g.useProgram(p.object); g.bindVertexArray(p.vao);
    if (w[4]) { g.enable(g.CULL_FACE); g.cullFace(w[4] === 1 ? g.FRONT : g.BACK); }
    else g.disable(g.CULL_FACE);
    g.frontFace(w[5] === 0 ? g.CW : g.CCW); // attachment storage has inverted Y
    if (w[7] || w[8]) g.enable(g.DEPTH_TEST); else g.disable(g.DEPTH_TEST);
    g.depthFunc(w[7] ? this.compare(w[9]) : g.ALWAYS); g.depthMask(!!w[8]);
    if (w[10]) g.enable(g.STENCIL_TEST); else g.disable(g.STENCIL_TEST);
    this.applyStencil();
    const factors = [g.ZERO, g.ONE, g.SRC_COLOR, g.ONE_MINUS_SRC_COLOR, g.DST_COLOR, g.ONE_MINUS_DST_COLOR,
      g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.DST_ALPHA, g.ONE_MINUS_DST_ALPHA, g.CONSTANT_COLOR,
      g.ONE_MINUS_CONSTANT_COLOR];
    const alphaFactors: number[] = [...factors];
    alphaFactors[2] = g.SRC_ALPHA; alphaFactors[3] = g.ONE_MINUS_SRC_ALPHA;
    alphaFactors[4] = g.DST_ALPHA; alphaFactors[5] = g.ONE_MINUS_DST_ALPHA;
    alphaFactors[10] = g.CONSTANT_ALPHA; alphaFactors[11] = g.ONE_MINUS_CONSTANT_ALPHA;
    const ops = [g.FUNC_ADD, g.FUNC_SUBTRACT, g.FUNC_REVERSE_SUBTRACT, g.MIN, g.MAX];
    for (let i = 0; i < w[25]; i++) {
      const c = 26+w[23]*2+w[24]*4+i*9, ext = this.indexed!;
      if (w[c+1]) ext.enableiOES(g.BLEND, i); else ext.disableiOES(g.BLEND, i);
      ext.blendEquationSeparateiOES(i, ops[w[c+4]], ops[w[c+7]]);
      ext.blendFuncSeparateiOES(i, factors[w[c+2]], factors[w[c+3]], alphaFactors[w[c+5]], alphaFactors[w[c+6]]);
      ext.colorMaskiOES(i, !!(w[c+8]&1), !!(w[c+8]&2), !!(w[c+8]&4), !!(w[c+8]&8));
    }
  }

  private draw(w: number[], indexed: boolean): void {
    const g = this.gl, p = this.pipeline!, pw = p.words, instance = w[indexed ? 4 : 3];
    const [vx, vy, vw, vh] = this.viewport;
    g.uniform4f(g.getUniformLocation(p.object, 'bgt_internal_view_transform'),
      vw/this.width, vh/this.height, (2*vx+vw-this.width)/this.width, (2*vy+vh-this.height)/this.height);
    let first = w[2], count = w[0];
    let indices: Uint32Array<ArrayBuffer> | undefined, ids: Uint32Array<ArrayBuffer> | undefined;
    if (indexed) {
      // Rebase to the fetched vertex interval. This also avoids WebGL's mandatory fixed-index
      // primitive restart, and supports u32 BGT IDs outside GL's signed drawArrays first range.
      const b = this.index!, data = this.buffers.get(b[0])!.data;
      const view = new DataView(data.buffer), size = b[1] ? 4 : 2;
      indices = new Uint32Array(count);
      first = 0xffffffff;
      let last = 0;
      for (let i = 0; i < indices.length; i++) {
        const at = b[2]+(w[2]+i)*size;
        const vertex = (size === 2 ? view.getUint16(at, true) : view.getUint32(at, true))+(w[3]|0);
        indices[i] = vertex; first = Math.min(first, vertex); last = Math.max(last, vertex);
      }
      count = last-first+1;
      if (count-1 > g.getParameter(g.MAX_ELEMENT_INDEX) || count === 0x100000000) {
        // Sparse full-width IDs can exceed GL_MAX_ELEMENT_INDEX or hit the restart token.
        // Dense native indices plus a private integer lookup preserve IDs and primitive order.
        ids = indices; indices = Uint32Array.from(ids, (_, i) => i); first = 0; count = w[0];
      } else for (let i = 0; i < indices.length; i++) indices[i] -= first;
    }
    g.uniform1i(g.getUniformLocation(p.object, 'bgt_internal_remap'), ids ? 1 : 0);
    g.activeTexture(g.TEXTURE8); g.bindSampler(8, null);
    if (!this.scratchIds) {
      this.scratchIds = g.createTexture()!; g.bindTexture(g.TEXTURE_2D, this.scratchIds);
      g.texImage2D(g.TEXTURE_2D, 0, g.R32UI, 1, 1, 0, g.RED_INTEGER, g.UNSIGNED_INT, new Uint32Array(1));
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAX_LEVEL, 0);
    } else g.bindTexture(g.TEXTURE_2D, this.scratchIds);
    if (ids) {
      const width = Math.min(4096, ids.length), height = Math.ceil(ids.length/width);
      const pixels = new Uint32Array(width*height); pixels.set(ids);
      g.texImage2D(g.TEXTURE_2D, 0, g.R32UI, width, height, 0, g.RED_INTEGER, g.UNSIGNED_INT, pixels);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAX_LEVEL, 0);
      g.uniform1i(g.getUniformLocation(p.object, 'bgt_internal_id_width'), width);
    }
    g.uniform1ui(g.getUniformLocation(p.object, 'bgt_internal_vertex'), first);
    g.uniform1ui(g.getUniformLocation(p.object, 'bgt_internal_instance'), instance);
    for (let i = 0; i < pw[24]; i++) {
      const a = 26+pw[23]*2+i*4, slot = pw[a+1], binding = this.vertices.get(slot)!;
      const stride = pw[26+slot*2], step = pw[27+slot*2], format = pw[a+3];
      let offset = binding[2]+pw[a+2]+(step ? instance : first)*stride, nativeStride = stride;
      const buffer = this.buffers.get(binding[1])!;
      g.bindBuffer(g.ARRAY_BUFFER, buffer.object);
      const components = format <= 3 ? format+1 : format === 4 ? 4 : format <= 8 ? format-4 : format-8;
      if (stride > 255 || (ids && !step)) {
        // WebGL caps vertexAttribPointer stride at 255; §13 allows 2048. Pack each active
        // attribute from owned upload shadows. No guest reads or geometry reinterpretation.
        const bytes = format === 4 ? 4 : components*4, elements = step ? w[1] : count;
        const packed = new Uint8Array(elements*bytes);
        for (let j = 0; j < elements; j++) {
          const at = offset+(ids && !step ? ids[j] : j)*stride;
          packed.set(buffer.data.subarray(at, at+bytes), j*bytes);
        }
        let scratch = this.scratchAttributes.get(pw[a]);
        if (!scratch) { scratch = g.createBuffer()!; this.scratchAttributes.set(pw[a], scratch); }
        g.bindBuffer(g.ARRAY_BUFFER, scratch); g.bufferData(g.ARRAY_BUFFER, packed, g.STREAM_DRAW);
        offset = 0; nativeStride = bytes;
      }
      g.enableVertexAttribArray(pw[a]);
      if (format <= 4) g.vertexAttribPointer(pw[a], components, format === 4 ? g.UNSIGNED_BYTE : g.FLOAT,
        format === 4, nativeStride, offset);
      else g.vertexAttribIPointer(pw[a], components, format <= 8 ? g.INT : g.UNSIGNED_INT, nativeStride, offset);
      g.vertexAttribDivisor(pw[a], step);
    }
    for (const [slot, b] of this.uniforms) {
      g.bindBufferRange(g.UNIFORM_BUFFER, slot, this.buffers.get(b[1])!.object, b[2], b[3]);
      const block = g.getUniformBlockIndex(p.object, `bgt_u${slot}`);
      if (block !== g.INVALID_INDEX &&
        g.getActiveUniformBlockParameter(p.object, block, g.UNIFORM_BLOCK_DATA_SIZE) > b[3]) {
        throw new Error('Uniform range smaller than reflected block');
      }
    }
    for (const [slot, b] of this.textureBindings) {
      g.activeTexture(g.TEXTURE0+slot); g.bindTexture(g.TEXTURE_2D, this.textures.get(b[1])!.object);
      g.bindSampler(slot, this.samplers.get(b[2])!.object);
    }
    const topology = [g.POINTS, g.LINES, g.LINE_STRIP, g.TRIANGLES, g.TRIANGLE_STRIP][pw[3]];
    if (!indexed) g.drawArraysInstanced(topology, 0, w[0], w[1]);
    else {
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, this.scratchIndex);
      g.bufferData(g.ELEMENT_ARRAY_BUFFER, indices!, g.STREAM_DRAW);
      g.drawElementsInstanced(topology, w[0], g.UNSIGNED_INT, 0, w[1]);
    }
  }

  restore(): void {
    const buffers = [...this.buffers], textures = [...this.textures], samplers = [...this.samplers];
    const shaders = [...this.shaders], pipelines = [...this.pipelines];
    this.buffers.clear(); this.textures.clear(); this.samplers.clear(); this.shaders.clear(); this.pipelines.clear();
    this.indexed = this.gl.getExtension('OES_draw_buffers_indexed') as IndexedBlend | null;
    if (this.languages && (!this.indexed || !this.gl.getExtension('EXT_color_buffer_float'))) {
      throw new Error('GPU extensions lost');
    }
    this.framebuffer = this.gl.createFramebuffer()!; this.scratchIndex = this.gl.createBuffer()!;
    this.scratchAttributes.clear(); this.scratchIds = null;
    this.screen = null; this.screenSize = [0, 0];
    const replay = (item: GpuItem) => { if (this.execute(item)) throw new Error('GPU resource restoration failed'); };
    for (const [, b] of buffers) replay({ kind: 'gpu', op: OP.BUFFER_CREATE, words: b.words, data: b.data });
    for (const [h, t] of textures) {
      replay({ kind: 'gpu', op: OP.TEXTURE_CREATE, words: t.words });
      if (t.words[4] < 5) for (let mip = 0; mip < t.levels.length; mip++) {
        const width = Math.max(1, t.words[1] >> mip), height = Math.max(1, t.words[2] >> mip);
        replay({ kind: 'gpu', op: OP.TEXTURE_UPDATE,
          words: [h, mip, 0, 0, width, height, 0, t.levels[mip].length], data: t.levels[mip] });
      }
    }
    for (const [, s] of samplers) replay({ kind: 'gpu', op: OP.SAMPLER_CREATE, words: s.words });
    for (const [, s] of shaders) replay({ kind: 'gpu', op: OP.SHADER_CREATE, words: s.words, source: s.source });
    for (const [, p] of pipelines) replay({ kind: 'gpu', op: OP.PIPELINE_CREATE, words: p.words });
    const deferred = this.deferred; this.deferred = [];
    for (const item of deferred) replay(item);
  }
}
