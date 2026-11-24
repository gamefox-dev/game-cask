// Test-only GPU history accounting. CPU backing buffers are counted once per
// graph, not once per view; a view can keep much more than its own length alive.
import { checkpointFrameBytes } from './savestate-recording';
import type { CheckpointFrame } from './savestate-recording';
import type { GPUCheckpoint } from './savestate-gpu';
import type { Renderer } from '../renderers/types';
import type { CheckpointShadows } from '../renderers/checkpoint-surfaces';
import { TEXEL_BYTES, isDepthFormat, mipExtent, toCanonicalTexture, type CanonicalTexture } from '../renderers/gpu-texture';
import { GPU_OP as O } from './abi';

const MiB = 1024 ** 2;
export const GPU_HISTORY_BYTES = 512 * MiB;
// The 400 MiB buffer contract can retain both native data and recovery shadows.
// A bounded workspace additionally allows compaction and restore to overlap
// two such states and one isolated renderer without overwriting the live one.
export const GPU_CAPTURE_BUDGET = { retained: 1024 * MiB, workspace: 3 * 1024 * MiB };
export type GPUCaptureBudget = typeof GPU_CAPTURE_BUDGET;
export const checkGPUBytes = (bytes: number, limit: number, area: string) => {
  if (!(bytes <= limit)) throw new Error('Savestate exceeds bounded GPU ' + area + ' bytes');
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

// Budget the backing stores created inside a replay draw before executing it.
// A post-frame census alone misses create/delete pairs and old+new mip stores.
// Count deletions only at the next census (queued native work can still use them).
export class ReplayAllocations {
  private textures=new Map<number,{desc:CanonicalTexture;mips:number}>();
  constructor(private kind:Renderer['kind']) {}
  frame(f:CheckpointFrame):number {
    let allocations=0, staging=0;
    const uploads=new Map<number,Set<number>>();
    const level=(t:CanonicalTexture,mip:number)=>{
      const e=mipExtent(t,mip);return e.width*e.height*e.depth*TEXEL_BYTES[t.format];
    };
    const chain=(t:CanonicalTexture,mips:number)=>{
      let bytes=0;for(let mip=0;mip<mips;mip++)bytes+=level(t,mip);return bytes;
    };
    for(const i of f.items) {
      if(i.kind==='texCreate')allocations+=Number(i.width)*Number(i.height)*4+256;
      if(i.kind!=='gpu'||!Array.isArray(i.words))continue;
      const w=i.words as number[], h=w[0];
      switch(i.op) {
        case O.BUFFER_CREATE: {
          const bytes=w[2], native=this.kind==='webgpu'?Math.ceil(bytes/4)*4:bytes;
          allocations+=bytes+native;
          if(this.kind==='webgpu')staging=Math.max(staging,native); // writeBuffer alignment copy
          break;
        }
        case O.BUFFER_UPDATE:
          if(this.kind==='webgpu')staging=Math.max(staging,2*(Math.ceil(w[3]/4)*4+4));
          break;
        case O.BUFFER_COPY:staging=Math.max(staging,2*(Math.ceil(w[4]/4)*4+4));break;
        case O.TEXTURE_CREATE:case O.TEXTURE_CREATE_EX: {
          const old=i.op===O.TEXTURE_CREATE;
          const desc=toCanonicalTexture(old?[h,0,w[1],w[2],1,w[3],w[4],w[5]]:w);
          if(!Number.isInteger(desc.mips)||desc.mips<1||desc.mips>32)throw new Error('Invalid replay mip count');
          const mips=old||this.kind==='webgl2'&&desc.dimension!==0?desc.mips:1;
          this.textures.set(h,{desc,mips});uploads.delete(h);allocations+=chain(desc,mips);break;
        }
        case O.TEXTURE_DELETE:this.textures.delete(h);uploads.delete(h);break;
        case O.TEXTURE_ALLOCATE_MIPS:case O.TEXTURE_GENERATE_MIPS: {
          const t=this.textures.get(h);if(!t)break;
          const n=i.op===O.TEXTURE_ALLOCATE_MIPS?w[1]:t.desc.mips;
          if(!Number.isInteger(n)||n<1||n>t.desc.mips)throw new Error('Invalid replay mip allocation');
          if(n>t.mips){allocations+=chain(t.desc,n);t.mips=n;}
          // A generated chain may own new recovery copies even without mip growth.
          if(i.op===O.TEXTURE_GENERATE_MIPS)allocations+=chain(t.desc,n);
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
          let levels=uploads.get(h);if(!levels)uploads.set(h,levels=new Set());
          if(!levels.has(mip)){levels.add(mip);allocations+=level(t.desc,mip);}
          break;
        }
        case O.SHADER_CREATE:allocations+=96+String(i.source??'').length*2;break;
      }
    }
    return allocations+staging;
  }
}

// Detachment is additional to the executing renderer. Count resources, canvas,
// recovery copies, pool/scratch and reserve even the detached lazy levels. The
// replay cursor adds legacy textures and shader sources from the command stream.
export function detachedRendererBytes(r: Renderer): number {
  const m = r.gpu?.memory?.();
  return r.canvas.width * r.canvas.height * 8 + (r.presentationBytes?.() ?? 0) + (m ?
    m.buffers.nativeBytes + m.textures.bytes + (m.textures.lazy?.bytes ?? 0) + m.renderbuffers.bytes + m.internal.bytes +
    m.shadows.bufferBytes + (m.shadows.sharedBufferBytes ?? 0) + m.shadows.textureBytes : 0);
}
