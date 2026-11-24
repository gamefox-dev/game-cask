// Installed only by deterministic test mode. No native checkpoint code in normal bundles.
import { WebGL2Renderer } from './webgl2/webgl2';
import { WebGPURenderer } from './webgpu/webgpu';
import { RECOVERY_SHADOWS_OFF } from './gpu-texture';
import { paddedReadbackBytes } from '../runtime/savestate-budget';
import type { CheckpointInspection, CheckpointShadows, CheckpointSurfaces } from './checkpoint-surfaces';
import type { Letterbox, Pixels } from './types';
// Inspect executor tables only. Never evaluate WebGPU's lazy native getter.
function inspectWebGL2(this: WebGL2Renderer): CheckpointInspection {
  const textures = [...this.gpu['textures']];
  if(textures.some(([,t])=>t.unshadowed))throw new Error(`Checkpoint needs texture upload shadows: ${RECOVERY_SHADOWS_OFF}`);
  const pixelBytes=this.canvas.width*this.canvas.height*4;
  return {pixelBytes, pixelStagingBytes:pixelBytes, lazy:new Map(textures.flatMap(([h,t])=>t.storage?[]:[[h,t.constants??[]]])),
    shadows:{buffers:[...this.gpu['buffers']].map(([handle,b])=>({handle,shadow:b.data,generated:!!b.generated})),
      textures:textures.map(([handle,t])=>({handle,levels:t.levels,generated:t.generated}))}};
}
function inspectWebGPU(this: WebGPURenderer): CheckpointInspection {
  const textures = [...this.gpu['textures']], screen=this['screen'];
  if(textures.some(([,t])=>t.unshadowed))throw new Error(`Checkpoint needs texture upload shadows: ${RECOVERY_SHADOWS_OFF}`);
  const {width,height}=this.canvas, physical=width*height*4;
  const compose=screen&&!this['snapshot']?physical:0;
  const pixelStagingBytes=Math.max(paddedReadbackBytes(width*4,height)+compose,
    screen?paddedReadbackBytes(screen.width*4,screen.height):0);
  return {pixelBytes:physical+(screen?screen.width*screen.height*4:0),pixelStagingBytes,
    lazy:new Map(textures.flatMap(([h,t])=>t.live?[]:[[h,t.constants??[]]])),
    shadows:{buffers:[...this.gpu.buffers].map(([handle,b])=>({handle,shadow:b.shadow,generated:!!b.generated})),
      textures:textures.map(([handle,t])=>({handle,uploads:t.uploads,generated:t.generated}))}};
}
export async function captureWebGL2Renderer(this: WebGL2Renderer,letterbox: Letterbox,shadows:CheckpointShadows): Promise<CheckpointSurfaces> {
    const g = this['gl'], width = this['canvas'].width, height = this['canvas'].height;
    g.bindFramebuffer(g.FRAMEBUFFER, this['snapshot']?.fbo ?? null);
    const raw = new Uint8Array(width * height * 4), data = new Uint8Array(raw.length);
    g.readPixels(0, 0, width, height, g.RGBA, g.UNSIGNED_BYTE, raw);
    for (let y = 0; y < height; y++) data.set(raw.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);
    g.bindFramebuffer(g.FRAMEBUFFER,null);
    return {physical:{width,height,data},...shadows,retained:!!this['snapshot'],letterbox:{...letterbox}};
  }
export function restoreWebGL2Renderer(this: WebGL2Renderer,s: CheckpointSurfaces): void {
    for(const b of s.buffers) {const native=this.gpu['buffers'].get(b.handle)!;native.data=b.shadow.slice();native.generated=b.generated;native.shared=false;}
    for(const t of s.textures) {const native=this.gpu['textures'].get(t.handle)!;native.levels=structuredClone(t.levels!);native.generated=t.generated?{base:t.generated.base,data:t.generated.data?.slice(),overridden:new Set(t.generated.overridden)}:undefined;}
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


export async function captureWebGPURenderer(this: WebGPURenderer,letterbox: Letterbox,shadows:CheckpointShadows): Promise<CheckpointSurfaces> {
    // K74: §13 frames keep no full-canvas snapshot; the physical image is the retained screen presented with the
    // current letterbox (exactly what an empty frame shows), never a possibly fresh getCurrentTexture().
    const snapshot=this['snapshot'], screen=this['screen'];
    // Do not submit presentation work to the game's live canvas during capture.
    const temp=!snapshot&&screen?this['o'].device.createTexture({size:[this.canvas.width,this.canvas.height],
      format:this['format'],usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}):undefined;
    let physical:Pixels;
    try {
      if(temp&&screen)this['presentTexture'](temp,screen.createView(),letterbox,[0,0,1,1]);
      physical=await this['readback'](snapshot??temp??this['ctx'].getCurrentTexture(),this['format']==='bgra8unorm');
    } finally { temp?.destroy(); }
    const logical = this['screen'] ? await this['readback'](this['screen']) : undefined;
    return {physical,logical,...shadows,retained:!!this['snapshot'],letterbox:{...letterbox}};
  }
export function restoreWebGPURenderer(this: WebGPURenderer,s: CheckpointSurfaces): void {
    // K74: a restored checkpoint copy is private to the executor (the decoder settles its own store).
    for(const b of s.buffers) {const native=this.gpu.buffers.get(b.handle)!;native.shadow=b.shadow.slice();native.generated=b.generated;native.shared=false;}
    for(const t of s.textures) {const native=this.gpu['textures'].get(t.handle)!;native.uploads=structuredClone(t.uploads!);native.generated=t.generated?{base:t.generated.base,source:structuredClone(t.generated.source!),overridden:new Set(t.generated.overridden)}:undefined;}
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


WebGL2Renderer.prototype.checkpointIndices=function(){
  const gpu=this.gpu;
  return {maxElementIndex:gpu['maxElementIndex'],readBuffer(handle){
    const buffer=gpu['buffers'].get(handle);
    return buffer&&!buffer.generated?buffer.data:undefined;
  }};
};
WebGL2Renderer.prototype.checkpointStorageBytes=function(){return (this.stats.vertexBytes??0)+4;}; // legacy 1x1 white
WebGPURenderer.prototype.checkpointStorageBytes=function(){
  const screen=this['screen'];
  return this['o'].vbufSize+(screen&&screen!==this.gpu['screen']?screen.width*screen.height*4:0)+36;
};

WebGL2Renderer.prototype.inspectTestSurfaces=inspectWebGL2;
WebGPURenderer.prototype.inspectTestSurfaces=inspectWebGPU;
WebGL2Renderer.prototype.captureTestSurfaces=captureWebGL2Renderer;
WebGL2Renderer.prototype.restoreTestSurfaces=restoreWebGL2Renderer;
WebGPURenderer.prototype.captureTestSurfaces=captureWebGPURenderer;
WebGPURenderer.prototype.restoreTestSurfaces=restoreWebGPURenderer;
