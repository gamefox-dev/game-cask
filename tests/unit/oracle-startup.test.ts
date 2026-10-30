import { it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state=vi.hoisted(()=>({root:'', interpreted:false}));
vi.mock('../support/headless',()=>({
  get ROOT(){return state.root;},
  loadHeadless:async(id:string,options:any)=>{
    state.interpreted=id.endsWith('-interp');
    return {host:{logicalWidth:320,logicalHeight:200,commandErrorCount:0,
      stateHash:()=> 'same-api-hash',metrics:()=>({})},
    stepAsync:async()=>options?.tick?.(),pointer:()=>{},key:()=>{}};
  },
}));
vi.mock('../support/x64-gl-stream',()=>({glStream:()=>{
  let frame=0;
  return {tick:()=>frame++,frameHash:()=>frame===2 && state.interpreted?'changed-startup-upload':'same'};
}}));
import { oracle } from '../oracle/oracle';

it('smoke oracle rejects a startup-only GPU difference even when all measured API/GPU frames agree',async()=>{
  state.root=mkdtempSync(join(tmpdir(),'bgt-oracle-startup-'));
  try {
    const r=await oracle('x64-smoke',600,[]);
    expect(r.errors).toEqual({lifted:null,interpreted:null});
    expect(r.identical).toBe(false); expect(r.firstDivergence).toBe(0);
  } finally {rmSync(state.root,{recursive:true,force:true});}
});
