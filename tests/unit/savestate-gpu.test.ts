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
const prefix=[f([{op:O.TEXTURE_CREATE_EX,words:[7,0,8,8,1,1,5,3]}])];
const pass=(depth=0,stencil=0)=>({op:O.PASS_BEGIN,words:[0,7,0,depth,stencil,0x3f800000,0]});
const draw={op:O.DRAW,words:[3,1,0,0]};
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
  expect(()=>proveResidual(prefix,[f([{op:O.TEXTURE_DELETE,words:[7]},{op:O.TEXTURE_CREATE_EX,words:[7,0,8,8,1,1,5,3]},pass(),draw])])).not.toThrow();
});
it('never credits a failed native clear as reset provenance',()=>{
  expect(()=>proveResidual(prefix,[f([{...pass(1,1),executeCode:-6},draw])])).toThrow(/failed mutation/);
});
