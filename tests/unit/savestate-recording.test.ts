// CC0 recorder inputs; protect ownership, omitted observations and exact command order.
import {it,expect} from 'vitest';
import {Frame} from '../../bgt/runtime/commands';
import {GPU_OP as O} from '../../bgt/runtime/abi';
import {recordCheckpointFrame,restoreCheckpointFrame,checkpointFrameBytes} from '../../bgt/runtime/savestate-recording';
it('retains failure outcomes when materializing a new compact base',()=>{
 const f=new Frame();f.reset(4,4);
 f.items=[{kind:'gpu',op:O.SHADER_CREATE,words:[1,1,2,0,4,81],source:'bad shader',executeCode:-8,completeCode:-8} as typeof f.items[number]];
 const first=recordCheckpointFrame(f,{x:0,y:0,w:4,h:4,scale:1},1,4,4);
 const compact=recordCheckpointFrame(restoreCheckpointFrame(first),first.letterbox,1,4,4,false);
 expect(compact.items[0].executeCode).toBe(-8);expect(compact.items[0].completeCode).toBe(-8);
 expect(compact.items).toEqual(first.items);
});
it.each([1,2,3,4,5,6,7])('normalizes upload offset %i before every replay typed view',offset=>{
 const backing=new Uint8Array(64);const data=new Uint8Array(backing.buffer,offset,16);data.forEach((_,i)=>data[i]=i+1);
 const f=new Frame();f.reset(4,4);f.items=[{kind:'gpu',op:O.TEXTURE_UPDATE_EX,words:[7,0,0,0,0,1,1,1,0,16],data}];
 const record=recordCheckpointFrame(f,{x:0,y:0,w:4,h:4,scale:1},1,4,4);
 const restored=restoreCheckpointFrame(record),upload=restored.items[0].data as Uint8Array;
 expect(upload.byteOffset&7).toBe(0);expect([...upload]).toEqual([...data]);expect(upload.buffer).not.toBe(data.buffer);
 for(const View of [Uint16Array,Int16Array,Float32Array,Int32Array,Uint32Array,Float64Array]){
   const view=new View(upload.buffer,upload.byteOffset,upload.byteLength/View.BYTES_PER_ELEMENT);
   expect(new Uint8Array(view.buffer,view.byteOffset,view.byteLength)).toEqual(data);
 }
 expect(record.items[0].data).toBe(data);
});
it('retains owned decoder uploads without copies, copies reusable vertices, drops only readbacks',()=>{
 const f=new Frame();f.reset(4,4);f.vertexCount=1;f.vertexBytes().fill(173);
 const upload=new Uint8Array([255,0,17,9]);
 f.items=[{kind:'gpu',op:O.BUFFER_UPDATE,words:[7,0,0,4],data:upload},
  {kind:'gpu',op:O.BUFFER_READBACK,words:[7,0,4,1],readback:()=>{}},
  {kind:'readback',target:0,x:0,y:0,w:1,h:1,complete:()=>{}},
  {kind:'gpu',op:O.DRAW,words:[3,1,0,0]},
  {kind:'gpu',op:O.SHADER_CREATE,words:[1,1,2,0,4,81],source:'void main(){}',complete:()=>{}}];
 const recorded=recordCheckpointFrame(f,{x:0,y:0,w:4,h:4,scale:1},1,4,4);
 expect(recorded.items.map(x=>x.op)).toEqual([O.BUFFER_UPDATE,O.DRAW,O.SHADER_CREATE]);expect(recorded.items[2].source).toBe('void main(){}');expect(recorded.items[0].data).toBe(upload);
 f.vertexBytes().fill(0);expect(Array.from(recorded.vertices as Uint8Array)).toEqual(Array(20).fill(173));
 expect(()=>structuredClone(recorded)).not.toThrow();expect(checkpointFrameBytes(recorded)).toBeGreaterThan(upload.length+20);
 const restored=restoreCheckpointFrame(recorded);expect(restored.items[0]).toEqual(f.items[0]);expect(restored.vertexBytes()).toEqual(recorded.vertices);
});
