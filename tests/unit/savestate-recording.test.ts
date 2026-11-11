// CC0 recorder inputs; protect ownership, omitted observations and exact command order.
import {it,expect} from 'vitest';
import {Frame} from '../../bgt/runtime/commands';
import {GPU_OP as O} from '../../bgt/runtime/abi';
import {recordCheckpointFrame,restoreCheckpointFrame,checkpointFrameBytes} from '../../bgt/runtime/savestate-recording';
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
