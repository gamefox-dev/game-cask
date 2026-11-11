// Test-only raw recorder: decoder uploads/words are already owned, renderer-read-only.
// Retain those views; copy only the reusable legacy vertex arena. No base64/JSON on update path.
import {Frame,type FrameItem} from './commands';
import {GPU_OP as O} from './abi';
import type {RecordedFrame} from '../renderers/recording';
import {decodeBytes} from '../renderers/recording';
import type {Letterbox,Renderer} from '../renderers/types';
export type CheckpointFrame=Omit<RecordedFrame,'vertices'> & {vertices:string|Uint8Array<ArrayBuffer>;packedConstants?:[number,[number|null,number|null][]][]};
export function recordsMutation(item:FrameItem):boolean {return item.kind!=='readback'&&!(item.kind==='gpu'&&(item.op===O.TEXTURE_READBACK||item.op===O.BUFFER_READBACK));}
export function recordCheckpointFrame(frame:Frame,letterbox:Letterbox,update:number,width:number,height:number,copy=true):CheckpointFrame {
  return {type:'frame',update,width,height,logicalW:frame.logicalW,logicalH:frame.logicalH,letterbox:{...letterbox},
    vertices:copy?frame.vertexBytes().slice():frame.vertexBytes(),items:frame.items.flatMap<Record<string,unknown>>(item=>{
      // Observation results already live in the host request checkpoint. Replay must not issue them.
      if(!recordsMutation(item))return [];
      if(item.kind==='gpu'){
        const outcome=item as typeof item & {executeCode?:number;completeCode?:number};
        return [{kind:'gpu',op:item.op,words:item.words,...(item.data?{data:item.data}:{}),...(item.source!==undefined?{source:item.source}:{}),
          ...(outcome.executeCode!==undefined?{executeCode:outcome.executeCode}:{}),...(outcome.completeCode!==undefined?{completeCode:outcome.completeCode}:{})}];
      }
      if(item.kind==='draw')return [{...item,clip:{...item.clip}}];
      if(item.kind==='texUpdate')return [{...item}];
      return [{...item}];
    })};
}
export function checkpointFrameBytes(f:CheckpointFrame):number {
  let bytes=128+(typeof f.vertices==='string'?f.vertices.length*2:f.vertices.byteLength);
  for(const i of f.items)bytes+=96+(Array.isArray(i.words)?i.words.length*8:0)+(i.data instanceof Uint8Array?i.data.byteLength:typeof i.data==='string'?i.data.length*2:0);
  return bytes;
}
export function restoreCheckpointFrame(record:CheckpointFrame):Frame {
  const f=new Frame();f.reset(record.logicalW,record.logicalH);
  const vertices=typeof record.vertices==='string'?decodeBytes(record.vertices):record.vertices;
  if(vertices.length%20||!f.reserve(vertices.length/20))throw new Error('Invalid recorded vertex bytes');
  f.vertexCount=vertices.length/20;f.vertexBytes().set(vertices);
  // Keep aligned upload data as read-only views; copy only misaligned views.
  f.items=restoreCheckpointItems(record);return f;
}
function alignedUpload(data:Uint8Array<ArrayBuffer>):Uint8Array<ArrayBuffer>{
  // Imported BGTSTATE blob views can begin at any byte in their transport chunk.
  // WebGL typed upload views require the backing offset to satisfy their element
  // alignment. An 8-byte boundary covers all JS numeric typed arrays. Normalize
  // at the test-only replay boundary, not in the production renderer/file layout.
  if((data.byteOffset&7)===0)return data;
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
  private errors:string[]=[];private expected?:number;
  constructor(private renderer:Renderer){
    renderer.onError(m=>{if(!this.expected)this.errors.push(m);});renderer.onLost(m=>this.errors.push('Device/context loss: '+m));
    if(renderer.gpu){const execute=renderer.gpu.execute.bind(renderer.gpu);renderer.gpu.execute=item=>{
      const expected=(item as unknown as {executeCode?:number}).executeCode;this.expected=expected;
      try{const code=execute(item);
        if(typeof expected==='number'?code!==expected:code&&item.op!==O.SHADER_CREATE)this.errors.push('GPU opcode '+item.op+' changed outcome: '+expected+' -> '+code);
        return code;
      }finally{this.expected=undefined;}
    };}
  }
  async draw(record:CheckpointFrame):Promise<void>{
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
    await this.renderer.drawFrame(frame,record.letterbox,false);await this.renderer.finish();
    const error=await done;if(error)throw error;if(this.errors.length)throw new Error(this.errors.join('\n'));
  }
}
