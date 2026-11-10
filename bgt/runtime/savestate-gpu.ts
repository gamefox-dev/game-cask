// Opt-in checkpoint materialization. Guest code is never re-executed.
// A base at a frame boundary + <=2 updates of original commands preserves dependencies,
// including resources deleted/reused later in the suffix. No end-of-suffix shadows.
import { GPU_OP as O } from './abi';
import { Frame, type FrameItem } from './commands';
import { canonicalize, mipExtent, toCanonicalTexture } from '../renderers/gpu-texture';
import { recordFrame, restoreFrame, type RecordedFrame } from '../renderers/recording';
import { FrameReplay } from '../renderers/frame-replay';
import type { Renderer, GpuItem } from '../renderers/types';
import type { CheckpointRenderer, CheckpointSurfaces } from '../renderers/checkpoint-surfaces';

// Null means unavailable, NOT the native texture's freshly initialized value.
// Persist this proof alongside the base so repeated compaction cannot invent constants.
type PackedConstants = [number | null, number | null][];
type CheckpointFrame = RecordedFrame & { packedConstants?: [number, PackedConstants][] };
export interface GPUCheckpoint { frame: CheckpointFrame; surfaces: CheckpointSurfaces }
export const RESIDUAL_UPDATES = 2;
export const RESIDUAL_COMMANDS = 100000;
interface Texture { item: GpuItem; allocated: number; constants: PackedConstants }
interface Resources {
  buffers: Map<number,GpuItem>; textures: Map<number,Texture>; samplers: Map<number,GpuItem>;
  shaders: Map<number,GpuItem>; pipelines: Map<number,GpuItem>; feedback: Map<number,GpuItem>;
  legacy: Map<number,{item: Extract<FrameItem,{kind:'texCreate'}>; data: Uint8Array<ArrayBuffer>}>;
}
function resources(records: RecordedFrame[]): Resources {
  const r: Resources = {buffers:new Map(),textures:new Map(),samplers:new Map(),shaders:new Map(),pipelines:new Map(),feedback:new Map(),legacy:new Map()};
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
  for (const record of records) {
   for (const item of restoreFrame(record).items) {
    // Failed creations reserve failed shader/pipeline objects; failed mutations have no effect.
    const code=(item as unknown as {executeCode?:number}).executeCode;
    if(code && item.kind==='gpu' && item.op!==O.SHADER_CREATE && item.op!==O.PIPELINE_CREATE)
      throw new Error('Unsupported savestate GPU failed mutation: '+item.op+' ('+code+')');
    if (item.kind === 'texCreate') r.legacy.set(item.handle,{item,data:new Uint8Array(item.width*item.height*4)});
    if (item.kind === 'texDelete') r.legacy.delete(item.handle);
    if (item.kind === 'texUpdate') {
      const t=r.legacy.get(item.handle)!;
      for(let y=0;y<item.h;y++) t.data.set(item.data.subarray(y*item.w*4,(y+1)*item.w*4),((y+item.y)*t.item.width+item.x)*4);
    }
    if (item.kind !== 'gpu') continue;
    const {op,words:w}=canonicalize(item.op,item.words), h=w[0], it={...item,op,words:w};
    switch(op) {
      case O.BUFFER_CREATE:r.buffers.set(h,it);break;
      case O.BUFFER_DELETE:r.buffers.delete(h);break;
      case O.TEXTURE_CREATE_EX: {
        const t:Texture={item:it,allocated:0,constants:[]};
        allocate(t,item.op===O.TEXTURE_CREATE?w[5]:1);r.textures.set(h,t);break;
      }
      case O.TEXTURE_ALLOCATE_MIPS: {const t=r.textures.get(h)!;allocate(t,Math.max(t.allocated,w[1]));break;}
      case O.TEXTURE_GENERATE_MIPS: {
        const t=r.textures.get(h)!;allocate(t,t.item.words[5]);
        for(let mip=w[1]+1;mip<t.allocated;mip++)invalidate(h,mip,3);break;
      }
      case O.TEXTURE_DELETE:r.textures.delete(h);break;
      case O.SAMPLER_CREATE_EX:r.samplers.set(h,it);break;
      case O.SAMPLER_DELETE:r.samplers.delete(h);break;
      case O.SHADER_CREATE:r.shaders.set(h,it);break;
      case O.SHADER_DELETE:r.shaders.delete(h);break;
      case O.PIPELINE_CREATE:r.pipelines.set(h,it);break;
      case O.PIPELINE_DELETE:r.pipelines.delete(h);r.feedback.delete(h);break;
      case O.FEEDBACK_VARYINGS:r.feedback.set(h,it);break;
      case O.PASS_BEGIN: {
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
      case O.TEXTURE_UPDATE_EX:invalidate(h,w[1],3);break;
      case O.BLIT:invalidate(w[2],w[3],(w[12]>>>1)&3);break;
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
export function proveResidual(prefix: RecordedFrame[], residual: RecordedFrame[]): void {
  const r=resources(prefix), pending=new Map<number,Map<number,number>>();
  for(const [h,t] of r.textures) if(t.item.words[6]===5) pending.set(h,new Map(t.constants.map((c,i)=>[i,(c[0]===null?1:0)|(c[1]===null?2:0)])));
  let pass:{handle:number;mip:number;fullScissor:boolean;width:number;height:number}|undefined;
  const reset=(h:number,mip:number,aspects:number)=>{const p=pending.get(h);if(p)p.set(mip,(p.get(mip)??0)&~aspects);};
  const touch=(h:number,mip?:number) => {
    const p=pending.get(h);
    if(p && (mip===undefined ? [...p.values()].some(Boolean) : p.get(mip))) throw new Error('Unsupported savestate GPU provenance: packed depth/stencil '+h+' consumed before full clear');
  };
  for(const record of residual) for(const item of restoreFrame(record).items) {
    if(item.kind!=='gpu') continue;
    const code=(item as unknown as {executeCode?:number}).executeCode;
    if(code && item.op!==O.SHADER_CREATE && item.op!==O.PIPELINE_CREATE)
      throw new Error('Unsupported savestate GPU failed mutation: '+item.op+' ('+code+')');
    const {op,words:w}=canonicalize(item.op,item.words),h=w[0];
    switch(op) {
      case O.TEXTURE_CREATE_EX:r.textures.set(h,{item:{...item,op,words:w},allocated:1,constants:[]});break;
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
export async function replayGPU(renderer: Renderer & CheckpointRenderer, base: GPUCheckpoint | null, journal: RecordedFrame[]): Promise<void> {
  const replay=new FrameReplay(renderer,true);
  if(base) { await replay.draw(base.frame); renderer.restoreTestSurfaces(base.surfaces); }
  for(const f of journal) await replay.draw(f);
}
export async function compactGPU(renderer: Renderer & CheckpointRenderer, base: GPUCheckpoint | null, journal: RecordedFrame[]) {
  const last=journal.at(-1) ?? base?.frame;
  if(!last) return {base,journal,stats:{nativeBytes:0,residualCommands:0,residualUpdates:0}};
  const earliest=last.update-RESIDUAL_UPDATES+1;
  const candidates=[...journal.keys()].filter(i=>journal[i].update>=earliest && (!i || journal[i-1].update!==journal[i].update));
  // No unreadable resources: the end boundary needs no residual at all.
  if(![...resources([...(base?[base.frame]:[]),...journal]).textures.values()].some(t=>t.item.words[6]===5)) candidates.push(journal.length);
  let cut=-1, failure:unknown;
  for(const i of candidates.reverse()) {
    const tail=journal.slice(i);
    if(tail.reduce((n,f)=>n+f.items.length,0)>RESIDUAL_COMMANDS) continue;
    try { proveResidual([...(base?[base.frame]:[]),...journal.slice(0,i)],tail);cut=i;break; } catch(e) { failure=e; }
  }
  if(cut<0) throw failure ?? new Error('Unsupported savestate GPU residual exceeds command/update bound');
  const prefix=journal.slice(0,cut), residual=journal.slice(cut), at=prefix.at(-1) ?? base?.frame ?? journal[0];
  await replayGPU(renderer,base,prefix);
  const r=resources([...(base?[base.frame]:[]),...prefix]);
  const surfaces=await renderer.captureTestSurfaces(at.letterbox);
  const frame=new Frame();frame.reset(at.logicalW,at.logicalH);
  const reads=new Frame();reads.reset(at.logicalW,at.logicalH);
  const pending: Promise<void>[]=[];
  let nativeBytes=surfaces.physical.data.length+(surfaces.logical?.data.length??0);
  const read=(item: FrameItem, complete:(data:Uint8Array<ArrayBuffer>)=>void) => {
    pending.push(new Promise<void>((resolve,reject)=>{
      const done=(data?:Uint8Array<ArrayBuffer>,error?:number) => {if(!data||error)reject(new Error('Savestate native readback failed: '+error));else {try{nativeBytes+=data.length;complete(data);resolve();}catch(e){reject(e);}}};
      if(item.kind==='gpu') item.readback=done;
      else if(item.kind==='readback') item.complete=done;
      reads.items.push(item);
    }));
  };
  for(const [h,b] of r.buffers) {
    const create={...b,words:[h,b.words[1],b.words[2],0,b.words[2]]};frame.items.push(create);
    read({kind:'gpu',op:O.BUFFER_READBACK,words:[h,0,b.words[2],0]},data=>{create.data=data;});
  }
  for(const [h,t] of r.textures) {
    frame.items.push(t.item);
    if(t.allocated>1)frame.items.push({kind:'gpu',op:O.TEXTURE_ALLOCATE_MIPS,words:[h,t.allocated]});
    const desc=toCanonicalTexture(t.item.words);
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
      read({kind:'gpu',op:O.TEXTURE_READBACK,words:[h,mip,0,0,0,e.width,e.height,e.depth,0]},data=>{
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
    const update:Extract<FrameItem,{kind:'texUpdate'}>={kind:'texUpdate',handle:t.item.handle,x:0,y:0,w:t.item.width,h:t.item.height,data:t.data};
    frame.items.push(update);
    if(t.item.renderTarget)read({kind:'readback',target:t.item.handle,x:0,y:0,w:t.item.width,h:t.item.height,complete:()=>{}},data=>{update.data=data;});
    else nativeBytes+=t.data.length;
  }
  frame.items.push(...r.samplers.values(),...r.shaders.values(),...r.pipelines.values(),...r.feedback.values());
  const done=Promise.all(pending).then(()=>undefined,e=>e as Error);
  await renderer.drawFrame(reads,at.letterbox,false);await renderer.finish();
  const error=await done;if(error)throw error;
  const compact:GPUCheckpoint={frame:{...recordFrame(frame,at.letterbox,at.update,at.width,at.height),
    packedConstants:[...r.textures].filter(([,t])=>t.item.words[6]===5).map(([h,t])=>[h,t.constants])},surfaces};
  return {base:compact,journal:residual,stats:{nativeBytes,residualCommands:residual.reduce((n,f)=>n+f.items.length,0),
    residualUpdates:new Set(residual.map(f=>f.update)).size}};
}
