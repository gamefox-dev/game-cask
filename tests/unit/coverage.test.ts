// Discovery uses actual recordings, not filtered/fabricated target addresses.
import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,copyFileSync,mkdirSync} from 'node:fs';
import {join,relative,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {ROOT,loadHeadless} from '../support/headless';
import {compileC} from '../support/compile';
import {GameHost,CODE_COVERAGE_LIMIT,OutsideSlice} from '../../bgt/runtime/host';
import {Vfs} from '../../bgt/runtime/vfs';
// @ts-expect-error plain ESM
import {coveragePlan,staticClosure,owningRanges,rangeOwner} from '../../tools/build/coverage.mjs';
// @ts-expect-error plain ESM
import {buildGame} from '../../tools/build/build.mjs';

it('maps interior continuations to their owner, preferring .pdata, with half-open boundaries and call closure',()=>{
 const functions=[{addr:100,end:200,unwindRange:true,calls:[305]},
  {addr:120,end:140,calls:[]},{addr:200,end:210,calls:[]},{addr:300,end:320,calls:[400]},
  {addr:400,end:410,calls:[]},{addr:500,end:510,calls:[]}];
 const ranges=owningRanges({functions});
 expect(rangeOwner(ranges,125)).toBe(100);expect(rangeOwner(ranges,199)).toBe(100);
 expect(rangeOwner(ranges,200)).toBe(200);expect(rangeOwner(ranges,210)).toBeUndefined();
 expect(staticClosure({functions},new Set([125,319,999]))).toEqual([100,300,400]);
 expect(staticClosure({functions},new Set([120]))).toEqual([100,300,400]);
});

it('owning interval sweep scales and agrees with an independent enclosing-range scan',()=>{
 const functions=Array.from({length:1000},(_,i)=>({addr:i*3,end:i*3+10+(i%7),unwindRange:i%19===0,calls:[]}));
 const ranges=owningRanges({functions});
 for(let addr=0;addr<3020;addr++){
  const expected=functions.filter(f=>addr>=f.addr&&addr<f.end).sort((a,b)=>Number(!!b.unwindRange)-Number(!!a.unwindRange)||b.addr-a.addr)[0]?.addr;
  expect(rangeOwner(ranges,addr)).toBe(expected);
 }
 const big=owningRanges({functions:Array.from({length:50000},(_,i)=>({addr:0x1000000+i*32,end:0x1000000+i*32+24,calls:[]}))});
 expect(big).toHaveLength(50000);expect(rangeOwner(big,0x1000000+49999*32+12)).toBe(0x1000000+49999*32);
});

it('counts actual interpreted instructions, dynamic block entries and unique owners in both widths, excluding pre-execution quantum transfers',async()=>{
 for(const mode of [0,1]) {
  const events:number[]=[];
  const {instance}=await WebAssembly.instantiate(await compileC('tests/fixtures/c/coverage_accounting.c',[`MODE64=${mode}`]),{bgt:{coverage_entry:(addr:number)=>events.push(addr),abort:()=>{throw new Error('unexpected guest abort');}}});
  const ex=instance.exports as any;
  ex.run(0);expect(ex.insns()).toBe(12);expect(ex.entries()).toBe(6);expect(ex.functions()).toBe(2);expect(ex.unowned()).toBe(0);expect(ex.result()).toBe(1);
  expect(events).toEqual([0x1000,0x1005,0x1005,0x1009,0x1020,0x100e]);
  events.length=0;ex.run(2000000);expect(ex.insns()).toBe(0);expect(ex.entries()).toBe(0);expect(ex.functions()).toBe(0);
  ex.resume();expect(ex.insns()).toBe(12);expect(ex.entries()).toBe(6);expect(ex.functions()).toBe(2);expect(ex.result()).toBe(1);
 }
});

it('records owned-to-unowned fall-through once and stops a strict slice before executing the unowned instruction in both widths',async()=>{
 for(const mode of [0,1]) {
  const wasm=await compileC('tests/fixtures/c/coverage_accounting.c',[`MODE64=${mode}`]);
  const cfg={backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0};
  const services={log:()=>{},vfs:new Vfs(),now:()=>0};
  const discovery=await GameHost.create(wasm,services,cfg);discovery.init();
  const ex=(discovery as any).exports;ex.gap();
  expect(ex.result()).toBe(123);expect(ex.insns()).toBe(5);expect(ex.entries()).toBe(2);expect(ex.unowned()).toBe(1);expect(ex.functions()).toBe(1);
  expect([...discovery.codeCoverage.keys()]).toEqual([0x1000,0x1001]);
  const strict=await GameHost.create(wasm,services,{...cfg,sliceCode:[0x1000],sliceCodeRanges:[{addr:0x1000,end:0x1001}]});strict.init();
  const sx=(strict as any).exports;expect(()=>sx.gap()).toThrow(OutsideSlice);
  expect(sx.result()).toBe(0);expect(sx.insns()).toBe(1);expect(sx.entries()).toBe(1);expect(sx.unowned()).toBe(0);
  expect([...strict.codeCoverage.keys()]).toEqual([0x1000,0x1001]);
 }
});

it('attributes each interpreted owner correctly across a reentrant AMD64 quantum callback',async()=>{
 const wasm=await compileC('tests/fixtures/c/coverage_accounting.c',['MODE64=1']);
 const {instance}=await WebAssembly.instantiate(wasm,{bgt:{coverage_entry:()=>{},abort:()=>{throw new Error('unexpected abort');}}});
 const ex=instance.exports as any;ex.nested();
 expect(ex.insns()).toBe(2);expect(ex.entries()).toBe(2);expect(ex.functions()).toBe(2);expect(ex.unowned()).toBe(0);
});

it('unions successive recordings but rejects real overflow and conflicting module identity',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bgt-coverage-'));
 try {
  const snap=(code:number[],sha256='a')=>({schema:'game-cask/coverage/1',modules:[{name:'probe.exe',base:0x1000000,sha256}],files:[],code:code.map(address=>({address,kind:2})),metrics:{code_entries_dropped:0}});
  writeFileSync(join(dir,'a.json'),JSON.stringify(snap([100,120])));writeFileSync(join(dir,'b.json'),JSON.stringify(snap([120,300])));
  expect([...coveragePlan(['a.json','b.json'],dir).code]).toEqual([100,120,300]);
  writeFileSync(join(dir,'b.json'),JSON.stringify(snap([300],'b')));
  expect(()=>coveragePlan(['a.json','b.json'],dir)).toThrow(/identities disagree/);
  writeFileSync(join(dir,'b.json'),JSON.stringify({...snap([300]),metrics:{code_entries_dropped:1}}));
  expect(()=>coveragePlan(['b.json'],dir)).toThrow(/overflowed/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('host deduplicates kinds beyond the old cap, bounds recordings, and enforces strict owning-range stops',async()=>{
 const wasm=await compileC('tests/fixtures/c/coverage_probe.c');
 const config={backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0};
 const services={log:()=>{},vfs:new Vfs(),now:()=>0};
 const host=await GameHost.create(wasm,services,config);host.init();
 // Test-only exports call the real imported hook, including normal wasm u32 coercion.
 const ex=(host as any).exports as {fill:(n:number)=>void;emit:(addr:number,kind:number)=>void};
 ex.fill(CODE_COVERAGE_LIMIT);expect(host.codeCoverage.size).toBe(CODE_COVERAGE_LIMIT);expect(host.codeCoverageDropped).toBe(0);
 ex.emit(70000,1);ex.emit(70000,2);expect(host.codeCoverage.get(70000)).toBe(3);
 ex.emit(CODE_COVERAGE_LIMIT,2);expect(host.codeCoverageDropped).toBe(1);
 ex.emit(CODE_COVERAGE_LIMIT,2);expect(host.codeCoverageDropped).toBe(2); // dropped EVENTS, never false completeness
 const strict=await GameHost.create(wasm,services,{...config,sliceCode:[500],sliceCodeRanges:[{addr:100,end:110},{addr:200,end:210}]});strict.init();
 const emit=(strict as any).exports.emit as (addr:number,kind:number)=>void;
 emit(100,2);emit(109,1);emit(205,2);emit(500,1);
 for(const addr of [99,110,199,210,501])expect(()=>emit(addr,2)).toThrow(OutsideSlice);
 expect(strict.codeCoverage.has(110)).toBe(true); // record the outside-slice stop before throwing
 host.codeCoverage.clear();
});

it('two successive selective builds converge on a >65k-instruction workload from real entry/continuation recordings',async()=>{
 const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/coverage-discovery-'));
 const id=basename(dir).toLowerCase();
 const cfg:any={id,name:'CC0 discovery',private:false,license:'CC0-1.0',pipeline:{platform:'win32',interpretOnly:true,
  fixture:{target:'x86_64-windows-gnu',sources:[relative(dir,join(ROOT,'tests/fixtures/coverage/discovery.S'))],out:'discovery.exe',entry:'entry',libs:['kernel32']},
  modules:[{from:'./build/discovery.exe',name:'discovery.exe',main:true}],width:64,height:64}};
 const config=join(dir,'game.json');
 const save=()=>writeFileSync(config,JSON.stringify(cfg));
 const snapshot=(h:any,manifest:any)=>({schema:'game-cask/coverage/1',modules:manifest.pipeline.modules,files:[],
  code:[...h.host.codeCoverage].map(([address,kind]:any)=>({address,kind})),metrics:{code_entries_dropped:h.host.codeCoverageDropped,execution:h.host.metrics()}});
 try {
  save();buildGame(dir,{quiet:true});
  const manifest=JSON.parse(readFileSync(join(ROOT,'web/public/games',id,'manifest.json'),'utf8'));
  const initial=await loadHeadless(id);await initial.stepAsync(1);
  writeFileSync(join(dir,'early.json'),JSON.stringify(snapshot(initial,manifest)));
  await initial.stepAsync(7);
  const baseline:any=initial.host.metrics();
  expect(baseline.interp_insns).toBeGreaterThan(70000);expect(baseline.interp_code_entries).toBeGreaterThan(0);
  expect(baseline.interp_functions).toBe(2);expect(baseline.interp_unowned_entries).toBe(0);
  expect(initial.host.codeCoverage.size).toBeLessThan(30);expect(initial.host.codeCoverageDropped).toBe(0);
  // Preserve the exact synthetic PE across iterations (relinking may embed timestamps/debug paths).
  copyFileSync(join(ROOT,'node_modules/.cache/bgt/pipeline',id+'-interp','fixture/discovery.exe'),join(dir,'discovery.exe'));
  delete cfg.pipeline.fixture;cfg.pipeline.modules[0].from='./discovery.exe';
  delete cfg.pipeline.interpretOnly;cfg.pipeline.coverage=['early.json'];save();buildGame(dir,{quiet:true});
  const first=await loadHeadless(id);await first.stepAsync(8);
  const one:any=first.host.metrics();expect(one.interp_insns).toBe(70003);expect(one.interp_code_entries).toBe(2);expect(one.interp_functions).toBe(1);
  expect(first.logs).toContain('guest: coverage known result 123');expect(first.host.codeCoverage.size).toBeLessThan(30);
  writeFileSync(join(dir,'more.json'),JSON.stringify(snapshot(first,manifest)));
  cfg.pipeline.coverage=['early.json','more.json'];save();buildGame(dir,{quiet:true});
  const second=await loadHeadless(id);await second.stepAsync(8);
  const two:any=second.host.metrics();expect(two.interp_insns).toBe(0);expect(two.interp_code_entries).toBe(0);expect(two.interp_functions).toBe(0);
  expect(second.logs).toEqual(first.logs);expect(second.host.codeCoverageDropped).toBe(0);
  const interpreted=[...first.host.codeCoverage].filter(([,kind])=>kind&2).map(([addr])=>addr);
  expect(interpreted).toHaveLength(2); // body start AND an interior entry in the same .pdata range
  for(const addr of interpreted)expect((second.host.codeCoverage.get(addr) ?? 0)&1).toBe(1);
  // The same recorded workload also works when range-normalized selection is enforced strictly.
  cfg.slice={coverage:['early.json','more.json']};save();buildGame(dir,{quiet:true});
  const sliced=await loadHeadless(id);await sliced.stepAsync(8);expect(sliced.logs).toEqual(second.logs);
  cfg.pipeline.interpretOnly=true;save();buildGame(dir,{quiet:true});
  const reference=await loadHeadless(id);await reference.stepAsync(8);expect(reference.logs).toEqual(second.logs);
  expect((reference.host.metrics() as any).interp_insns).toBe(baseline.interp_insns);
  mkdirSync(join(ROOT,'reports'),{recursive:true});
  writeFileSync(join(ROOT,'reports/coverage-discovery.json'),JSON.stringify({
    workload:'CC0 70000-NOP indirect function + interior continuation, 8 frames',
    initial:baseline,selective:[one,two],
    uniqueEntries:[initial.host.codeCoverage.size,first.host.codeCoverage.size,second.host.codeCoverage.size],
    dropped:[initial.host.codeCoverageDropped,first.host.codeCoverageDropped,second.host.codeCoverageDropped],
  },null,2)+'\n');
 }finally{
  for(const path of [dir,join(ROOT,'web/public/games',id),join(ROOT,'node_modules/.cache/bgt/pipeline',id),join(ROOT,'node_modules/.cache/bgt/pipeline',id+'-interp')])rmSync(path,{recursive:true,force:true});
 }
},180_000);
