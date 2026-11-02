import {it,expect} from 'vitest';
import {compileC} from '../support/compile';
import {GameHost} from '../../bgt/runtime/host';
import {Vfs} from '../../bgt/runtime/vfs';
it('both backend selections configure sorted host restrictions and reject malformed optional descriptors',async()=>{
 const wasm=await compileC('tests/fixtures/c/slice_policy.c');
 for(const backend of [1,2])for(let mode=0;mode<8;mode++) {
  const h=await GameHost.create(wasm,{vfs:new Vfs(),log:()=>{},now:()=>0},{backend,caps:0,seed:1,
   displayWidth:64,displayHeight:64,arg0:mode,arg1:0,sliceCode:[500,100],sliceCodeRanges:[{addr:200,end:210},{addr:300,end:310}]});
  if(mode)expect(()=>h.init()).toThrow(/slice-policy/);
  else {expect(h.init()).toBe(0);const ex=(h as unknown as {exports:{value:(i:number)=>number}}).exports;
   expect([0,1,2,3,4,5].map(i=>ex.value(i))).toEqual([100,500,200,210,300,310]);}
 }
 for(const policy of [{sliceCode:[-1]}, {sliceCode:[1.5]}, {sliceCode:[1],sliceCodeRanges:[{addr:200,end:199}]},
  {sliceCode:[1],sliceCodeRanges:[{addr:200,end:210},{addr:205,end:220}]}]) {
  const h=await GameHost.create(wasm,{vfs:new Vfs(),log:()=>{},now:()=>0},{backend:1,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0,...policy});
  expect(()=>h.init()).toThrow(/slice-policy input/);
 }
});
