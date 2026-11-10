// Installed only by deterministic test mode. No native checkpoint code in normal bundles.
import { WebGL2Renderer } from './webgl2/webgl2';
import { WebGPURenderer } from './webgpu/webgpu';
import type { CheckpointSurfaces } from './checkpoint-surfaces';
import type { Letterbox, Pixels } from './types';
  /** Only called by the opt-in test checkpoint controller on a temporary renderer. */
export async function captureWebGL2Renderer(this: WebGL2Renderer,letterbox: Letterbox): Promise<CheckpointSurfaces> {
    const g = this['gl'], width = this['canvas'].width, height = this['canvas'].height;
    g.bindFramebuffer(g.FRAMEBUFFER, this['snapshot']?.fbo ?? null);
    const raw = new Uint8Array(width * height * 4), data = new Uint8Array(raw.length);
    g.readPixels(0, 0, width, height, g.RGBA, g.UNSIGNED_BYTE, raw);
    for (let y = 0; y < height; y++) data.set(raw.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);
    g.bindFramebuffer(g.FRAMEBUFFER,null);
    const buffers=[...this.gpu['buffers']].map(([handle,b])=>({handle,shadow:b.data.slice(),generated:!!b.generated}));
    return {physical:{width,height,data},buffers,retained:!!this['snapshot'],letterbox:{...letterbox}};
  }
export function restoreWebGL2Renderer(this: WebGL2Renderer,s: CheckpointSurfaces): void {
    for(const b of s.buffers) {const native=this.gpu['buffers'].get(b.handle)!;native.data=b.shadow.slice();native.generated=b.generated;}
    const g = this['gl'], {width,height,data} = s.physical, raw = new Uint8Array(data.length);
    for (let y = 0; y < height; y++) raw.set(data.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);
    const texture = this['makeTexture'](width,height), fbo = g.createFramebuffer()!;
    g.bindTexture(g.TEXTURE_2D,texture); g.texSubImage2D(g.TEXTURE_2D,0,0,0,width,height,g.RGBA,g.UNSIGNED_BYTE,raw);
    g.bindFramebuffer(g.READ_FRAMEBUFFER,fbo);
    g.framebufferTexture2D(g.READ_FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,texture,0);
    g.bindFramebuffer(g.DRAW_FRAMEBUFFER,null); g.disable(g.SCISSOR_TEST);
    g.blitFramebuffer(0,0,width,height,0,0,width,height,g.COLOR_BUFFER_BIT,g.NEAREST);
    if (this['snapshot']) { g.deleteTexture(this['snapshot'].texture); g.deleteFramebuffer(this['snapshot'].fbo); }
    this['snapshot'] = s.retained ? {texture,fbo,w:width,h:height,lb:{...s.letterbox}} : undefined;
    if (!s.retained) { g.deleteTexture(texture); g.deleteFramebuffer(fbo); }
    g.bindFramebuffer(g.FRAMEBUFFER,null);
  }


  /** Only called by the opt-in test checkpoint controller on a temporary renderer. */
export async function captureWebGPURenderer(this: WebGPURenderer,letterbox: Letterbox): Promise<CheckpointSurfaces> {
    const physical = await this['readback'](this['snapshot'] ?? this['ctx'].getCurrentTexture(),this['format'] === 'bgra8unorm');
    const logical = this['screen'] ? await this['readback'](this['screen']) : undefined;
    const buffers=[...this.gpu.buffers].map(([handle,b])=>({handle,shadow:b.shadow.slice(),generated:!!b.generated}));
    return {physical,logical,buffers,retained:!!this['snapshot'],letterbox:{...letterbox}};
  }
export function restoreWebGPURenderer(this: WebGPURenderer,s: CheckpointSurfaces): void {
    for(const b of s.buffers) {const native=this.gpu.buffers.get(b.handle)!;native.shadow=b.shadow.slice();native.generated=b.generated;}
    const {device} = this['o'];
    const upload = (p: Pixels, format: GPUTextureFormat, usage: number) => {
      const t = device.createTexture({size:[p.width,p.height],format,usage:usage|GPUTextureUsage.COPY_DST});
      const data = p.data.slice();
      if (format === 'bgra8unorm') for (let i=0;i<data.length;i+=4) { const r=data[i];data[i]=data[i+2];data[i+2]=r; }
      device.queue.writeTexture({texture:t},data,{bytesPerRow:p.width*4},[p.width,p.height]); return t;
    };
    this['snapshot']?.destroy(); this['screen']?.destroy();
    this['screen'] = s.logical ? upload(s.logical,'rgba8unorm',GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC) : undefined;
    const physical = upload(s.physical,this['format'],GPUTextureUsage.COPY_SRC|GPUTextureUsage.TEXTURE_BINDING);
    const encoder=device.createCommandEncoder();
    encoder.copyTextureToTexture({texture:physical},{texture:this['ctx'].getCurrentTexture()},[s.physical.width,s.physical.height]);
    device.queue.submit([encoder.finish()]);
    this['snapshot'] = s.retained ? physical : undefined; this['snapshotLB'] = s.retained ? {...s.letterbox} : undefined;
    if (!s.retained) physical.destroy();
  }


WebGL2Renderer.prototype.captureTestSurfaces=captureWebGL2Renderer;
WebGL2Renderer.prototype.restoreTestSurfaces=restoreWebGL2Renderer;
WebGPURenderer.prototype.captureTestSurfaces=captureWebGPURenderer;
WebGPURenderer.prototype.restoreTestSurfaces=restoreWebGPURenderer;
