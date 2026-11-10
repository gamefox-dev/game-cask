import {it,expect} from 'vitest';
// @ts-expect-error probe's plain ESM interface
import {searchSavestate} from '../../tools/probe/savestate-search.mjs';
for(const failure of ['none','score','screenshot','input','diagnostics'])it('probe search restores checkpoint in finally on '+failure,async()=>{
  let state=0,restores=0;
  const p={restore:async(s:number)=>{state=s;restores++;},step:async()=>{state++;},input:async()=>{},
    diagnostics:async()=>({errors:failure==='diagnostics'?['failure']:[]}),
    screenshot:async(name:string)=>{if(failure==='screenshot')throw new Error('capture failed');return name;}};
  const options={variants:[0,1],updates:2,input:()=>{if(failure==='input')throw new Error('input failed');return [];},
    score:async()=>{if(failure==='score')throw new Error('score failed');return state;}};
  if(failure==='none') {
    expect(await searchSavestate(p,10,options)).toEqual([{variant:0,score:12,screenshot:'variant-0'},{variant:1,score:12,screenshot:'variant-1'}]);
    expect(restores).toBe(3);
  }else{await expect(searchSavestate(p,10,options)).rejects.toThrow();expect(restores).toBe(2);}
  expect(state).toBe(10);
});
