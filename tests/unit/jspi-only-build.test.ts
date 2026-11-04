// @bgt-examples: none
// CC0: verifies the production build publishes the raw linked artifact without
// invoking Asyncify, and the actual host resumes it using the JSPI-only manifest.
import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,basename} from 'node:path';
import {loadHeadless,ROOT} from '../support/headless';
import {jspiApi} from '../../bgt/runtime/jspi';
// @ts-expect-error ESM build orchestration
import {buildGame} from '../../tools/build/build.mjs';
it('builds a JSPI-only suspending fixture with no Asyncify exports or fallback claim',async()=>{
 const root=join(ROOT,'node_modules/.cache/bgt');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'jspi-only-')),id=basename(dir).toLowerCase();
 try{
  writeFileSync(join(dir,'game.c'),readFileSync(join(ROOT,'tests/fixtures/c/yield_game.c')));
  writeFileSync(join(dir,'game.json'),JSON.stringify({id,name:'CC0 JSPI only',sources:['game.c'],asyncify:true,suspensionBuild:'jspi'}));
  let linked:Buffer|null=null;const m=buildGame(dir,{quiet:true,onLinkedWasm:(p:string)=>{linked=readFileSync(p);}});
  expect(m.suspension).toBe('jspi');expect(m.toolchain.asyncify).toBe(false);expect(m.variants).toBeUndefined();
  const bytes=readFileSync(join(ROOT,'web/public/games',id,'game.wasm'));expect(bytes.equals(linked!)).toBe(true);
  expect(WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(e=>e.name)).not.toContain('asyncify_start_unwind');
  if(jspiApi()){const h=await loadHeadless(id);await h.stepAsync(300);expect(h.host.yields).toBe(300);expect(h.host.stateHash()).toBe((300000+187).toString(16).padStart(8,'0'));}
  else await expect(loadHeadless(id)).rejects.toThrow(/JSPI-only build requires/);
 }finally{rmSync(dir,{recursive:true,force:true});rmSync(join(ROOT,'web/public/games',id),{recursive:true,force:true});}
});

it('per-game JSPI preference emits both verified artifacts, even without the old opt-in',()=>{
 const root=join(ROOT,'node_modules/.cache/bgt');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'jspi-prefer-')),id=basename(dir).toLowerCase();
 try{
  writeFileSync(join(dir,'game.c'),readFileSync(join(ROOT,'tests/fixtures/c/yield_game.c')));
  writeFileSync(join(dir,'game.json'),JSON.stringify({id,name:'CC0 JSPI preference',sources:['game.c'],asyncify:true,jspi:false,suspension:'jspi-preferred'}));
  const m=buildGame(dir,{quiet:true});
  expect(m.preferredSuspension).toBe('jspi');expect(m.suspension).toBeUndefined();expect(m.toolchain.asyncify).toBe(true);
  expect(m.variants.jspi.size).toBeGreaterThan(0);
  const out=join(ROOT,'web/public/games',id);
  const names=(path:string)=>WebAssembly.Module.exports(new WebAssembly.Module(readFileSync(path))).map(e=>e.name);
  expect(names(join(out,'game.wasm'))).toContain('asyncify_start_unwind');
  expect(names(join(out,'game.jspi.wasm'))).not.toContain('asyncify_start_unwind');
 }finally{rmSync(dir,{recursive:true,force:true});rmSync(join(ROOT,'web/public/games',id),{recursive:true,force:true});}
});
