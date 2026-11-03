// @bgt-examples: none
/* eslint-disable @typescript-eslint/no-explicit-any */
// Original CC0 scale source. Same exact PE, sequential builds; no game evidence.
import {it,expect} from 'vitest';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ROOT,loadHeadless} from '../../tests/support/headless';
// @ts-expect-error plain ESM
import {buildGame} from '../build/build.mjs';
// @ts-expect-error original CC0 source generator
import {generate} from '../../examples/x64-scale/generate.mjs';
// @ts-expect-error plain ESM resource observer
import {resourceSnapshot} from '../probe/resources.mjs';
it('measures coverage versus every analyzed function on two late-phase scale sizes',async()=>{
 const rows:any[]=[];
 const report=process.env.BGT_SELECTION_REPORT ?? 'reports/k21/selection.json';
 mkdirSync(join(ROOT,'reports/k21'),{recursive:true});
 for(const count of (process.env.BGT_SELECTION_COUNTS ?? '256,12000').split(',').map(Number)){
  const id='k21-selection-'+count,dir=join(ROOT,'node_modules/.cache/bgt',id);mkdirSync(dir,{recursive:true});
  const sources=generate(dir,count);
  const main=join(dir,'main.c');
  // Delay the large indirect phase; do not change any generated arithmetic.
  writeFileSync(main,readFileSync(main,'utf8').replace('for(unsigned i=0;i<',`
#ifdef _WIN32
Sleep(17);
#endif
for(unsigned i=0;i<`));
  const cfg:any={id,name:'Original CC0 selection cost',pipeline:{platform:'win32',fixture:{target:'x86_64-windows-gnu',crt:true,sources,out:'scale.exe',libs:['kernel32']},modules:[{from:'./build/scale.exe',main:true}]}};
  const save=()=>writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));
  try{
   save();const seed=buildGame(dir,{quiet:true,interpretOnly:true});
   const h=await loadHeadless(id+'-interp');await h.stepAsync(1);
   const snapshot={schema:'game-cask/coverage/1',game:id,modules:seed.pipeline.modules,files:[],interpreter:h.host.interpreterCoverage(),code:[...h.host.codeCoverage].map(([address,kind])=>({address,kind})),metrics:{code_entries_dropped:h.host.codeCoverageDropped,execution:h.host.metrics()}};
   writeFileSync(join(dir,'early.json'),JSON.stringify(snapshot));
   copyFileSync(join(ROOT,'node_modules/.cache/bgt/pipeline',id+'-interp','fixture/scale.exe'),join(dir,'scale.exe'));
   delete cfg.pipeline.fixture;cfg.pipeline.modules[0].from='./scale.exe';cfg.pipeline.coverage=['early.json'];
   const inputSha256=createHash('sha256').update(readFileSync(join(dir,'scale.exe'))).digest('hex');
   let expected:string[]|null=null;
   for(const mode of ['coverage','all']){
    cfg.pipeline.selection=mode;save();
    const resources={start:resourceSnapshot(),end:null as unknown},started=performance.now();
    const manifest=buildGame(dir,{quiet:true});const wallMs=performance.now()-started;
    const runtime=await loadHeadless(id);const trace:string[]=[];
    const runStart=performance.now();for(let i=0;i<300;i++){await runtime.stepAsync(1);trace.push(runtime.host.stateHash()!);}
    const runMs=performance.now()-runStart,metrics:any=runtime.host.metrics();
    expect(runtime.logs.some(s=>/FAIL|BAD/.test(s))).toBe(false);expect(metrics.stubs).toEqual([]);
    expect(runtime.logs.some(s=>s.includes('scale checksum'))).toBe(true);
    if(expected)expect(trace).toEqual(expected);else expected=trace;
    if(mode==='coverage')expect(metrics.interp_insns).toBeGreaterThan(0);else expect(metrics.interp_insns).toBe(0);
    resources.end=resourceSnapshot();
    rows.push({count,mode,input_sha256:inputSha256,early_interpreter_instructions:(snapshot.metrics.execution as any).interp_insns,resources,wall_ms:wallMs,run_ms_300_updates:runMs,wasm_bytes:manifest.wasm.size,
     packaging:manifest.packaging,selection:manifest.pipeline.modules[0].selection,build:manifest.pipeline.metrics,
     trace_sha256:createHash('sha256').update(JSON.stringify(trace)).digest('hex'),execution_summary:metrics.execution_summary});
    writeFileSync(report,JSON.stringify({schema:'game-cask/selection-benchmark/1',revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,
     method:'Same generated PE per size, early 1-update recording then coverage/all, sequential shared-machine builds; cache states in build; 300 per-update trace hashes identical, no GPU rasterization. Not cold/idle speed claims.',rows},null,2)+'\n');
   }
  }finally{
   for(const path of [dir,join(ROOT,'web/public/games',id),join(ROOT,'web/public/games',id+'-interp'),join(ROOT,'node_modules/.cache/bgt/pipeline',id),join(ROOT,'node_modules/.cache/bgt/pipeline',id+'-interp')])rmSync(path,{recursive:true,force:true});
  }
 }
});
