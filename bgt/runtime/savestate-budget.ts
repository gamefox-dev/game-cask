// Test-only GPU history accounting. CPU backing buffers are counted once per
// graph, not once per view; a view can keep much more than its own length alive.
import { checkpointFrameBytes } from './savestate-recording';
import type { CheckpointFrame } from './savestate-recording';
import type { GPUCheckpoint } from './savestate-gpu';
import type { Renderer } from '../renderers/types';
import type { CheckpointRenderer, CheckpointShadows } from '../renderers/checkpoint-surfaces';
import { TEXEL_BYTES, isDepthFormat, mipExtent, toCanonicalTexture, type CanonicalTexture } from '../renderers/gpu-texture';
import { GPU_OP as O } from './abi';
import { ReplayDrawAllocations, type ReplayIndexSource } from './savestate-draw-budget';

const MiB = 1024 ** 2;
export const GPU_HISTORY_BYTES = 512 * MiB;
// The 400 MiB buffer contract can retain both native data and recovery shadows.
// A bounded workspace additionally allows compaction and restore to overlap
// two such states and one isolated renderer without overwriting the live one.
export const GPU_CAPTURE_BUDGET = { retained: 1024 * MiB, workspace: 3 * 1024 * MiB };
export type GPUCaptureBudget = typeof GPU_CAPTURE_BUDGET;
export class GPUByteLimit extends Error {}
export const checkGPUBytes = (bytes: number, limit: number, area: string) => {
  if (!(bytes <= limit)) throw new GPUByteLimit('Savestate exceeds bounded GPU ' + area + ' bytes');
};

export function checkpointShadowBytes(shadows: CheckpointShadows, seen: Set<ArrayBufferLike>): number {
  // Include command/source data and a conservative per-entry metadata cost.
  let n = 128;
  for (const b of shadows.buffers) n += 96 + backingBytes(b.shadow, seen);
  for (const t of shadows.textures) {
    n += 128;
    for (const data of t.levels ?? []) n += 8 + backingBytes(data, seen);
    for (const u of t.uploads ?? []) n += 96 + u.words.length * 8 + backingBytes(u.data, seen);
    if (t.generated) {
      const {source, data, overridden} = t.generated;
      n += 128 + 16 * overridden.size + backingBytes(data, seen);
      if (source) n += 96 + source.words.length * 8 + backingBytes(source.data, seen);
    }
  }
  return n;
}
export function backingBytes(view: ArrayBufferView | undefined, seen: Set<ArrayBufferLike>): number {
  if (!view || seen.has(view.buffer)) return 0;
  seen.add(view.buffer);
  return view.buffer.byteLength;
}
export function checkpointGPUBytes(base: GPUCheckpoint | null, journal: CheckpointFrame[] = []): number {
  const seen = new Set<ArrayBufferLike>();
  let bytes = 0;
  if (base) {
    const s = base.surfaces;
    bytes = checkpointFrameBytes(base.frame, seen) + checkpointShadowBytes(s, seen) +
      backingBytes(s.physical.data, seen) + backingBytes(s.logical?.data, seen);
  }
  for (const f of journal) bytes += checkpointFrameBytes(f, seen);
  return bytes;
}

export function paddedReadbackBytes(row: number, height: number, depth=1): number {
  return Math.ceil(row/256)*256*height*depth;
}

// Returned texels are charged separately. Depth conversion uses an RGBA32F
// image in addition to the pack buffer (WebGPU) or float pixels (WebGL2).
export function textureReadbackStagingBytes(kind: Renderer['kind'], format: number,
    {width,height,depth}:{width:number;height:number;depth:number}): number {
  const depthConversion=isDepthFormat(format)?width*height*16:0;
  return depthConversion+(kind==='webgpu'?paddedReadbackBytes(width*(depthConversion?16:TEXEL_BYTES[format]),height,depth):width*height*16);
}

// atob ignores ASCII whitespace; bound without decoding into a temporary string.
function payloadLength(data:string|Uint8Array):number {
  return typeof data==='string'?Math.ceil(data.length*3/4):data.byteLength;
}
function vertexStoreBytes(kind:Renderer['kind'],bytes:number):number {
  return kind==='webgl2'||!bytes?bytes:2**Math.ceil(Math.log2(Math.max(1<<20,bytes)));
}

// Shader descriptors and source can outlive the input journal in a parked
// renderer. Replay completion callbacks are released before a cursor parks.
export function replayShaderBytes(item:Record<string,unknown>):number {
  return 96+8*(Array.isArray(item.words)?item.words.length:0)+2*String(item.source??'').length;
}
// Budget the backing stores created inside a replay draw before executing it.
// A post-frame census alone misses create/delete pairs and old+new mip stores.
// Count deletions only at the next census (queued native work can still use them).
export class ReplayAllocations {
  private textures=new Map<number,{desc:CanonicalTexture;mips:number;shadows:Set<number>;used:boolean;generatedBytes:number}>();
  private draws: ReplayDrawAllocations;
  constructor(private kind:Renderer['kind'],indices?:ReplayIndexSource) { this.draws=new ReplayDrawAllocations(kind,indices); }
  restoreShadows(s:CheckpointShadows):void {
    this.draws.restoreBuffers(s.buffers);
    for(const t of this.textures.values()){t.shadows.clear();t.generatedBytes=0;}
    for(const data of s.textures){
      const t=this.textures.get(data.handle);if(!t)continue;
      data.levels?.forEach((level,mip)=>{if(level)t.shadows.add(mip);});
      for(const u of data.uploads??[])t.shadows.add(u.words[1]);
      t.generatedBytes=(data.generated?.data??data.generated?.source?.data)?.byteLength??0;
    }
  }
  frame(f:CheckpointFrame):number {
    this.draws.startFrame();
    // Replay constructs an exact-size CPU vertex arena. The legacy native VBO
    // is respecified on GL or grown by powers of two (minimum 1 MiB) on WebGPU.
    const vertices=payloadLength(f.vertices);
    let allocations=vertices+vertexStoreBytes(this.kind,vertices), staging=typeof f.vertices==='string'?3*vertices:0;
    let decoded=0;
    const level=(t:CanonicalTexture,mip:number)=>{
      const e=mipExtent(t,mip);return e.width*e.height*e.depth*TEXEL_BYTES[t.format];
    };
    const chain=(t:CanonicalTexture,mips:number)=>{
      let bytes=0;for(let mip=0;mip<mips;mip++)bytes+=level(t,mip);return bytes;
    };
    for(const i of f.items) {
      const data=i.kind==='gpu'&&i.op===O.SHADER_CREATE?undefined:i.data;
      if(typeof data==='string'){const bytes=payloadLength(data);decoded+=bytes;staging=Math.max(staging,2*bytes);}
      else if(data instanceof Uint8Array&&((data.byteOffset&7)||!(data.buffer instanceof ArrayBuffer)))decoded+=data.byteLength;
      if(i.kind==='texCreate')allocations+=Number(i.width)*Number(i.height)*4+256;
      if(i.kind==='readback')throw new Error('Unexpected legacy readback in savestate replay');
      if(i.kind!=='gpu'||!Array.isArray(i.words))continue;
      const w=i.words as number[], h=w[0];
      this.draws.command(Number(i.op),w,i.source,i.executeCode?null:data);
      switch(i.op) {
        case O.BUFFER_READBACK:case O.TEXTURE_READBACK:
          throw new Error('Unexpected GPU readback in savestate replay');
        case O.BUFFER_CREATE: {
          const bytes=w[2], native=this.kind==='webgpu'?Math.ceil(bytes/4)*4:bytes;
          allocations+=bytes+native;
          if(this.kind==='webgpu')staging=Math.max(staging,native); // writeBuffer alignment copy
          break;
        }
        case O.BUFFER_UPDATE:
          if(this.kind==='webgpu')staging=Math.max(staging,2*(Math.ceil(w[3]/4)*4+4));
          break;
        case O.BUFFER_COPY: {
          const bytes=w[4];
          if(this.kind==='webgpu'&&(h===w[2]||w[1]%4||w[3]%4||bytes%4))
            allocations+=Math.ceil((bytes+w[1]%4)/4)*4+Math.ceil((bytes+w[3]%4)/4)*4+16;
          staging=Math.max(staging,bytes); // shadow slice on both backends
          break;
        }
        case O.TEXTURE_CREATE:case O.TEXTURE_CREATE_EX: {
          const old=i.op===O.TEXTURE_CREATE;
          const desc=toCanonicalTexture(old?[h,0,w[1],w[2],1,w[3],w[4],w[5]]:w);
          if(!Number.isInteger(desc.mips)||desc.mips<1||desc.mips>32)throw new Error('Invalid replay mip count');
          const mips=old||this.kind==='webgl2'&&desc.dimension!==0?desc.mips:1;
          this.textures.set(h,{desc,mips,shadows:new Set(),used:false,generatedBytes:0});allocations+=chain(desc,mips);break;
        }
        case O.TEXTURE_DELETE:this.textures.delete(h);break;
        case O.TEXTURE: {
          const t=this.textures.get(w[1]);if(t)t.used=true;break;
        }
        case O.TEXTURE_ALLOCATE_MIPS:case O.TEXTURE_GENERATE_MIPS: {
          const t=this.textures.get(h);if(!t)break;
          const n=i.op===O.TEXTURE_ALLOCATE_MIPS?w[1]:t.desc.mips;
          if(!Number.isInteger(n)||n<1||n>t.desc.mips)throw new Error('Invalid replay mip allocation');
          if(n>t.mips){allocations+=chain(t.desc,n);t.mips=n;}
          if(i.op===O.TEXTURE_GENERATE_MIPS) {
            const base=w[1];
            // Zero/lazy chains have no recovery arrays. Non-volume generation
            // copies only when there was a shadow at the source level.
            const volume=this.kind==='webgpu'&&t.desc.dimension===1&&t.used;
            if(t.shadows.has(base)||volume) {
              const baseBytes=level(t.desc,base);
              // The source copy is retained per texture; only the transient
              // overlap with the preceding source is shared across commands.
              allocations+=Math.max(0,baseBytes-t.generatedBytes);
              let generated=Math.min(baseBytes,t.generatedBytes), mipScratch=0;
              t.generatedBytes=baseBytes;
              for(let mip=base+1;mip<n;mip++) {
                const bytes=level(t.desc,mip);
                if(t.shadows.has(mip))generated+=bytes;
                if(!t.shadows.has(mip)){allocations+=bytes;t.shadows.add(mip);}
                // Volumes downsample into a separate array, then copy into
                // the upload shadow. Layered textures generate one layer at a time.
                if(volume)mipScratch+=bytes;
                else if(t.desc.dimension===2)mipScratch=Math.max(mipScratch,bytes/t.desc.depth);
              }
              staging=Math.max(staging,generated+mipScratch);
            } else {
              t.generatedBytes=0;
              for(const mip of t.shadows)if(mip>base)t.shadows.delete(mip);
            }
          }
          break;
        }
        case O.TEXTURE_UPDATE:case O.TEXTURE_UPDATE_EX: {
          const t=this.textures.get(h),mip=w[1];if(!t)break;
          if(!Number.isInteger(mip)||mip<0||mip>=t.desc.mips)throw new Error('Invalid replay upload mip');
          if(this.kind==='webgpu'&&isDepthFormat(t.desc.format)) {
            const at=i.op===O.TEXTURE_UPDATE?4:5;
            allocations+=32*w[at]*w[at+1]; // RGBA32F conversion image and JS texels
          }
          // Older recordings can express implicit allocation with an upload.
          if(mip>=t.mips){allocations+=chain(t.desc,mip+1);t.mips=mip+1;}
          if(!t.shadows.has(mip)){t.shadows.add(mip);allocations+=level(t.desc,mip);}
          t.used=true;break;
        }
        case O.BLIT: {
          const [src,sm,dst]=w, mask=w[12];
          const [sx,sy,sx2,sy2,dx,dy,dx2,dy2]=w.slice(4,12).map(n=>n|0);
          if(!w[16]||!w[17]||sx===sx2||sy===sy2||dx===dx2||dy===dy2)break;
          const from=this.textures.get(src)?.desc, to=this.textures.get(dst)?.desc;
          const {width,height}=from?mipExtent(from,sm):{width:f.logicalW,height:f.logicalH};
          const area=width*height, self=src===dst?area*TEXEL_BYTES[from?.format??0]:0;
          if(this.kind==='webgpu') {
            const dest=to&&mipExtent(to,w[3]);
            const fullStencilCopy=src!==dst&&from?.format===5&&to?.format===5&&mask===6&&dest&&
              sx===0&&sy===0&&dx===0&&dy===0&&sx2===width&&sy2===height&&dx2===width&&dy2===height&&
              dest.width===width&&dest.height===height&&w[14]===0&&w[15]===0&&w[16]>=width&&w[17]>=height;
            // Submitted together at the frame boundary; keep all temporary
            // source copies and all eight stencil planes in the reservation.
            allocations+=self+32+((mask&4)&&!fullStencilCopy?8*area:0);
          } else {
            const fallback=(mask&4)&&((sx2-sx)!==(dx2-dx)||(sy2-sy)!==(dy2-dy));
            staging=Math.max(staging,self+(fallback?area:0));
          }
          break;
        }
        case O.SHADER_CREATE:allocations+=replayShaderBytes(i);break;
      }
    }
    return allocations+decoded+staging+this.draws.endFrame();
  }
}

// Detachment is additional to the executing renderer. Count resources, canvas,
// recovery copies, pool/scratch and reserve even the detached lazy levels. The
// replay cursor adds legacy textures and shader sources from the command stream.
export function detachedRendererBytes(r: Renderer & CheckpointRenderer): number {
  const m = r.gpu?.memory?.();
  return r.canvas.width * r.canvas.height * 8 + (r.presentationBytes?.() ?? 0) + (r.checkpointStorageBytes?.() ?? 0) + (m ?
    m.buffers.nativeBytes + m.textures.bytes + (m.textures.lazy?.bytes ?? 0) + m.renderbuffers.bytes + m.internal.bytes +
    m.shadows.bufferBytes + (m.shadows.sharedBufferBytes ?? 0) + m.shadows.textureBytes : 0);
}
