// @bgt-examples: none
/* eslint-disable @typescript-eslint/no-explicit-any */
// Original CC0 engineering A/B: same PE, exact archived dev14/dev15 sources;
// same linked bytes per postprocess pair. No game inputs or dependency installs.
import {it,expect} from 'vitest';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,symlinkSync,rmSync,cpSync} from 'node:fs';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadHeadless,ROOT} from '../../tests/support/headless';
// @ts-expect-error ESM section tools
import {sections,codeBodies} from '../build/wasm-sections.mjs';
// @ts-expect-error ESM name tools
import {functionNames} from '../build/wasm-names.mjs';
// @ts-expect-error ESM snapshot
import {resourceSnapshot} from '../probe/resources.mjs';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const median=(a:number[])=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
function stats(bytes:Buffer,names:{index:number;name:string}[]){
 const module=new WebAssembly.Module(bytes),imports=WebAssembly.Module.imports(module).filter(i=>i.kind==='function').length;
 const list=sections(bytes),bodies=codeBodies(list.find((s:any)=>s.id===10).data),map=new Map(names.map(n=>[n.index,n.name]));
 const groups:any={},functions=bodies.map((b:Buffer,i:number)=>{
  const name=map.get(i+imports)??'#'+(i+imports),group=/^[FNR]_[0-9a-f]/i.test(name)?name[0]:name.startsWith('x86_')?'x86':name.startsWith('w32_')?'w32':'other';
  groups[group]??={functions:0,bytes:0};groups[group].functions++;groups[group].bytes+=b.length;
  return {name,bytes:b.length};
 });
 return {bytes:bytes.length,sha256:sha(bytes),sections:list.map((s:any)=>({id:s.id,bytes:s.data.length})),groups,functions};
}
it('attributes whole versus partitioned output and profiling cost on the same CC0 scale PE',async()=>{
 const scratch=join(process.env.BGT_TRIAL_SCRATCH!,'attribution-b');mkdirSync(scratch,{recursive:true});
 const report:any={schema:'game-cask/size-attribution/1',node:process.version,count:2048,resources:resourceSnapshot(),rows:[]};
 const reportFile=join(process.env.BGT_TRIAL_SCRATCH!,'attribution-b.json');
 const save=()=>writeFileSync(reportFile,JSON.stringify(report,null,2)+String.fromCharCode(10));
 let expected:string[]|null=null,pe:Buffer|null=null;
 for(const variant of [{ref:'4bcc068',name:'dev14',profile:1},{ref:'3cbcb25',name:'dev15',profile:1},{ref:'3cbcb25',name:'dev15-profile-off',profile:0}]){
  const kit=join(scratch,'kit'),outRoot=join(scratch,'out');mkdirSync(kit,{recursive:true});
  const archive=execFileSync('git',['archive',variant.ref],{cwd:ROOT,maxBuffer:32*1048576});execFileSync('tar',['-xf','-','-C',kit],{input:archive});
  mkdirSync(join(kit,'node_modules'),{recursive:true});
  for(const name of readdirSync(join(ROOT,'node_modules')))if(name!=='.cache')symlinkSync(join(ROOT,'node_modules',name),join(kit,'node_modules',name));
  const fixture=join(kit,'fixture');mkdirSync(fixture,{recursive:true});
  let pipeline:any={platform:'win32',modules:[{from:'./scale.exe',main:true}]};
  if(!pe){
   cpSync(join(kit,'examples/x64-scale/generate.mjs'),join(fixture,'base.mjs'));
   writeFileSync(join(fixture,'generate.mjs'),
    "import {generate} from './base.mjs';import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';const sources=generate(process.argv[2],2048);const p=join(process.argv[2],'main.c');writeFileSync(p,readFileSync(p,'utf8').replace('for(unsigned i=0;i<2048;i++)','for(unsigned repeat=0;repeat<128;repeat++)for(unsigned i=0;i<2048;i++)').replace('v=fns[frame%2048](v,(double)(frame&255));','for(unsigned repeat=0;repeat<128;repeat++) v=fns[(frame+repeat)%2048](v,(double)(frame&255));'));console.log(JSON.stringify(sources));");
   pipeline={...pipeline,fixture:{target:'x86_64-windows-gnu',crt:true,out:'scale.exe',generator:'generate.mjs'},modules:[{from:'./build/scale.exe',main:true}]};
  }else writeFileSync(join(fixture,'scale.exe'),pe);
  writeFileSync(join(fixture,'game.json'),JSON.stringify({id:'k26-scale',name:'Original CC0 scale attribution',pipeline}));
  const linked=join(scratch,'linked.wasm'),child=join(scratch,'build.mjs');
  writeFileSync(child,
   'import {buildGame} from '+JSON.stringify(join(kit,'tools/build/build.mjs'))+';import {copyFileSync} from "node:fs";try{buildGame("fixture",{quiet:false,outRoot:'+JSON.stringify(outRoot)+',onLinkedWasm:p=>{copyFileSync(p,'+JSON.stringify(linked)+');throw new Error("K26_CAPTURED");}});}catch(e){if(e.message!=="K26_CAPTURED")throw e;}');
  const resources={start:resourceSnapshot(),end:null as any},t=performance.now();
  execFileSync(process.execPath,[child],{cwd:kit,stdio:'inherit',env:{...process.env,BGT_CPU_PROFILE:String(variant.profile),BGT_BUILD_JOBS:'2'}});
  const buildMs=performance.now()-t;resources.end=resourceSnapshot();
  if(!pe){pe=readFileSync(join(kit,'node_modules/.cache/bgt/pipeline/k26-scale/fixture/scale.exe'));report.pe_sha256=sha(pe);}
  const raw=readFileSync(linked),rawStats=stats(raw,functionNames(raw));
  const packageDir=join(outRoot,'k26-scale');
  const assets:any[]=[];
  const walk=(d:string)=>{for(const ent of readdirSync(d,{withFileTypes:true})){const p=join(d,ent.name);if(ent.isDirectory())walk(p);else assets.push({path:relative(join(packageDir,'assets'),p),size:readFileSync(p).length});}};
  walk(join(packageDir,'assets'));
  for(const mode of ['whole','local','partitioned']){
   const output=join(scratch,mode+'.wasm'),namesFile=join(scratch,mode+'.names');
   const remove=functionNames(raw).map((n:any)=>n.name).filter((n:string)=>/^N_[a-f0-9]{8}$/i.test(n));
   const flags=['--enable-bulk-memory','--enable-bulk-memory-opt','--enable-nontrapping-float-to-int','--enable-sign-ext','--enable-mutable-globals','-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield',...(remove.length?['--pass-arg=asyncify-removelist@'+remove.join(',')]:[]),'--print-function-map'];
   const start=performance.now();
   const actual=mode==='local'?flags.flatMap(f=>f==='-O2'?['--optimize-instructions','--precompute','--simplify-locals','--vacuum']: [f]):flags; if(mode==='local')actual.push('--optimize-instructions','--precompute','--simplify-locals','--vacuum','--preserve-type-order');
   const stdout=execFileSync(process.execPath,[join(ROOT,mode==='partitioned'?'tools/build/asyncify.mjs':'tools/build/binaryen-runner.mjs'),linked,...actual,...(mode==='partitioned'?['--bgt-partition-bytes=8388608']:[]),'-o',output],{encoding:'utf8',maxBuffer:32*1048576,stdio:['ignore','pipe','inherit']});
   const transformMs=performance.now()-start;writeFileSync(namesFile,stdout);
   const names=stdout.trim().split(String.fromCharCode(10)).map(l=>{const m=/^([0-9]+):(.*)$/.exec(l)!;return {index:Number(m[1]),name:m[2]};});
   const bytes=readFileSync(output),result=stats(bytes,names);cpSync(output,join(packageDir,'game.wasm'));
   writeFileSync(join(packageDir,'manifest.json'),JSON.stringify({id:'k26-scale',wasm:{url:'game.wasm',size:bytes.length,sha256:sha(bytes)},assets}));
   const wall:number[]=[],update:number[]=[],throughput:number[]=[],rawSamples:any[]=[];let runtime:any;
   for(let trial=0;trial<6;trial++){
    const h=await loadHeadless('k26-scale',{dir:packageDir}),hashes:string[]=[];
    const start=performance.now();
    for(let f=0;f<300;f++){await h.stepAsync();hashes.push(h.host.stateHash());}
    const wallMs=performance.now()-start;runtime=h.host.metrics();
    expect(runtime.interp_insns).toBe(0);expect(runtime.stubs).toEqual([]);expect(h.logs.some(l=>/FAIL/.test(l))).toBe(false);
    if(expected===null)expected=hashes;else expect(hashes).toEqual(expected);
    expect(h.logs.some(l=>l.includes('scale checksum'))).toBe(true);
    if(trial){wall.push(wallMs);update.push(runtime.host_profile.updateMs);throughput.push(runtime.lifted_calls/runtime.host_profile.updateMs*1000);}
    rawSamples.push({wallMs,updateMs:runtime.host_profile.updateMs,calls:runtime.lifted_calls});
   }
   report.rows.push({...variant,mode,buildMs,resources,transformMs,raw:rawStats,output:result,rawSamples,wallMsMedian:median(wall),updateMsMedian:median(update),liftedCallsPerSecond:median(throughput),trace_sha256:sha(Buffer.from(expected!.join(String.fromCharCode(10)))),rawInterpreterSampleUs:runtime.interpreter_exclusive_sample_us});save();
   console.log(JSON.stringify({variant:variant.name,mode,raw:raw.length,output:bytes.length,transformMs,updateMs:median(update),callsPerSecond:median(throughput)}));
  }
  rmSync(kit,{recursive:true,force:true});rmSync(outRoot,{recursive:true,force:true});
 }
 report.resourcesEnd=resourceSnapshot();save();
 rmSync(scratch,{recursive:true,force:true});
});
