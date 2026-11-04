// @bgt-examples: none
// CC0: catches omitted/replaced bodies, unsafe inter-shard call graph analysis,
// changed index spaces, and lost live locals across indirect/deep suspension.
import {beforeAll,afterAll,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {jspiApi} from '../../bgt/runtime/jspi';
// @ts-expect-error ESM build orchestration
import {transform} from '../../tools/build/asyncify.mjs';
// @ts-expect-error Original CC0 stress generator
import {suspensionFixture} from '../../tools/build/suspension-fixture.mjs';
// @ts-expect-error Original CC0 mathematical/differential oracle
import {suspensionOracle} from '../../tools/build/suspension-oracle.mjs';
// @ts-expect-error ESM binary section access
import {sections,encodeSections,codeBodies,codeSection} from '../../tools/build/wasm-sections.mjs';
// @ts-expect-error ESM function names
import {encodeFunctionNames} from '../../tools/build/wasm-names.mjs';
let dir:string,input:string,output:string,raw:Buffer;
beforeAll(()=>{dir=mkdtempSync(join(tmpdir(),'bgt-suspension-test-'));input=join(dir,'input.wasm');output=join(dir,'out.wasm');raw=suspensionFixture({functions:37,rounds:30});writeFileSync(input,raw);});
afterAll(()=>rmSync(dir,{recursive:true,force:true}));
it('transforms every body and preserves 300 checksum frames and 10500 actual deep parked stacks',async()=>{
 const result=transform(input,output,['-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield'],{partitionBytes:8192,wholeLimit:0});
 expect(result.partitions).toBeGreaterThan(1);
 const oracle=await suspensionOracle(raw,readFileSync(output),{functions:37,rounds:30,jspi:!!jspiApi()});
 expect(oracle.ownersExecuted).toBe(37);expect(oracle.frames).toBe(300);expect(oracle.yields.asyncify).toBe(10500);
 expect(oracle.asyncChecks).toEqual(oracle.plainChecks);
 if(jspiApi())expect(oracle.jspiChecks).toEqual(oracle.plainChecks);
});
it('refuses changed index spaces before publication, with no output artifact',()=>{
 const out=join(dir,'invalid.wasm');let count=0;
 const run=(exe:string,args:string[],options:any)=>{
  const names=execFileSync(exe,args,options);
  if(++count===2){const path=args[args.indexOf('-o')+1],list=sections(readFileSync(path));list.find((s:any)=>s.id===5).data=Buffer.from([1,0,3]);writeFileSync(path,encodeSections(list));}
  return names;
 };
 expect(()=>transform(input,out,['--asyncify','--pass-arg=asyncify-imports@bgt.yield'],{partitionBytes:8192,wholeLimit:0,run})).toThrow(/index-space/);
 expect(existsSync(out)).toBe(false);
});
it('keeps duplicate/absent source names and exact removelists safe through canonical index identities',async()=>{
 const list=sections(raw).filter((s:any)=>s.id!==0),renamed=Buffer.concat([encodeSections(list),encodeFunctionNames([{index:4,name:'duplicate'},{index:5,name:'duplicate'},{index:42,name:'buffer'}])]);
 const file=join(dir,'duplicate.wasm'),out=join(dir,'duplicate-out.wasm');writeFileSync(file,renamed);
 transform(file,out,['--asyncify','--pass-arg=asyncify-imports@bgt.yield','--pass-arg=asyncify-removelist@buffer'],{partitionBytes:8192,wholeLimit:0});
 const result=await suspensionOracle(renamed,readFileSync(out),{functions:37,rounds:30,jspi:!!jspiApi()});expect(result.asyncChecks).toEqual(result.plainChecks);
});
it('fails oversized individual bodies with an actionable diagnostic before launching Binaryen',()=>{
 const list=sections(raw),code=list.find((s:any)=>s.id===10),bodies=codeBodies(code.data);bodies[0]=Buffer.alloc(16*1048576+1);code.data=codeSection(bodies);
 const file=join(dir,'too-large.wasm');writeFileSync(file,encodeSections(list));
 expect(()=>transform(file,output,['--asyncify','--pass-arg=asyncify-imports@bgt.yield'],{wholeLimit:0})).toThrow(/16 MiB per-function safety limit/);
});
it('reports malformed input and invalid budgets instead of opaque C++ errors',()=>{
 expect(()=>transform(input,output,[],{partitionBytes:0})).toThrow(/partition bytes/);
 expect(()=>transform(input,output,['--asyncify','--inlining'],{wholeLimit:0})).toThrow(/unsupported partitioned Asyncify option/);
 const bad=join(dir,'bad.wasm');writeFileSync(bad,'not wasm');
 expect(()=>transform(bad,output)).toThrow(/wasm/);
});
