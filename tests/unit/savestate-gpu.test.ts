// CC0 command-only adversaries: never infer a packed aspect from end-of-suffix state.
import {it,expect} from 'vitest';
import {Frame} from '../../bgt/runtime/commands';
import {GPU_OP as O} from '../../bgt/runtime/abi';
import {recordFrame} from '../../bgt/renderers/recording';
import {proveResidual} from '../../bgt/runtime/savestate-gpu';
const f=(items:{op:number;words:number[];executeCode?:number}[])=>{
  const frame=new Frame();frame.reset(8,8);frame.items=items.map(x=>({kind:'gpu' as const,...x}));
  return recordFrame(frame,{x:0,y:0,w:8,h:8,scale:1},1,8,8);
};
const create={op:O.TEXTURE_CREATE_EX,words:[7,0,8,8,1,3,5,3]};
const pass=(depth=0,stencil=0)=>({op:O.PASS_BEGIN,words:[0,7,0,depth,stencil,0x3f000000,37]});
const end={op:O.PASS_END,words:[]};
const draw={op:O.DRAW,words:[3,1,0,0]};
const pipeline=(depth=1,stencil=1,mask=255,ops=[2,2,2,2,2,2])=>{
  const words=Array(26).fill(0);words[0]=9;words[6]=5;words[8]=depth;words[10]=stencil;words[12]=mask;
  [14,15,16,18,19,20].forEach((v,i)=>words[v]=ops[i]);return {op:O.PIPELINE_CREATE,words};
};
const bind={op:O.PIPELINE,words:[9]};
const fresh=[f([create])];
// A potentially writing draw destroys both initialized constants. An unset pipeline
// is deliberately conservative in this command-only proof (native validation is separate).
const prefix=[f([create,pass(),draw,end])];
it('accepts complete load clears and full all-aspect explicit clears',()=>{
  expect(()=>proveResidual(prefix,[f([pass(1,1),draw])])).not.toThrow();
  expect(()=>proveResidual(prefix,[f([pass(),{op:O.CLEAR_BUFFER,words:[3|16|(255<<8),0,0x3f800000,0]},draw])])).not.toThrow();
});
for(const clear of [pass(1,0),pass(0,1),pass()])it('rejects incomplete aspect provenance '+clear.words[3]+clear.words[4],()=>{
  expect(()=>proveResidual(prefix,[f([clear,draw])])).toThrow(/provenance/);
});
it('rejects masked/scissored resets and read-before-reset even if cleared later',()=>{
  for(const items of [
    [pass(),{op:O.SCISSOR,words:[0,0,4,8]},{op:O.CLEAR_BUFFER,words:[3|16|(255<<8),0,0,0]},draw],
    [pass(),{op:O.CLEAR_BUFFER,words:[3|16|(127<<8),0,0,0]},draw],
    [{op:O.TEXTURE,words:[0,7,1]},pass(1,1)],
    [{op:O.BLIT,words:[7,0,9,0]},pass(1,1)],
  ])expect(()=>proveResidual(prefix,[f(items)])).toThrow(/provenance/);
});
it('deletion before consumption removes only that generation',()=>{
  expect(()=>proveResidual(prefix,[f([{op:O.TEXTURE_DELETE,words:[7]},create,pass(),draw])])).not.toThrow();
});
it('never credits a failed native clear as reset provenance',()=>{
  expect(()=>proveResidual(prefix,[f([{...pass(1,1),executeCode:-6},draw])])).toThrow(/failed mutation/);
});
it('retains initial stencil and exact full-clear constants across depth-only updates',()=>{
  expect(()=>proveResidual(fresh,[])).not.toThrow();
  const p=[f([create,pipeline(1,0),pass(1,0),bind,draw,end])];
  // Unknown depth resets inside the suffix; initialized stencil does not need a new clear.
  expect(()=>proveResidual(p,[f([pass(1,0),bind,draw,end])])).not.toThrow();
  expect(()=>proveResidual([f([create,pass(1,1),end])],[])).not.toThrow();
});
it('only proven no-write pipeline aspects preserve constants',()=>{
  for(const p of [pipeline(0,0),pipeline(0,1,0),pipeline(0,1,255,[0,0,0,0,0,0])])
    expect(()=>proveResidual([f([create,p,pass(),bind,draw,end])],[])).not.toThrow();
  for(let i=0;i<6;i++){
    const ops=Array(6).fill(0);ops[i]=1;
    expect(()=>proveResidual([f([create,pipeline(0,1,255,ops),pass(),bind,draw,end])],[])).toThrow(/provenance/);
  }
  for(const op of [O.DRAW,O.DRAW_INDEXED])for(const [depth,stencil] of [[1,0],[0,1]])
    expect(()=>proveResidual([f([create,pipeline(depth,stencil),pass(),bind,{...draw,op},end])],[])).toThrow(/provenance/);
});
it('partial clears/uploads and framebuffer copies invalidate only their written aspects',()=>{
  for(const mutation of [
    [pass(),{op:O.SCISSOR,words:[0,0,4,8]},{op:O.CLEAR_BUFFER,words:[1|16,0,0,0]},end],
    [pass(),{op:O.CLEAR_BUFFER,words:[2|(127<<8),0,17,0]},end],
    [{op:O.TEXTURE_UPDATE_EX,words:[7,0,0,0,0,8,8,1,0,256]}],
    [{op:O.TEXTURE_UPDATE_EX,words:[7,0,1,0,0,4,8,1,0,128]}],
    [{op:O.TEXTURE_UPDATE,words:[7,0,0,0,8,8,0,256]}],
  ])expect(()=>proveResidual([f([create,...mutation])],[])).toThrow(/provenance/);
  for(const mask of [2,4,6]){
    const blit={op:O.BLIT,words:[8,0,7,0,0,0,8,8,0,0,8,8,mask,0,0,0,8,8]};
    const p=[f([create,blit])];expect(()=>proveResidual(p,[])).toThrow(/provenance/);
    expect(()=>proveResidual(p,[f([pass(mask&2?1:0,mask&4?1:0),draw])])).not.toThrow();
  }
});
it('new mip allocation initializes only NEW levels and handles generation replacement',()=>{
  const allocate={op:O.TEXTURE_ALLOCATE_MIPS,words:[7,3]};
  expect(()=>proveResidual([f([create,allocate])],[])).not.toThrow();
  expect(()=>proveResidual([...prefix,f([allocate])],[])).toThrow(/provenance/);
  expect(()=>proveResidual([...prefix,f([{op:O.TEXTURE_DELETE,words:[7]},create,allocate])],[])).not.toThrow();
});
it('recompaction never re-infers initialized constants for unavailable base aspects',()=>{
  const base={...f([create,pass(1,0),end]),packedConstants:[[7,[[0x3f000000,null]]]] as [number,[number|null,number|null][]][]};
  expect(()=>proveResidual([base],[])).toThrow(/provenance/);
  expect(()=>proveResidual([base],[f([pass(0,1),draw])])).not.toThrow();
});
