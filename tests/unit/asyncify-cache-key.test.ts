// @bgt-examples: none
// I12: K18 must never reuse a partitioned artifact after partition/name-parser changes.
// Inputs are isolated copies; no production source/cache mutation.
import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
// @ts-expect-error ESM build identity
import {asyncifyCacheKey} from '../../tools/build/build.mjs';
it('keys linked coverage selections, partition policy, every parser and exact postprocess options',()=>{
 const root=mkdtempSync(join(tmpdir(),'bgt-post-key-'));
 try{
  const files=['node_modules/binaryen/bin/wasm-opt','tools/build/asyncify.mjs','tools/build/binaryen-runner.mjs','tools/build/wasm-sections.mjs','tools/build/wasm-names.mjs'];
  for(const p of files){mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),p);}
  const raw=Buffer.from('linked early coverage selection'),key=()=>asyncifyCacheKey(raw,{root});
  const original=key();expect(key()).toBe(original);
  for(const p of files){
   writeFileSync(join(root,p),p+' changed partition policy/parser');
   expect(key(),p).not.toBe(original);writeFileSync(join(root,p),p);expect(key()).toBe(original);
  }
  expect(asyncifyCacheKey(Buffer.from('linked converged coverage selection'),{root})).not.toBe(original);
  expect(asyncifyCacheKey(raw,{root,profileNames:true})).not.toBe(original);
  expect(asyncifyCacheKey(raw,{root,asyncifyRemove:['N_01001000']})).not.toBe(original);
 }finally{rmSync(root,{recursive:true,force:true});}
});
