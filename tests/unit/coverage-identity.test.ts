// @bgt-examples: none
// Original CC0 identity-only evidence; no game data.
import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../support/headless';
// @ts-expect-error plain ESM
import {coveragePlan,validateCoverageIdentity} from '../../tools/build/coverage.mjs';
it('requires exact per-recording module sets and nonslice game identity, with actionable adoption',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bgt-identity-'));
 const modules=[{name:'a.exe',base:4096,sha256:'a'.repeat(64)},{name:'b.dll',base:8192,sha256:'b'.repeat(64)}];
 const snapshot={schema:'game-cask/coverage/1',game:'old-id',modules,code:[{address:4097,kind:2}],files:[],metrics:{errors:0}};
 const input=join(dir,'legacy.json'),manifest=join(dir,'manifest.json'),out=join(dir,'adopted.json');
 const save=(s:unknown)=>writeFileSync(input,JSON.stringify(s));
 const check=(files=[input],strict=false)=>validateCoverageIdentity(coveragePlan(files,dir),'new-id',modules,{strict});
 try{
  save(snapshot);expect(()=>check()).toThrow(/legacy.json.*new-id.*coverage-adopt/s);
  expect(()=>check([input],true)).not.toThrow(); // supplied strict recordings can package under a new ID
  save({...snapshot,game:undefined});expect(()=>check()).toThrow(/game identity mismatch/);
  writeFileSync(manifest,JSON.stringify({schema:'bgt-manifest/1',id:'new-id',pipeline:{modules}}));
  execFileSync(process.execPath,[join(ROOT,'tools/build/coverage-adopt.mjs'),'--input',input,'--manifest',manifest,'--out',out]);
  expect(()=>check([out])).not.toThrow();
  const adopted=JSON.parse(readFileSync(out,'utf8'));
  expect(adopted).toMatchObject({...snapshot,game:'new-id',adoption:{action:'explicit-game-identity-adoption',source_game:null,source_sha256:expect.stringMatching(/^[a-f0-9]{64}$/),manifest_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)}});
  expect(adopted.code).toEqual(snapshot.code);expect(adopted.modules).toEqual(modules);
  expect(()=>execFileSync(process.execPath,[join(ROOT,'tools/build/coverage-adopt.mjs'),'--input',input,'--manifest',manifest,'--out',out],{stdio:'pipe'})).toThrow(); // never overwrite
  save({...snapshot,game:'new-id',modules:[modules[0]]});
  expect(()=>check([input,out])).toThrow(/legacy.json.*module identity mismatch.*b.dll/s); // union must not mask a partial input
  expect(()=>check([input],true)).toThrow(/module identity mismatch/);
  expect(()=>execFileSync(process.execPath,[join(ROOT,'tools/build/coverage-adopt.mjs'),'--input',input,'--manifest',manifest,'--out',join(dir,'bad.json')],{stdio:'pipe'})).toThrow(); // cannot re-stamp module identities
  save({...snapshot,game:'new-id',modules:[modules[0],modules[0]]});expect(()=>check()).toThrow(/module identity mismatch/);
  save({...snapshot,game:'new-id',modules:[modules[0],{...modules[1],base:9000}]});expect(()=>check()).toThrow(/identity mismatch/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
