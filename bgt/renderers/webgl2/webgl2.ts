// WebGL 2 backend (fallback). Consumes the shared decoded Frame.

import { BLEND_ADD, BLEND_ALPHA, BLEND_INVERT, BLEND_MULTIPLY, BLEND_OPAQUE, BLEND_PREMULTIPLIED, FILTER_LINEAR } from '../../runtime/abi';
import type { Frame, TextureTable } from '../../runtime/commands';
import { GpuStats, Letterbox, Pixels, Renderer, WHITE_PIXEL, clipToDevice } from '../types';

const VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_col;
uniform vec2 u_size;
uniform float u_flip; // 1 for the screen; -1 for render targets so texture row 0 stays the top row
out vec2 v_uv;
out vec4 v_col;
void main() {
  gl_Position = vec4(a_pos.x / u_size.x * 2.0 - 1.0, (1.0 - a_pos.y / u_size.y * 2.0) * u_flip, 0.0, 1.0);
  v_uv = a_uv;
  v_col = a_col;
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
in vec4 v_col;
out vec4 o_color;
void main() {
  o_color = texture(u_tex, v_uv) * v_col;
}`;

export interface WebGL2Options {
  debug?: boolean;
}

export class WebGL2Renderer implements Renderer {
  readonly kind = 'webgl2' as const;
  readonly stats: GpuStats = { drawCalls: 0, passes: 0, vertexBytes: 0, submitMs: 0 };
  lost = false;
  maxTextureSize = 4096;
  private gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private vbo!: WebGLBuffer;
  private uSize!: WebGLUniformLocation;
  private uFlip!: WebGLUniformLocation;
  private targets = new Map<number, { fbo: WebGLFramebuffer; w: number; h: number }>();
  private samplers: WebGLSampler[] = [];
  private white!: WebGLTexture;
  private textures = new Map<number, WebGLTexture>();
  private lostCbs: Array<(r: string) => void> = [];
  private restoredCbs: Array<() => void> = [];
  private errorCbs: Array<(m: string) => void> = [];

  private constructor(
    readonly canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    private readonly opts: WebGL2Options,
  ) {
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.textures.clear();
      this.targets.clear();
      for (const cb of this.lostCbs) cb('webgl context lost');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.initResources();
      this.lost = false;
      for (const cb of this.restoredCbs) cb();
    });
    this.initResources();
  }

  static create(canvas: HTMLCanvasElement, opts: WebGL2Options = {}): WebGL2Renderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return null;
    return new WebGL2Renderer(canvas, gl, opts);
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(`WebGL2 shader compile failed: ${gl.getShaderInfoLog(sh)}`);
    }
    return sh;
  }

  private initResources(): void {
    const gl = this.gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const p = gl.createProgram()!;
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`WebGL2 program link failed: ${gl.getProgramInfoLog(p)}`);
    }
    this.program = p;
    this.uSize = gl.getUniformLocation(p, 'u_size')!;
    this.uFlip = gl.getUniformLocation(p, 'u_flip')!;
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);

    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 20, 16);

    this.samplers = [gl.NEAREST, gl.LINEAR].map((f) => {
      const s = gl.createSampler()!;
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, f);
      gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, f);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return s;
    });

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    this.white = this.makeTexture(1, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, WHITE_PIXEL);
  }

  private makeTexture(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    return t;
  }

  private makeTarget(handle: number, tex: WebGLTexture, w: number, h: number): void {
    const gl = this.gl;
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targets.set(handle, { fbo, w, h });
  }

  private dropTarget(handle: number): void {
    const t = this.targets.get(handle);
    if (t) this.gl.deleteFramebuffer(t.fbo);
    this.targets.delete(handle);
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  private setBlend(mode: number): void {
    const gl = this.gl;
    if (mode === BLEND_OPAQUE) {
      gl.disable(gl.BLEND);
      return;
    }
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    if (mode === BLEND_ALPHA) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else if (mode === BLEND_ADD) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
    else if (mode === BLEND_PREMULTIPLIED) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else if (mode === BLEND_INVERT) gl.blendFuncSeparate(gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
    else if (mode === BLEND_MULTIPLY) gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
  }

  drawFrame(frame: Frame, lb: Letterbox, readback: boolean): Pixels | null {
    if (this.lost) return null;
    const gl = this.gl;
    const t0 = performance.now();
    const H = this.canvas.height;
    this.stats.drawCalls = 0;
    this.stats.passes = 1;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, this.canvas.width, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const bytes = frame.vertexBytes();
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STREAM_DRAW);
    this.stats.vertexBytes = bytes.byteLength;
    gl.enable(gl.SCISSOR_TEST);
    gl.activeTexture(gl.TEXTURE0);
    let curBlend = -1;
    let curTarget = -1;
    const bindTarget = (target: number) => {
      if (target === curTarget) return;
      curTarget = target;
      const rt = target ? this.targets.get(target) : undefined;
      if (rt) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
        gl.viewport(0, 0, rt.w, rt.h);
        gl.uniform2f(this.uSize, rt.w, rt.h);
        gl.uniform1f(this.uFlip, -1);
        this.stats.passes++;
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(lb.x, H - lb.y - lb.h, lb.w, lb.h);
        gl.uniform2f(this.uSize, frame.logicalW, frame.logicalH);
        gl.uniform1f(this.uFlip, 1);
      }
    };
    bindTarget(0);

    for (const it of frame.items) {
      switch (it.kind) {
        case 'texCreate': {
          const old = this.textures.get(it.handle);
          if (old) gl.deleteTexture(old);
          this.dropTarget(it.handle);
          const tex = this.makeTexture(it.width, it.height);
          this.textures.set(it.handle, tex);
          if (it.renderTarget) {
            this.makeTarget(it.handle, tex, it.width, it.height);
            if (curTarget === it.handle) curTarget = -1;
            gl.bindFramebuffer(gl.FRAMEBUFFER, curTarget > 0 ? this.targets.get(curTarget)!.fbo : null);
          }
          break;
        }
        case 'texUpdate': {
          const t = this.textures.get(it.handle);
          if (!t) break;
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, it.x, it.y, it.w, it.h, gl.RGBA, gl.UNSIGNED_BYTE, it.data);
          break;
        }
        case 'texDelete': {
          const t = this.textures.get(it.handle);
          if (t) gl.deleteTexture(t);
          this.textures.delete(it.handle);
          this.dropTarget(it.handle);
          break;
        }
        case 'draw': {
          if (it.target && !this.targets.has(it.target)) break;
          bindTarget(it.target);
          if (it.target) {
            // render target: logical px == texture px; u_flip makes GL row 0 the top row, so no y flip here
            if (it.clip.w === 0 || it.clip.h === 0) break;
            gl.scissor(it.clip.x, it.clip.y, it.clip.w, it.clip.h);
          } else {
            const r = clipToDevice(it.clip, lb, frame.logicalW, frame.logicalH);
            if (r.w === 0 || r.h === 0) break;
            gl.scissor(r.x, H - r.y - r.h, r.w, r.h);
          }
          if (it.blend !== curBlend) {
            this.setBlend(it.blend);
            curBlend = it.blend;
          }
          gl.bindTexture(gl.TEXTURE_2D, it.texture === 0 ? this.white : (this.textures.get(it.texture) ?? this.white));
          gl.bindSampler(0, this.samplers[it.filter === FILTER_LINEAR ? 1 : 0]);
          gl.drawArrays(gl.TRIANGLES, it.first, it.count);
          this.stats.drawCalls++;
          break;
        }
      }
    }

    if (this.opts.debug) {
      const err = gl.getError();
      if (err !== gl.NO_ERROR && !gl.isContextLost()) for (const cb of this.errorCbs) cb(`WebGL error 0x${err.toString(16)}`);
    }

    bindTarget(0);
    let out: Pixels | null = null;
    if (readback) {
      const w = this.canvas.width;
      const raw = new Uint8Array(w * H * 4);
      gl.readPixels(0, 0, w, H, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      const data = new Uint8Array(raw.length);
      const row = w * 4;
      for (let y = 0; y < H; y++) data.set(raw.subarray((H - 1 - y) * row, (H - y) * row), y * row);
      out = { width: w, height: H, data };
    }
    this.stats.submitMs = performance.now() - t0;
    return out;
  }

  async finish(): Promise<void> {
    this.gl.finish();
  }

  restoreTextures(textures: TextureTable): void {
    const gl = this.gl;
    for (const [handle, e] of textures.entries) {
      const t = this.makeTexture(e.width, e.height);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, e.width, e.height, gl.RGBA, gl.UNSIGNED_BYTE, e.shadow);
      this.textures.set(handle, t);
      if (e.renderTarget) this.makeTarget(handle, t, e.width, e.height); // GPU-drawn contents are lost
    }
  }

  onUnrecoverable(cb: (reason: string) => void): void {
    // WebGL restoration is browser-driven; the runtime's loss watchdog covers the
    // never-restored case. Kept for interface parity.
    this.unrecoverableCbs.push(cb);
  }
  private unrecoverableCbs: Array<(m: string) => void> = [];

  async simulateLoss(opts: { unrecoverable?: boolean } = {}): Promise<void> {
    if (opts.unrecoverable) {
      this.gl.getExtension('WEBGL_lose_context')?.loseContext();
      for (const cb of this.unrecoverableCbs) cb('WebGL context lost (simulated, unrecoverable)');
      return;
    }
    const ext = this.gl.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('WEBGL_lose_context unavailable');
    const restored = new Promise<void>((resolve) => this.restoredCbs.push(() => resolve()));
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 30));
    ext.restoreContext();
    await restored;
  }

  onLost(cb: (reason: string) => void): void {
    this.lostCbs.push(cb);
  }
  onRestored(cb: () => void): void {
    this.restoredCbs.push(cb);
  }
  onError(cb: (message: string) => void): void {
    this.errorCbs.push(cb);
  }

  destroy(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
