// WebGL 2 backend (fallback). Consumes the shared decoded Frame.

import {
  BLEND_ADD, BLEND_ALPHA, BLEND_INVERT, BLEND_MULTIPLY, BLEND_OPAQUE, BLEND_PREMULTIPLIED,
  FILTER_LINEAR, GPU_OP,
} from '../../runtime/abi';
import type { Frame, TextureTable } from '../../runtime/commands';
import { WebGL2Gpu } from './gpu';
import type { CheckpointRenderer, CheckpointSurfaces } from '../checkpoint-surfaces';
import { GpuStats, Letterbox, Pixels, Renderer, WHITE_PIXEL, clipToDevice, readbackRect } from '../types';

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
  /** K53: opt-in EXT_disjoint_timer_query_webgl2 frame timing; 'unavailable' without the extension. */
  gpuTiming?: boolean;
  /** K53: keep a pass framebuffer bound for the next same-image pass (default on). */
  batch?: boolean;
  /** K71 (Q128): commit §13 texture storage on first use (default on); false allocates at creation (A/B). */
  lazyTextures?: boolean;
}

/** Whole-drawFrame GPU time via TIME_ELAPSED queries, read without stalling a few frames later. */
class WebGL2Timing {
  private pending: WebGLQuery[] = [];
  private free: WebGLQuery[] = [];
  private active?: WebGLQuery;
  lastMs: number | null = null;
  constructor(private gl: WebGL2RenderingContext, private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }) {}
  begin(): void {
    const gl = this.gl;
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift()!, ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) this.lastMs = ns / 1e6;
      this.free.push(q);
    }
    if (this.pending.length >= 8) return;
    this.active = this.free.pop() ?? gl.createQuery()!;
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active);
  }
  end(): void {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(this.active); this.active = undefined;
  }
  reset(): void { this.pending = []; this.free = []; this.active = undefined; }
}

/** K69: contexts of destroyed renderers, kept restorable so reuse() can recycle them instead of creating a new one. */
const parkedContexts = new WeakMap<HTMLCanvasElement, { gl: WebGL2RenderingContext; ext: WEBGL_lose_context; lost: Promise<boolean> }>();
/** Bounds on reuse(): a synthetic loss event is dispatched in the next task and a permitted restore completes within a
 * few ms (WebKit/Chromium measured 0-5 ms); a context that is not restorable (e.g. a real loss) falls back fast. */
export const REUSE_LOST_MS = 100, REUSE_RESTORE_MS = 250;

export class WebGL2Renderer implements Renderer {
  readonly gpu: WebGL2Gpu;
  readonly kind = 'webgl2' as const;
  readonly stats: GpuStats = { drawCalls: 0, passes: 0, vertexBytes: 0, submitMs: 0, nativePasses: 0, nativeSubmits: 0,
    mergedPasses: 0, bufferRenames: 0, gpuMs: null, gpuTiming: 'off' };
  private timing?: WebGL2Timing;
  private nativeCheckDue = false;
  lost = false;
  private destroyed = false;
  private released?: (ok: boolean) => void;
  private readonly listeners = new AbortController();
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
  private snapshot?: { texture: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number; lb: Letterbox; retained: boolean };
  private textures = new Map<number, WebGLTexture>();
  private lostCbs: Array<(r: string) => void> = [];
  private restoredCbs: Array<() => void> = [];
  private errorCbs: Array<(m: string) => void> = [];

  private constructor(
    readonly canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    opts: WebGL2Options,
  ) {
    this.gl = gl;
    // K53: the renderer's frame loop releases lingering pass framebuffers (gpu.flush) at legacy items/frame end.
    this.gpu = new WebGL2Gpu(gl, (m) => { for (const cb of this.errorCbs) cb(m); }, { ...opts, batch: opts.batch !== false });
    if (opts.gpuTiming) {
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
      this.timing = ext ? new WebGL2Timing(gl, ext) : undefined;
      this.stats.gpuTiming = ext ? 'timer-query' : 'unavailable';
    }
    const signal = this.listeners.signal;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.destroyed) { this.listeners.abort(); this.released?.(true); return; } // K69: restorable for reuse()
      this.lost = true;
      this.textures.clear();
      this.targets.clear();
      for (const cb of this.lostCbs) cb('webgl context lost');
    }, { signal });
    canvas.addEventListener('webglcontextrestored', () => {
      try {
        this.initResources();
        this.timing?.reset(); this.nativeCheckDue = false;
        this.gpu.restore();
      } catch (e) {
        for (const cb of this.unrecoverableCbs) cb(`GPU restore failed: ${(e as Error).message}`);
        return;
      }
      this.lost = false;
      for (const cb of this.restoredCbs) cb();
    }, { signal });
    this.initResources();
  }

  /** K69: a fresh renderer on the canvas of a destroyed one, by restoring that canvas's own context. WebKit frees a
   * context's place in the page's 16-context budget only when it is garbage-collected, never on loseContext(): one new
   * canvas per temporary renderer (savestate snapshot/compaction/restore) made WebKit recycle the least recently used
   * context, which can be a live one (docs/webkit.md). Null (use a new canvas) if the canvas cannot be restored. */
  static async reuse(canvas: HTMLCanvasElement, opts: WebGL2Options = {}): Promise<WebGL2Renderer | null> {
    const parked = parkedContexts.get(canvas);
    parkedContexts.delete(canvas);
    if (!parked) return null;
    const within = <T>(p: Promise<T>, fallback: T, ms: number) =>
      Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
    if (!(await within(parked.lost, false, REUSE_LOST_MS)) || !parked.gl.isContextLost()) return null;
    // Restoration is allowed only after the loss event's dispatch has finished (not in its microtasks).
    await new Promise((r) => setTimeout(r, 0));
    const restored = new Promise<boolean>((r) => canvas.addEventListener('webglcontextrestored', () => r(true), { once: true }));
    parked.ext.restoreContext();
    if (!(await within(restored, false, REUSE_RESTORE_MS)) || parked.gl.isContextLost()) return null;
    return new WebGL2Renderer(canvas, parked.gl, opts);
  }

  /** K74 (Q137): the retained full-canvas snapshot (RGBA8), a presentation copy outside the executor. */
  presentationBytes(): number { return this.snapshot ? this.snapshot.w * this.snapshot.h * 4 : 0; }

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
    this.snapshot = undefined;
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
    if (mode === BLEND_ALPHA) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else if (mode === BLEND_ADD) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
    else if (mode === BLEND_PREMULTIPLIED) {
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else if (mode === BLEND_INVERT) {
      gl.blendFuncSeparate(gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
    } else if (mode === BLEND_MULTIPLY) gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
  }

  drawFrame(frame: Frame, lb: Letterbox, readback: boolean, retainPixels = false): Pixels | null {
    if (this.lost) {
      for (const it of frame.items) {
        if (it.kind === 'readback') it.complete();
        if (it.kind === 'gpu') this.gpu.execute(it);
      }
      return null;
    }
    this.gpu.beginFrame(frame.logicalW, frame.logicalH, lb);
    // The previous frame's deferred native-error poll, before this frame's commands (attributed 'frameEnd').
    if (this.nativeCheckDue) { this.nativeCheckDue = false; this.gpu.checkNativeError(); }
    const gl = this.gl;
    const t0 = performance.now();
    const H = this.canvas.height;
    this.stats.drawCalls = 0;
    this.stats.passes = 1;
    this.timing?.begin();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
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

    if (this.snapshot?.retained) {
      const old = this.snapshot.lb;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.snapshot.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null); gl.disable(gl.SCISSOR_TEST);
      gl.blitFramebuffer(old.x, this.snapshot.h-old.y-old.h, old.x+old.w, this.snapshot.h-old.y,
        lb.x, H-lb.y-lb.h, lb.x+lb.w, H-lb.y, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.enable(gl.SCISSOR_TEST);
    }
    let gpuDirty = false;
    for (const it of frame.items) {
      if (it.kind !== 'gpu' && gpuDirty) {
        this.gpu.flush(); this.gpu.invalidateState(); // the 2D path below writes GL state directly
        gl.useProgram(this.program); gl.bindVertexArray(this.vao);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
        gl.colorMask(true, true, true, true); gl.activeTexture(gl.TEXTURE0);
        gl.enable(gl.SCISSOR_TEST); curBlend = -1; curTarget = -1;
        bindTarget(0); gpuDirty = false;
      }
      switch (it.kind) {
        case 'gpu': {
          if (this.gpu.execute(it) === 0) {
            if (it.op === GPU_OP.PASS_BEGIN) this.stats.passes++;
            if (it.op === GPU_OP.DRAW || it.op === GPU_OP.DRAW_INDEXED) this.stats.drawCalls++;
          }
          gpuDirty = true; curTarget = -1; curBlend = -1;
          break;
        }
        case 'readback': {
          bindTarget(it.target);
          const rt = it.target ? this.targets.get(it.target) : null;
          const width = rt ? it.w : this.canvas.width, height = rt ? it.h : H;
          const raw = new Uint8Array(width*height*4), data = new Uint8Array(raw.length);
          gl.readPixels(rt ? it.x : 0,rt ? it.y : 0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,raw);
          for (let y=0;y<height;y++) {
            const row = it.target ? y : height-1-y;
            data.set(raw.subarray(row*width*4,(row+1)*width*4),y*width*4);
          }
          it.complete(rt ? data : readbackRect({width,height,data},it,frame.logicalW,frame.logicalH,lb));
          break;
        }
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

    this.gpu.flush(); this.gpu.invalidateState();
    gl.useProgram(this.program);
    bindTarget(0);
    // Retain the final physical image, including any legacy draws after a GPU pass.
    // Win32 guests submit in update: repeated paused captures must not erase their screen.
    // For legacy-only checkpointing, save the output without loading it in the next frame.
    const saved = this.snapshot;
    const retained = !!saved?.retained || frame.items.some(it => it.kind === 'gpu');
    const moved = retainPixels && (!saved || saved.w !== this.canvas.width || saved.h !== H ||
      saved.lb.x !== lb.x || saved.lb.y !== lb.y || saved.lb.w !== lb.w || saved.lb.h !== lb.h);
    if ((retained && frame.items.length) || (retainPixels && (!retained || moved))) {
      if (this.snapshot?.w !== this.canvas.width || this.snapshot.h !== H) {
        if (this.snapshot) { gl.deleteTexture(this.snapshot.texture); gl.deleteFramebuffer(this.snapshot.fbo); }
        const texture = this.makeTexture(this.canvas.width, H), fbo = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        this.snapshot = { texture, fbo, w: this.canvas.width, h: H, lb, retained };
      }
      this.snapshot.lb = { ...lb }; this.snapshot.retained = retained;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.snapshot.fbo); gl.disable(gl.SCISSOR_TEST);
      gl.blitFramebuffer(0, 0, this.canvas.width, H, 0, 0, this.canvas.width, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    this.timing?.end();
    // One production native-error round trip per frame, deferred to the next frame's start (coordinator
    // decision, K53): it is a renderer diagnostic only (guest GL errors come from the profile's shadow
    // state), and polling here stalls the main thread until the GPU process has drained this frame.
    this.nativeCheckDue = true;
    Object.assign(this.stats, { nativePasses: this.gpu.batch.nativePasses, nativeSubmits: 0,
      mergedPasses: this.gpu.batch.mergedPasses, skippedBinds: this.gpu.batch.skippedBinds, gpuMs: this.timing ? this.timing.lastMs : null });
    this.stats.submitMs = performance.now() - t0;
    return out;
  }

  declare checkpointIndices: CheckpointRenderer['checkpointIndices'];
  declare checkpointStorageBytes: CheckpointRenderer['checkpointStorageBytes'];
  declare inspectTestSurfaces: CheckpointRenderer['inspectTestSurfaces'];
  declare captureTestSurfaces: CheckpointRenderer['captureTestSurfaces'];
  declare readTestLegacyTarget: CheckpointRenderer['readTestLegacyTarget'];
  declare restoreTestSurfaces: (s: CheckpointSurfaces) => void;

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
    const restored = new Promise<void>((resolve, reject) => {
      this.restoredCbs.push(() => resolve());
      // K69: destroy() removes the restore listener; settle the pending simulation instead of hanging it.
      this.cancelSimulatedLoss = () => reject(new Error('WebGL2 renderer destroyed during simulated loss'));
    });
    restored.catch(() => {}); // settled by destroy() possibly before it is awaited below
    try {
      ext.loseContext();
      await new Promise((r) => setTimeout(r, 30));
      if (!this.destroyed) ext.restoreContext();
      await restored;
    } finally { this.cancelSimulatedLoss = undefined; }
  }
  private cancelSimulatedLoss?: () => void;

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
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelSimulatedLoss?.();
    const ext = this.gl.getExtension('WEBGL_lose_context');
    if (!ext || this.gl.isContextLost()) { this.listeners.abort(); return; }
    // Parked until reuse(): the loss event (preventDefault above) makes the context restorable.
    parkedContexts.set(this.canvas, { gl: this.gl, ext, lost: new Promise<boolean>((r) => { this.released = r; }) });
    ext.loseContext();
  }
}
