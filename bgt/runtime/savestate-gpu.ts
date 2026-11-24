// Opt-in checkpoint materialization. Guest code is never re-executed.
// A base at a frame boundary + <=2 updates of original commands preserves dependencies,
// including resources deleted/reused later in the suffix. No end-of-suffix shadows.
import { GPU_OP as O } from './abi';
import { Frame, type FrameItem } from './commands';
import { TEXEL_BYTES, canonicalize, mipExtent, toCanonicalTexture } from '../renderers/gpu-texture';
import {recordCheckpointFrame,CheckpointReplay,checkpointFrameBytes,type CheckpointFrame} from './savestate-recording';
import { GPUByteLimit, ReplayAllocations, checkpointShadowBytes, detachedRendererBytes, paddedReadbackBytes, textureReadbackStagingBytes } from './savestate-budget';
import { cloneCheckpoint } from './savestate-clone';
import { decodeBytes } from '../renderers/recording';
import type { Renderer, GpuItem } from '../renderers/types';
import type { CheckpointRenderer, CheckpointSurfaces } from '../renderers/checkpoint-surfaces';

// Null means unavailable, NOT the native texture's freshly initialized value.
// Persist this proof alongside the base so repeated compaction cannot invent constants.
type PackedConstants = [number | null, number | null][];

export interface GPUCheckpoint { frame: CheckpointFrame; surfaces: CheckpointSurfaces; nativeBytes?:number }
export const RESIDUAL_UPDATES = 2;
export const RESIDUAL_COMMANDS = 100000;
interface Texture {
  item: GpuItem; allocated: number; constants: PackedConstants;
  /** RGBA8 mip levels whose upload shadow is proven equal to native bytes. */
  exactUploads: Set<number>;
}
interface Resources {
  buffers: Map<number,GpuItem>; textures: Map<number,Texture>; samplers: Map<number,GpuItem>;
  shaders: Map<number,GpuItem>; pipelines: Map<number,GpuItem>; feedback: Map<number,GpuItem>;
  legacy: Map<number,{item: Extract<FrameItem,{kind:'texCreate'}>; updates: Extract<FrameItem,{kind:'texUpdate'}>[]}>;
}
type TextureShadow = CheckpointSurfaces['textures'][number];
const mipShadow=(shadow:TextureShadow|undefined,mip:number)=>shadow?.levels?.[mip]??shadow?.uploads?.find(u=>u.words[1]===mip)?.data;
const emptyResources=():Resources=>({buffers:new Map(),textures:new Map(),samplers:new Map(),shaders:new Map(),pipelines:new Map(),feedback:new Map(),legacy:new Map()});
function resources(records: CheckpointFrame[], base: GPUCheckpoint|null = null, r=emptyResources(), metadataOnly=false): Resources {
  let pass: {handle:number;mip:number;fullScissor:boolean;width:number;height:number} | undefined;
  let pipeline: GpuItem | undefined;
  const allocate=(t:Texture,n:number)=>{
    while(t.constants.length<n)t.constants.push([0x3f800000,0]);
    t.allocated=n;
  };
  const invalidate=(h:number,mip:number,mask:number)=>{
    const t=r.textures.get(h),c=t?.constants[mip];
    if(t?.item.words[6]===5 && c) {if(mask&1)c[0]=null;if(mask&2)c[1]=null;}
  };
  const noteUpload=(t:Texture,mip:number,w:number[])=>{
    const e=mipExtent(toCanonicalTexture(t.item.words),mip);
    if(t.item.words[6]===0&&!w[2]&&!w[3]&&!w[4]&&w[5]===e.width&&w[6]===e.height&&w[7]===e.depth)t.exactUploads.add(mip);
  };
  for (const record of records) {
   // Provenance never consumes the upload bytes. Don't decode/realign them
   // here, before the replay workspace preflight.
   for (const item of record.items as unknown as FrameItem[]) {
    // Failed creations reserve failed shader/pipeline objects; failed mutations have no effect.
    const code=(item as unknown as {executeCode?:number}).executeCode;
    if(code && item.kind==='gpu' && item.op!==O.SHADER_CREATE && item.op!==O.PIPELINE_CREATE)
      throw new Error('Unsupported savestate GPU failed mutation: '+item.op+' ('+code+')');
    if (item.kind === 'texCreate') r.legacy.set(item.handle,{item,updates:[]});
    if (item.kind === 'texDelete') r.legacy.delete(item.handle);
    if (item.kind === 'texUpdate'&&!metadataOnly) r.legacy.get(item.handle)!.updates.push(item);
    if (item.kind !== 'gpu') continue;
    const {op,words:w}=canonicalize(item.op,item.words), h=w[0], it={...item,op,words:w};
    switch(op) {
      case O.BUFFER_CREATE:delete it.data;r.buffers.set(h,it);break;
      case O.BUFFER_DELETE:r.buffers.delete(h);break;
      case O.TEXTURE_CREATE_EX: {
        const t:Texture={item:it,allocated:0,constants:[],exactUploads:new Set()};
        allocate(t,item.op===O.TEXTURE_CREATE?w[5]:1);r.textures.set(h,t);break;
      }
      case O.TEXTURE_ALLOCATE_MIPS: {const t=r.textures.get(h)!;allocate(t,Math.max(t.allocated,w[1]));break;}
      case O.TEXTURE_GENERATE_MIPS: {
        const t=r.textures.get(h)!;allocate(t,t.item.words[5]);
        for(let mip=w[1]+1;mip<t.allocated;mip++){t.exactUploads.delete(mip);invalidate(h,mip,3);}break;
      }
      case O.TEXTURE_DELETE:r.textures.delete(h);break;
      case O.SAMPLER_CREATE_EX:r.samplers.set(h,it);break;
      case O.SAMPLER_DELETE:r.samplers.delete(h);break;
      // Shader completion may still be in flight when entering metadata-only
      // mode. Keep the actual record so its eventual outcome isn't lost.
      case O.SHADER_CREATE:r.shaders.set(h,item);break;
      case O.SHADER_DELETE:r.shaders.delete(h);break;
      case O.PIPELINE_CREATE:r.pipelines.set(h,it);break;
      case O.PIPELINE_DELETE:r.pipelines.delete(h);r.feedback.delete(h);break;
      case O.FEEDBACK_VARYINGS:r.feedback.set(h,it);break;
      case O.PASS_BEGIN: {
        // Conservative: even a LOAD-only pass can write color via draw or clear.
        for(let c=0;c<w[0];c++)r.textures.get(w[7+c*7])?.exactUploads.delete(w[8+c*7]);
        const t=r.textures.get(w[1]),e=t?mipExtent(toCanonicalTexture(t.item.words),w[2]):null;
        pass={handle:w[1],mip:w[2],fullScissor:true,width:e?.width??0,height:e?.height??0};pipeline=undefined;
        const c=t?.constants[w[2]];
        if(c) {if(w[3]===1)c[0]=w[5];if(w[4]===1)c[1]=w[6];}break;
      }
      case O.PIPELINE:pipeline=r.pipelines.get(h);break;
      case O.SCISSOR:if(pass)pass.fullScissor=!w[0]&&!w[1]&&w[2]===pass.width&&w[3]===pass.height;break;
      case O.CLEAR_BUFFER:if(pass) {
        const kind=h&3,depth=(kind===1||kind===3)&&!!(h&16),stencil=kind>=2?(h>>>8)&255:0;
        const c=r.textures.get(pass.handle)?.constants[pass.mip];
        if(c) {
          if(depth)c[0]=pass.fullScissor?w[2]:null;
          if(stencil)c[1]=pass.fullScissor&&stencil===255?w[kind===3?3:2]:null;
        }
      }break;
      case O.DRAW:case O.DRAW_INDEXED:if(pass) {
        // No coverage, depth-test outcome, face or shader-output assumptions.
        const p=pipeline?.words;
        const stencil=!p || !!p[10]&&!!p[12]&&[14,15,16,18,19,20].some(i=>p[i]!==0);
        invalidate(pass.handle,pass.mip,(!p||p[8]?1:0)|(stencil?2:0));
      }break;
      case O.PASS_END:pass=undefined;pipeline=undefined;break;
      case O.TEXTURE_UPDATE_EX:noteUpload(r.textures.get(h)!,w[1],w);invalidate(h,w[1],3);break;
      case O.BLIT:
        if(w[12]&1)r.textures.get(w[2])?.exactUploads.delete(w[3]);
        invalidate(w[2],w[3],(w[12]>>>1)&3);break;
    }
   }
   // A synthetic base can re-upload native bytes and restore different recovery
   // shadows. Keep the proof only where both payloads actually alias. Old or
   // streamed checkpoints may not carry the alias: fall back to native reads.
   if(record===base?.frame) {
     const shadows=new Map(base.surfaces.textures.map(t=>[t.handle,t]));
     for(const t of r.textures.values())t.exactUploads.clear();
     for(const item of record.items)if(item.op===O.TEXTURE_UPDATE_EX&&Array.isArray(item.words)&&item.data instanceof Uint8Array) {
       const [h,mip]=item.words as number[];
       if(item.data===mipShadow(shadows.get(h),mip))noteUpload(r.textures.get(h)!,mip,item.words as number[]);
     }
   }
   // Synthetic base creation initializes the native allocation, but does not prove
   // unknown pre-cut aspects. These exact constants/unknowns override that initialization.
   for(const [h,constants] of (record as CheckpointFrame).packedConstants??[]) {
     const t=r.textures.get(h);if(!t||t.item.words[6]!==5||constants.length!==t.allocated)throw new Error('Invalid packed checkpoint provenance');
     t.constants=structuredClone(constants);
   }
  }
  return r;
}
/** Prove every UNKNOWN pre-cut aspect dies or resets before any consumption.
 * Known constants are materialized exactly at the cut, not read back or inferred
 * from end-of-suffix data. Partial uploads, blits and sampling are not reset proofs. */
export function proveResidual(prefix: CheckpointFrame[], residual: CheckpointFrame[]): void {
  checkResidual(resources(prefix),residual);
}
function checkResidual(r: Resources,residual: CheckpointFrame[]): void {
  const pending=new Map<number,Map<number,number>>();
  for(const [h,t] of r.textures) if(t.item.words[6]===5) pending.set(h,new Map(t.constants.map((c,i)=>[i,(c[0]===null?1:0)|(c[1]===null?2:0)])));
  let pass:{handle:number;mip:number;fullScissor:boolean;width:number;height:number}|undefined;
  const reset=(h:number,mip:number,aspects:number)=>{const p=pending.get(h);if(p)p.set(mip,(p.get(mip)??0)&~aspects);};
  const touch=(h:number,mip?:number) => {
    const p=pending.get(h);
    if(p && (mip===undefined ? [...p.values()].some(Boolean) : p.get(mip))) throw new Error('Unsupported savestate GPU provenance: packed depth/stencil '+h+' consumed before full clear');
  };
  for(const record of residual) for(const item of record.items as unknown as FrameItem[]) {
    if(item.kind!=='gpu') continue;
    const code=(item as unknown as {executeCode?:number}).executeCode;
    if(code && item.op!==O.SHADER_CREATE && item.op!==O.PIPELINE_CREATE)
      throw new Error('Unsupported savestate GPU failed mutation: '+item.op+' ('+code+')');
    const {op,words:w}=canonicalize(item.op,item.words),h=w[0];
    switch(op) {
      case O.TEXTURE_CREATE_EX:r.textures.set(h,{item:{...item,op,words:w},allocated:1,constants:[],exactUploads:new Set()});break;
      case O.TEXTURE_DELETE:pending.delete(h);r.textures.delete(h);break;
      case O.PASS_BEGIN: {
        const t=r.textures.get(w[1]),e=t?mipExtent(toCanonicalTexture(t.item.words),w[2]):null;
        pass={handle:w[1],mip:w[2],fullScissor:true,width:e?.width??0,height:e?.height??0};
        if(w[1])reset(w[1],w[2],(w[3]===1?1:0)|(w[4]===1?2:0));
        break;
      }
      case O.SCISSOR:if(pass)pass.fullScissor=!w[0]&&!w[1]&&w[2]===pass.width&&w[3]===pass.height;break;
      case O.CLEAR_BUFFER:if(pass?.fullScissor) {
        const kind=h&3,depth=!!(h&16),stencil=(h>>>8)&255;
        if(kind===1&&depth || kind===3&&depth)reset(pass.handle,pass.mip,1);
        if((kind===2||kind===3)&&stencil===255)reset(pass.handle,pass.mip,2);
      }break;
      case O.DRAW:case O.DRAW_INDEXED:if(pass)touch(pass.handle,pass.mip);break;
      case O.PASS_END:pass=undefined;break;
      case O.TEXTURE:touch(w[1]);break;
      case O.TEXTURE_READBACK:touch(h,w[1]);break;
      case O.TEXTURE_UPDATE_EX: {
        const t=r.textures.get(h),e=t?mipExtent(toCanonicalTexture(t.item.words),w[1]):null;
        if(e && !w[2]&&!w[3]&&!w[4]&&w[5]===e.width&&w[6]===e.height&&w[7]===e.depth)reset(h,w[1],3);
        else touch(h,w[1]);break;
      }
      case O.TEXTURE_GENERATE_MIPS:touch(h);break;
      case O.BLIT:touch(h,w[1]);touch(w[2],w[3]);break;
    }
  }
  if([...pending.values()].some(p=>[...p.values()].some(Boolean))) throw new Error('Unsupported savestate GPU provenance: no full packed depth/stencil clear within two updates');
}
export class ReplayCursor {
  readonly replay: CheckpointReplay;
  private legacy = new Map<number,number>();
  private shaders = new Map<number,number>();
  private extraBytes = 0;
  private allocations: ReplayAllocations;
  constructor(readonly renderer: Renderer & CheckpointRenderer) {
    this.replay=new CheckpointReplay(renderer);this.allocations=new ReplayAllocations(renderer.kind,renderer.checkpointIndices?.());
  }
  bytes():number { return detachedRendererBytes(this.renderer)+this.extraBytes; }
  restoreSurfaces(s:CheckpointSurfaces):void {
    this.renderer.restoreTestSurfaces(s);this.allocations.restoreShadows(s);
  }
  async draw(frame:CheckpointFrame, check:(extra:number)=>void, finish?:boolean):Promise<void> {
    const {canvas}=this.renderer, resize=canvas.width!==frame.width||canvas.height!==frame.height;
    const pixels=frame.width*frame.height*4;
    // Compose/snapshot can allocate while the previous frame's surfaces exist.
    check(this.allocations.frame(frame)+(resize?2*pixels:0)+pixels+frame.logicalW*frame.logicalH*4);
    const set=(map:Map<number,number>,h:number,n:number)=>{this.extraBytes+=n-(map.get(h)??0);if(n)map.set(h,n);else map.delete(h);};
    for(const i of frame.items) {
      if(i.kind==='texCreate')set(this.legacy,Number(i.handle),Number(i.width)*Number(i.height)*4+256);
      if(i.kind==='texDelete')set(this.legacy,Number(i.handle),0);
      if(i.kind==='gpu'&&Array.isArray(i.words)) {
        if(i.op===O.SHADER_CREATE)set(this.shaders,i.words[0],96+String(i.source??'').length*2);
        if(i.op===O.SHADER_DELETE)set(this.shaders,i.words[0],0);
      }
    }
    await this.replay.draw(frame,finish);
  }
}
async function advanceReplay(cursor: ReplayCursor, base: GPUCheckpoint | null, journal: CheckpointFrame[], check:(extra:number)=>void): Promise<void> {
  const {renderer,replay}=cursor;
  replay.check();check(0);
  if(base) {
    await cursor.draw(base.frame,check);
    const s=base.surfaces;
    const pixels=s.physical.data.byteLength+(s.logical?.data.byteLength??0);
    // Restore copies shadows and uploads new surfaces while the synthetic
    // base's executor resources and the checkpoint payloads are still owned.
    check(checkpointShadowBytes(s,new Set())+2*pixels);
    cursor.restoreSurfaces(s);check(0);
  }
  // WebGPU canvas current textures are invalidated at task boundaries. A fixed
  // GPU fence every batch bounds queued work without a per-frame GPU/CPU rendezvous.
  for(let i=0;i<journal.length;i++) {await cursor.draw(journal[i],check,(i+1)%16===0||i===journal.length-1);check(0);}
  if(base&&!journal.length)await renderer.finish();
  replay.check();
}
export async function replayGPU(renderer: Renderer & CheckpointRenderer, base: GPUCheckpoint | null, journal: CheckpointFrame[], check:(bytes:number)=>void): Promise<void> {
  const cursor=new ReplayCursor(renderer);
  try {await advanceReplay(cursor,base,journal,extra=>check(cursor.bytes()+extra));} finally {cursor.replay.stop();}
}
type CaptureCheck=(nextBase:number,staging:number,residual:CheckpointFrame[],keepReplay:boolean)=>void;
type ReplayFactory=()=>Promise<{cursor:ReplayCursor;atBase:boolean}>;
type CheckpointSource=Renderer & CheckpointRenderer;

// Bounded, live-end-only recovery after the replay journal no longer fits.
// No discarded pixel/vertex/upload bytes or renderer are held. Legacy textures
// cannot be rebuilt from this recipe; their deletion/replacement or restoring
// an earlier snapshot is required. Packed aspects still need exact constants.
export class LiveGPUCut {
  private r=emptyResources();
  constructor(base:GPUCheckpoint|null, journal:CheckpointFrame[]) {
    resources(base?[base.frame,...journal]:journal,base,this.r,true);
  }
  append(frame:CheckpointFrame):void {resources([frame],null,this.r,true);}
  bytes():number {
    const r=this.r;
    let n=128+128*r.legacy.size;
    for(const map of [r.buffers,r.samplers,r.shaders,r.pipelines,r.feedback])
      for(const i of map.values())n+=128+8*i.words.length+2*(i.source?.length??0);
    for(const t of r.textures.values())n+=256+32*t.constants.length+16*t.exactUploads.size;
    return n;
  }
  async capture(live:CheckpointSource, at:CheckpointFrame, check:CaptureCheck) {
    if(this.r.legacy.size)throw new Error('Savestate live recovery requires deletion of legacy textures');
    checkResidual(this.r,[]);
    return captureCut(this.r,at,[],live,undefined,check,0,0);
  }
}

export async function compactGPU(getReplay:ReplayFactory, base: GPUCheckpoint | null,
    journal: CheckpointFrame[], live:CheckpointSource, check:CaptureCheck, releaseReplay=()=>{}) {
  if(!journal.length&&base)return {base,journal,keepReplay:true,stats:{nativeBytes:base.nativeBytes??0,residualCommands:0,residualUpdates:0,replayFrames:0,replayMs:0,readbackMs:0,readbackBytes:0,provenanceMs:0}};
  const proofAt=performance.now(),last=journal.at(-1) ?? base?.frame;
  if(!last) return {base,journal,keepReplay:false,stats:{nativeBytes:0,residualCommands:0,residualUpdates:0,replayFrames:0,replayMs:0,readbackMs:0,readbackBytes:0,provenanceMs:0}};
  const earliest=last.update-RESIDUAL_UPDATES+1;
  const candidates=[...journal.keys()].filter(i=>journal[i].update>=earliest && (!i || journal[i-1].update!==journal[i].update));
  // Try the live end cut first, including packed textures with proven constants.
  candidates.push(journal.length);
  let failure:unknown, budgetFailure:unknown;
  for(const i of candidates.reverse()) {
    // After a budget refusal, recreating the old base without consuming any
    // journal entry cannot free retained space. It is not a pressure cut.
    if(!i&&base&&budgetFailure)continue;
    const tail=journal.slice(i);
    if(tail.reduce((n,f)=>n+f.items.length,0)>RESIDUAL_COMMANDS) continue;
    const prefix=journal.slice(0,i);
    let r:Resources;
    try {
      r=resources([...(base?[base.frame]:[]),...prefix],base);
      // Residual proof changes the handle->descriptor map as resources are reused.
      checkResidual({...r,textures:new Map(r.textures)},tail);
    } catch(e) {failure=e;continue;}
    const at=prefix.at(-1)??base?.frame??journal[0];
    const replayStart=performance.now(),provenanceMs=replayStart-proofAt;
    const legacyTargets=[...r.legacy.values()].some(t=>t.item.renderTarget);
    let cursor:ReplayCursor|undefined;
    try {
      if(i!==journal.length||legacyTargets){
        const state=await getReplay();cursor=state.cursor;
        await advanceReplay(cursor,state.atBase?null:base,prefix,extra=>check(0,extra,tail,false));
      }
      return await captureCut(r,at,tail,cursor?.renderer??live,cursor,check,provenanceMs,cursor?performance.now()-replayStart:0,prefix.length);
    } catch(e) {
      if(!(e instanceof GPUByteLimit))throw e;
      budgetFailure=e;
      if(cursor)releaseReplay(); // an earlier cut cannot use this advanced cursor
    }
  }
  throw budgetFailure ?? failure ?? new Error('Unsupported savestate GPU residual exceeds command/update bound');
}

async function captureCut(r:Resources,at:CheckpointFrame,residual:CheckpointFrame[],source:CheckpointSource,
    cursor:ReplayCursor|undefined,check:CaptureCheck,provenanceMs:number,replayMs:number,replayFrames=0) {
  const readAt=performance.now();
  const {shadows,lazy,pixelBytes,pixelStagingBytes}=source.inspectTestSurfaces();
  const textureShadows=new Map(shadows.textures.map(t=>[t.handle,t]));
  const exactUploads: [GpuItem,number,number][]=[];
  const fillLegacy:(()=>void)[]=[];
  const frame=new Frame();frame.reset(at.logicalW,at.logicalH);
  const reads=new Frame();reads.reset(at.logicalW,at.logicalH);
  const pending: Promise<void>[]=[];
  let nativeBytes=pixelBytes,readbackBytes=pixelBytes,readBytes=0,legacyBytes=0,stagingBytes=pixelStagingBytes;
  const read=(item: FrameItem, bytes:number, staging:number, complete:(data:Uint8Array<ArrayBuffer>)=>void) => {
    readBytes+=bytes;stagingBytes+=staging;
    pending.push(new Promise<void>((resolve,reject)=>{
      const done=(data?:Uint8Array<ArrayBuffer>,error?:number) => {if(!data||error||data.length!==bytes)reject(new Error('Savestate native readback failed: '+error));else {try{nativeBytes+=data.length;readbackBytes+=data.length;complete(data);resolve();}catch(e){reject(e);}}};
      if(item.kind==='gpu') item.readback=done;
      else if(item.kind==='readback') item.complete=done;
      reads.items.push(item);
    }));
  };
  for(const [h,b] of r.buffers) {
    const create={...b,words:[h,b.words[1],b.words[2],0,b.words[2]]};frame.items.push(create);
    delete create.data; // don't charge an old upload in addition to the planned readback
    read({kind:'gpu',op:O.BUFFER_READBACK,words:[h,0,b.words[2],0]},b.words[2],source.kind==='webgpu'?Math.ceil(b.words[2]/4)*4:0,data=>{create.data=data;});
  }
  for(const [h,t] of r.textures) {
    frame.items.push(t.item);
    if(t.allocated>1)frame.items.push({kind:'gpu',op:O.TEXTURE_ALLOCATE_MIPS,words:[h,t.allocated]});
    const desc=toCanonicalTexture(t.item.words);
    const levels=lazy.get(h);
    if(levels) {
      // K71: replay only the deferred clears. No native readback is needed,
      // and neither successful nor rejected capture allocates live storage.
      levels.forEach((c,mip)=>{
        if(c?.color)frame.items.push({kind:'gpu',op:O.PASS_BEGIN,words:[1,0,0,0,0,0,0,h,mip,1,...c.color]},
          {kind:'gpu',op:O.PASS_END,words:[]});
        else if(c&&(c.depth!==undefined||c.stencil!==undefined))frame.items.push({kind:'gpu',op:O.PASS_BEGIN,
          words:[0,h,mip,c.depth===undefined?0:1,c.stencil===undefined?0:1,c.depth??0,c.stencil??0]}, {kind:'gpu',op:O.PASS_END,words:[]});
      });
      continue;
    }
    if(desc.format===5) {
      for(let mip=0;mip<t.allocated;mip++) {
        const [depth,stencil]=t.constants[mip];
        if(depth===null&&stencil===null)continue;
        frame.items.push({kind:'gpu',op:O.PASS_BEGIN,words:[0,h,mip,depth===null?0:1,stencil===null?0:1,depth??0,stencil??0]},
          {kind:'gpu',op:O.PASS_END,words:[]});
      }
      continue; // Unknown aspects must reset in the bounded original residual.
    }
    for(let mip=0;mip<t.allocated;mip++) {
      const e=mipExtent(desc,mip),update:GpuItem={kind:'gpu',op:O.TEXTURE_UPDATE_EX,words:[h,mip,0,0,0,e.width,e.height,e.depth,0,0]};
      frame.items.push(update);
      const exact=t.exactUploads.has(mip)?mipShadow(textureShadows.get(h),mip):undefined;
      if(exact?.length===e.width*e.height*e.depth*4) {
        // Share the already owned shadow copy; no second GPU->CPU transfer or
        // duplicate in-memory clone. Capture still owns its data independently.
        exactUploads.push([update,h,mip]);update.words=[...update.words.slice(0,9),exact.length];nativeBytes+=exact.length;continue;
      }
      t.exactUploads.delete(mip);
      const row=e.width*TEXEL_BYTES[desc.format];
      read({kind:'gpu',op:O.TEXTURE_READBACK,words:[h,mip,0,0,0,e.width,e.height,e.depth,0]},row*e.height*e.depth,
        textureReadbackStagingBytes(source.kind,desc.format,e),data=>{
        // GL color readback expands half-floats through JS, which cannot preserve
        // arbitrary NaN payloads. Never silently canonicalize a non-readable value.
        const half=[4,8,9].includes(desc.format),float=[6,10,11,12].includes(desc.format),dv=new DataView(data.buffer,data.byteOffset,data.byteLength);
        if(half||float)for(let i=0;i<data.length;i+=half?2:4) {
          if(half ? (dv.getUint16(i,true)&0x7c00)===0x7c00 : !Number.isFinite(dv.getFloat32(i,true)))throw new Error('Unsupported non-finite GPU texture checkpoint');
        }
        update.data=data;update.words=[...update.words.slice(0,9),data.length];
      });
    }
  }
  for(const t of r.legacy.values()) {
    frame.items.push(t.item);
    const {width:w,height:h,handle}=t.item, bytes=w*h*4;
    const update:Extract<FrameItem,{kind:'texUpdate'}>={kind:'texUpdate',handle,x:0,y:0,w,h,data:new Uint8Array(0)};
    frame.items.push(update);
    if(t.item.renderTarget)read({kind:'readback',target:handle,x:0,y:0,w,h,complete:()=>{}},bytes,source.kind==='webgpu'?paddedReadbackBytes(w*4,h):bytes,data=>{update.data=data;});
    else {
      legacyBytes+=bytes;nativeBytes+=bytes;
      for(const u of t.updates)if(typeof u.data==='string')stagingBytes=Math.max(stagingBytes,3*Math.ceil((u.data as string).length*3/4)+pixelStagingBytes);
      fillLegacy.push(()=>{
        const data=update.data=new Uint8Array(bytes);
        for(const u of t.updates){
          const upload=typeof u.data==='string'?decodeBytes(u.data):u.data;
          for(let y=0;y<u.h;y++)data.set(upload.subarray(y*u.w*4,(y+1)*u.w*4),((y+u.y)*w+u.x)*4);
        }
      });
    }
  }
  frame.items.push(...r.samplers.values(),...r.shaders.values(),...r.pipelines.values(),...r.feedback.values());
  const packedConstants: CheckpointFrame['packedConstants']=[...r.textures].filter(([,t])=>t.item.words[6]===5).map(([h,t])=>[h,t.constants]);
  const pack=()=>({...recordCheckpointFrame(frame,at.letterbox,at.update,at.width,at.height),packedConstants});
  const legacyTargets=[...r.legacy.values()].some(t=>t.item.renderTarget);
  const keepReplay=!!cursor&&!legacyTargets;
  const planned=checkpointFrameBytes(pack())+checkpointShadowBytes(shadows,new Set())+pixelBytes+readBytes+legacyBytes;
  check(planned,stagingBytes,residual,keepReplay);
  const surfaces=await source.captureTestSurfaces(at.letterbox,cloneCheckpoint(shadows));
  const capturedTextures=new Map(surfaces.textures.map(t=>[t.handle,t]));
  for(const [update,h,mip] of exactUploads) update.data=mipShadow(capturedTextures.get(h),mip)!;
  for(const fill of fillLegacy)fill();
  const done=Promise.all(pending).then(()=>undefined,e=>e as Error);
  if(legacyTargets)await source.drawFrame(reads,at.letterbox,false);
  else for(const item of reads.items){
    if(item.kind!=='gpu')throw new Error('Invalid live checkpoint readback');
    const code=source.gpu!.execute(item);if(code)item.readback?.(undefined,code);
  }
  await source.finish();
  const error=await done;if(error)throw error;
  cursor?.replay.check();
  const readbackMs=performance.now()-readAt;
  const compact:GPUCheckpoint={nativeBytes,frame:pack(),surfaces};
  // Legacy readFrame can present a redraw; don't reuse it as a pixel-exact cut.
  return {base:compact,journal:residual,keepReplay,stats:{nativeBytes,residualCommands:residual.reduce((n,f)=>n+f.items.length,0),
    residualUpdates:new Set(residual.map(f=>f.update)).size,replayFrames:cursor?replayFrames:0,replayMs,readbackMs,readbackBytes,provenanceMs}};
}
