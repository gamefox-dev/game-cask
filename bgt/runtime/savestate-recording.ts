// Test-only raw recorder: retain immutable upload views, but not the reusable
// vertex arena or the decoder’s shared-buffer ownership keys.
import {Frame,VERTEX_FLOATS,type FrameItem} from './commands';
import {GPU_OP as O,LIMITS} from './abi';
import type {RecordedFrame} from '../renderers/recording';
import {decodeBytes} from '../renderers/recording';
import type {Letterbox,Renderer} from '../renderers/types';
export type CheckpointFrame=Omit<RecordedFrame,'vertices'> & {vertices:string|Uint8Array<ArrayBuffer>;packedConstants?:[number,[number|null,number|null][]][]};
export function recordsMutation(item:FrameItem):boolean {return item.kind!=='readback'&&!(item.kind==='gpu'&&(item.op===O.TEXTURE_READBACK||item.op===O.BUFFER_READBACK));}
export function recordCheckpointFrame(frame:Frame,letterbox:Letterbox,update:number,width:number,height:number):CheckpointFrame {
  return {type:'frame',update,width,height,logicalW:frame.logicalW,logicalH:frame.logicalH,letterbox:{...letterbox},
    vertices:frame.vertexBytes().slice(),items:frame.items.flatMap<Record<string,unknown>>(item=>{
      // Observation results already live in the host request checkpoint. Replay must not issue them.
      if(!recordsMutation(item))return [];
      if(item.kind==='gpu'){
        const outcome=item as typeof item & {executeCode?:number;completeCode?:number};
        // K74 keys the decoder's buffer store on the original words object.
        const words=(item.op===O.BUFFER_CREATE||item.op===O.BUFFER_UPDATE||item.op===O.BUFFER_COPY)?item.words.slice():item.words;
        return [{kind:'gpu',op:item.op,words,...(item.data?{data:item.data}:{}),...(item.source!==undefined?{source:item.source}:{}),
          ...(outcome.executeCode!==undefined?{executeCode:outcome.executeCode}:{}),...(outcome.completeCode!==undefined?{completeCode:outcome.completeCode}:{})}];
      }
      if(item.kind==='draw')return [{...item,clip:{...item.clip}}];
      if(item.kind==='texUpdate')return [{...item}];
      return [{...item}];
    })};
}
export function checkpointFrameBytes(f:CheckpointFrame,seen=new Set<ArrayBufferLike>()):number {
  const dataBytes=(v:Uint8Array|string|undefined)=>{
    if(typeof v==='string')return v.length*2;
    if(!v||seen.has(v.buffer))return 0;
    seen.add(v.buffer);return v.buffer.byteLength;
  };
  let bytes=128+dataBytes(f.vertices);
  for(const [,levels] of f.packedConstants??[])bytes+=32+32*levels.length;
  for(const i of f.items)bytes+=96+(Array.isArray(i.words)?i.words.length*8:0)+
    dataBytes(i.data instanceof Uint8Array||typeof i.data==='string'?i.data:undefined)+
    (typeof i.source==='string'?i.source.length*2:0);
  return bytes;
}
export function restoreCheckpointFrame(record:CheckpointFrame):Frame {
  const vertices=typeof record.vertices==='string'?decodeBytes(record.vertices):record.vertices;
  const count=vertices.length/(VERTEX_FLOATS*4);
  if(!Number.isInteger(count)||count>LIMITS.verticesPerFrame)throw new Error('Invalid recorded vertex bytes');
  const f=new Frame(count);f.reset(record.logicalW,record.logicalH);
  f.vertexCount=count;f.vertexBytes().set(vertices);
  // Keep aligned upload data as read-only views; copy only misaligned views.
  f.items=restoreCheckpointItems(record);return f;
}
function alignedUpload(data:Uint8Array):Uint8Array<ArrayBuffer>{
  // Imported BGTSTATE blob views can begin at any byte in their transport chunk.
  // WebGL typed upload views require the backing offset to satisfy their element
  // alignment. An 8-byte boundary covers all JS numeric typed arrays. Normalize
  // at the test-only replay boundary, not in the production renderer/file layout.
  if(data.buffer instanceof ArrayBuffer&&(data.byteOffset&7)===0)return data as Uint8Array<ArrayBuffer>;
  const copy=new Uint8Array(data.byteLength);copy.set(data);return copy;
}
export function restoreCheckpointItems(record:CheckpointFrame):FrameItem[]{
  return record.items.map(i=>{
    const data=typeof i.data==='string'?decodeBytes(i.data):i.data instanceof Uint8Array?alignedUpload(i.data):undefined;
    return {...i,...(data===undefined?{}:{data}),...(i.kind==='readback'?{complete:()=>{}}:{})};
  }) as FrameItem[];
}
/** Checkpoint replay deliberately excludes FrameReplay's inspection/base64 machinery. */
export class CheckpointReplay {
  private error?:string;
  private expected?:number;
  private active=true;
  private unwrap?:()=>void;
  constructor(private renderer:Renderer){
    const fail=(message:string)=>{if(this.active)this.error??=message;};
    renderer.onError(m=>{if(!this.expected)fail(m);});renderer.onLost(m=>fail('Device/context loss: '+m));
    const gpu=renderer.gpu;
    if(gpu){const execute=gpu.execute.bind(gpu);this.unwrap=()=>{gpu.execute=execute;};gpu.execute=item=>{
      const expected=(item as unknown as {executeCode?:number}).executeCode;this.expected=expected;
      try{const code=execute(item);
        if(typeof expected==='number'?code!==expected:code&&item.op!==O.SHADER_CREATE)fail('GPU opcode '+item.op+' changed outcome: '+expected+' -> '+code);
        return code;
      }finally{this.expected=undefined;}
    };}
  }
  check():void {
    if(this.error||this.renderer.lost)throw new Error(this.error??'Checkpoint replay renderer lost');
  }
  stop():void {this.active=false;this.unwrap?.();this.unwrap=undefined;}
  async draw(record:CheckpointFrame, finish = true):Promise<void>{
    const frame=restoreCheckpointFrame(record),pending:Promise<void>[]=[];
    frame.items.forEach((item,i)=>{
      if(item.kind==='gpu'&&item.op===O.SHADER_CREATE)pending.push(new Promise<void>((resolve,reject)=>{
        item.complete=(code,log)=>{const expected=record.items[i].completeCode;
          if(typeof expected==='number'?code!==expected:!!code)reject(new Error(log||'Shader replay outcome changed'));else resolve();};
      }));
      if(item.kind==='readback')item.complete=()=>{};
      if(item.kind==='gpu'&&(item.op===O.BUFFER_READBACK||item.op===O.TEXTURE_READBACK))item.readback=()=>{};
    });
    if(this.renderer.canvas.width!==record.width||this.renderer.canvas.height!==record.height)this.renderer.resize(record.width,record.height);
    const done=Promise.all(pending).then(()=>undefined,e=>e as Error);
    await this.renderer.drawFrame(frame,record.letterbox,false);
    // Native work is ordered within one renderer/queue. Shader completions are
    // still checked before replay can proceed; other frames need no GPU fence.
    if(finish||pending.length)await this.renderer.finish();
    const error=await done;if(error)throw error;this.check();
  }
}
