// Regression for vK42: checkpoint implementation must never enter flag-off bundles.
import {it,expect} from 'vitest';
import {build,type Rollup} from 'vite';
import {resolve} from 'node:path';

it('flag-off production bytes are independent of the entire savestate implementation',async()=>{
  const bundle=async(remove:boolean)=>{
    const result=await build({configFile:false,root:resolve('web'),publicDir:false,logLevel:'silent',
      define:{'import.meta.env.DEV':'false','import.meta.env.VITE_BGT_TEST':'undefined'},
      plugins:remove?[{name:'remove-savestate-implementation',enforce:'pre',load(id){
        if(/[/\\]savestate[^/\\]*\.ts$/.test(id))return 'export class Savestates {} export function exportSavestate() {} export function importSavestate() {} export function instrumentCheckpointWasm() {}';
      }}]:[],
      build:{write:false,minify:true,target:'es2022',rollupOptions:{input:resolve('web/index.html')}}});
    const outputs=(result as Rollup.RollupOutput).output;
    return outputs.filter((o):o is Rollup.OutputChunk=>o.type==='chunk').map(o=>o.code).sort();
  };
  const present=await bundle(false),removed=await bundle(true);
  expect(present).toEqual(removed);
  expect(present.join('')).not.toMatch(/bgt_checkpoint_|bgt-savestate|Savestate|scriptedOnly|guestNow|testHarness|captureTestSurfaces|restoreTestSurfaces|testCheckpointBusy/);
});
