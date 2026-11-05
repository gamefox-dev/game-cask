// @bgt-examples: none
// Original CC0-1.0. Emitted code + production dispatcher, not boundary substitutes.
import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../support/headless';
import { compileC } from '../support/compile';
import { jspiApi } from '../../bgt/runtime/jspi';
// @ts-expect-error plain ESM
import { registryRows, liftChunks, analyzeCached } from '../../tools/build/chunks.mjs';
// @ts-expect-error plain ESM
import { CFLAGS, LDFLAGS, WASM_OPT_FEATURES } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { requireZig } from '../../tools/build/toolchain.mjs';
// @ts-expect-error plain ESM
import { transform } from '../../tools/build/asyncify.mjs';
// @ts-expect-error plain ESM
import { functionNames } from '../../tools/build/wasm-names.mjs';
import { instantiateFixture } from '../support/wasm-fixture';
import { perTestTool } from '../support/per-test-tool';
// @ts-expect-error plain ESM
import { x86tool } from '../../tools/build/pipeline.mjs';
const tool=perTestTool(x86tool);
function pe(code:Buffer, cuts:number[]) {
 const b=Buffer.alloc(0x400+Math.ceil(code.length/512)*512);
 b.write('MZ');b.writeUInt32LE(0x80,0x3c);b.write('PE\0\0',0x80);b.writeUInt16LE(0x8664,0x84);b.writeUInt16LE(2,0x86);b.writeUInt16LE(240,0x94);b.writeUInt16LE(0x20b,0x98);
 b.writeUInt32LE(0x1000,0xa8);b.writeBigUInt64LE(0x1000n,0xb0);b.writeUInt32LE(0x10000,0xd0);b.writeUInt32LE(0x200,0xd4);b.writeUInt32LE(0x200,0x98+112+24);b.writeUInt32LE(cuts.length*12,0x98+116+24);
 for(const [i,name,rva,size,raw] of [[0,'.text',0x1000,code.length,0x400],[1,'.pdata',0x200,cuts.length*12,0x200]] as const){const s=0x188+i*40;b.write(name,s);b.writeUInt32LE(size,s+8);b.writeUInt32LE(rva,s+12);b.writeUInt32LE(size,s+16);b.writeUInt32LE(raw,s+20);b.writeUInt32LE(i?0x40000040:0x60000020,s+36);}
 cuts.forEach((off,i)=>{b.writeUInt32LE(0x1000+off,0x200+i*12);b.writeUInt32LE(0x1000+(cuts[i+1]??code.length),0x204+i*12);});code.copy(b,0x400);return b;
}
async function harness(code:Buffer,cuts:number[],preset:string,select?:number[],layout?:'split'|'override',suspension?:'asyncify'|'jspi',accounting=1) {
 const root=join(ROOT,'node_modules/.cache/bgt/native-calls');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-'));
 try{
  writeFileSync(join(dir,'test.exe'),pe(code,cuts));
  if(select)writeFileSync(join(dir,'selected.txt'),select.map(n=>n.toString(16)).join('\n'));
  execFileSync(tool(),['lift',join(dir,'test.exe'),'--base','1000','--name','probe','--out',join(dir,'lifted.c'),'--lift-preset',preset,...(select?['--select',join(dir,'selected.txt')]:[])]);
  let text=readFileSync(join(dir,'lifted.c'),'utf8');
  const extra:string[]=[];
  if(layout){
   const allRows=[];
   for(const [i,off] of cuts.entries()){
    const list=join(dir,'select'+i+'.txt'),out=join(dir,'part'+i+'.c');
    writeFileSync(list,(0x2000+off).toString(16));
    execFileSync(tool(),['lift',join(dir,'test.exe'),'--base','1000','--name','part'+i,'--out',out,'--lift-preset',preset,'--select',list,...(layout==='override'?['--skip','2040']:[])]);
    const part=readFileSync(out,'utf8');allRows.push(...registryRows(part));extra.push(out);
   }
   text='#include "x86_lift64.h"\n'+allRows.flatMap(r=>r.declarations).join('\n')+'\nconst x86_lifted_entry_t x86_lifted_probe[]={\n'+allRows.map(r=>r.row).join('\n')+'\n};\nconst unsigned x86_lifted_probe_count='+allRows.length+';\n';
   if(layout==='override')text+='void F_00002040(void){X.tsc++;X.r[0]=19;X.eip=(uint32_t)x86_pop();}\n';
  }
  writeFileSync(join(dir,'test.c'),'#define X86_ACCOUNTING_ENABLED '+accounting+'\n#define X86_NATIVE_STATS 1\n#define X86_FLAT_GUEST 1\n#define X86_FLAT_BYTES 65536ull\n#define X86_PROFILE_ENABLED 0\n#define X86_COVERAGE_MODE 0\nstatic const unsigned char test_code[]={'+[...code].join(',')+'};\n'+text.replace('#include "x86_lift64.h"','#include "'+ROOT+'/platforms/x86/x86_lift64.h"')+'\n#include "'+ROOT+'/tests/fixtures/c/native_calls_harness.h"\n');
  let raw:Uint8Array<ArrayBuffer>;
  if(extra.length||suspension){
   const out=join(dir,'raw.wasm');
   execFileSync(requireZig({quiet:true}).path,['cc',...CFLAGS,'-DX86_ACCOUNTING_ENABLED='+accounting,'-DX86_NATIVE_STATS=1','-DX86_FLAT_GUEST=1','-DX86_FLAT_BYTES=65536ull','-DX86_PROFILE_ENABLED=0','-DX86_COVERAGE_MODE=0','-I',join(ROOT,'bgt/include'),'-I',join(ROOT,'platforms/x86'),join(dir,'test.c'),...extra,join(ROOT,'bgt/sdk/bgt_libc.c'),...LDFLAGS.filter((f:string)=>f!=='-Wl,--strip-debug'),'-o',out]);
   raw=new Uint8Array(readFileSync(out));
  }else raw=await compileC(relative(ROOT,join(dir,'test.c')));
  if(suspension==='asyncify'){
   const input=join(dir,'raw.wasm'),out=join(dir,'async.wasm');writeFileSync(input,raw);
   const linked=new Set(functionNames(raw).map((n:{name:string})=>n.name));
   const names=[...text.matchAll(/void (N_[0-9a-f]+)\(uint32_t\)/g)].map(m=>m[1]).filter(n=>linked.has(n));
   expect(names.length).toBeGreaterThan(0);
   transform(input,out,[...WASM_OPT_FEATURES,'-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield',...(names.length?['--pass-arg=asyncify-removelist@'+[...new Set(names)].join(',')]:[])]);
   raw=new Uint8Array(readFileSync(out));
  }
  const {exports,host}=await instantiateFixture(raw,suspension?{suspensionMode:suspension}:{});
  const ex=exports as unknown as {memory:WebAssembly.Memory;prepare(i:number,pc:number,b:number):void;execute():void;resume():void;cpu():number;cpu_size():number;ram():number;stats():number;interpretation():number;generic():number;set_reg(i:number,v:bigint):void;configure_service(n:number):void;service_count():number;service_frames():number;service_complete():number;retired():bigint;thread_retired():bigint};
  const snap=()=>({retired:ex.retired(),threadRetired:ex.thread_retired(),cpu:new Uint8Array(ex.memory.buffer).slice(ex.cpu(),ex.cpu()+ex.cpu_size()),ram:new Uint8Array(ex.memory.buffer).slice(ex.ram()+0x1000,ex.ram()+0xa000)});
  return {ex,host,text,snap,stats:()=>Array.from(new BigUint64Array(ex.memory.buffer,ex.stats(),6),Number),peak:()=>new DataView(ex.memory.buffer).getUint32(ex.stats()+48,true)};
 } finally {rmSync(dir,{recursive:true,force:true});}
}
// Caller makes two tiny calls; callee clobbers a register unused by the caller,
// exercising full spill/reload and a recursive chain with RET $16 stack cleanup.
function recursive() {
 const code=Buffer.alloc(0x90,0x90);
 Buffer.from('b811000000b964000000e83100000083c001c3','hex').copy(code);
 Buffer.from('49bc887766554433221185c9740f4883ec28ffc9e8270000004883c428ffc0c3','hex').copy(code,0x40);
 Buffer.from('4883ec28e8b7ffffff4883c428c3','hex').copy(code,0x80);
 return code;
}
it('resolves full-width constant-base tables but refuses segment and clobbered-base speculation',()=>{
 const root=join(ROOT,'node_modules/.cache/bgt/native-calls');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'table-'));
 try {
  for(const [prefix,expected] of [['4c8d0579000000',0],['4c8d05790000004531c0',1],['4c8d057900000065',1],['4c8d05790000000fa2',1],['4c8d05790000004990',1]] as const){
   const code=Buffer.alloc(0x98,0x90);Buffer.from(prefix+'41ff24d0','hex').copy(code);code[0x20]=code[0x30]=0xc3;
   code.writeBigUInt64LE(0x2020n,0x80);code.writeBigUInt64LE(0x2030n,0x88);code.writeBigUInt64LE(0n,0x90);
   const input=pe(code,[0]);input.writeUInt32LE(0x1040,0x204);writeFileSync(join(dir,'table.exe'),input);
   const analysis=JSON.parse(execFileSync(tool(),['analyze',join(dir,'table.exe'),'--base','1000'],{encoding:'utf8'}));
   expect(analysis.totals.unresolvedIndirectJumps,prefix).toBe(expected);
  }
 } finally {rmSync(dir,{recursive:true,force:true});}
});
it.each(['size','fast'])('bounded direct calls preserve all CPU bytes, stack, quantum and deep recursion (%s)',async(preset)=>{
 const h=await harness(recursive(),[0,0x40,0x80],preset);
 expect(h.text).toContain('x86_native_enter');
 for(const budget of [0,1999990,1999999,2000000]){
  h.ex.prepare(0,0x2000,budget);h.ex.execute();const got=h.snap();const peak=h.peak();const stats=h.stats();
  expect(h.ex.interpretation()).toBe(0);expect(peak).toBeLessThanOrEqual(32);
  if(!budget){expect(peak).toBe(32);expect(stats[1]).toBeGreaterThan(50);expect(stats[0]).toBeGreaterThan(1); /* cap returns to flat dispatch; it need not resume every discarded fast frame */}
  h.ex.prepare(1,0x2000,budget);h.ex.execute();expect(got).toEqual(h.snap());
 }
});
it.each(['size','fast'])('indirect calls and cold generic exits retain exact state (%s)',async(preset)=>{
 // mov rax,callee; call rax; inc eax; ret; callee: CPUID; mov eax,7; ret
 const code=Buffer.alloc(0x50,0x90);Buffer.from('48c7c040200000ffd0ffc0c3','hex').copy(code);Buffer.from('0fa2b807000000c3','hex').copy(code,0x40);
 const h=await harness(code,[0,0x40],preset);
 h.ex.prepare(0,0x2000,0);h.ex.execute();const got=h.snap();expect(h.ex.interpretation()).toBe(0);expect(h.ex.generic()).toBe(1);expect(h.ex.retired()).toBe(7n);
 h.ex.prepare(1,0x2000,0);h.ex.execute();expect(got).toEqual(h.snap());
});
it.each(['size','fast'])('weak missing selection links and falls back; RET imm and high indirect faults preserve exact state (%s)',async(preset)=>{
 const code=Buffer.alloc(0x50,0x90);Buffer.from('4883ec10e837000000c3','hex').copy(code);Buffer.from('b807000000c21000','hex').copy(code,0x40);
 for(const select of [undefined,[0x2000]]){
  const h=await harness(code,[0,0x40],preset,select);h.ex.prepare(0,0x2000,0);h.ex.execute();const got=h.snap();
  if(select){expect(h.text).toContain('__attribute__((weak)) void N_00002040');expect(h.stats()[1]).toBe(0);expect(h.ex.interpretation()).toBeGreaterThan(0);}
  else {expect(h.stats()[1]).toBe(1);expect(h.stats()[2]).toBe(1);expect(h.ex.interpretation()).toBe(0);}
  h.ex.prepare(1,0x2000,0);h.ex.execute();expect(got).toEqual(h.snap());
 }
 const h=await harness(Buffer.from('ffd0c3','hex'),[0],preset);
 h.ex.prepare(0,0x2000,0);h.ex.set_reg(0,0x100002000n);expect(()=>h.ex.execute()).toThrow();const got=h.snap();
 h.ex.prepare(1,0x2000,0);h.ex.set_reg(0,0x100002000n);expect(()=>h.ex.execute()).toThrow();expect(got).toEqual(h.snap());
});
it.each(['size','fast'])('cross-region fallthrough and conditional backedges remain inside the owner (%s)',async(preset)=>{
 const code=Buffer.concat([Buffer.from('b90300000031c0','hex'),Buffer.from('ffc0'.repeat(600),'hex'),Buffer.from('ffc9','hex'),Buffer.alloc(6),Buffer.from('c3','hex')]);
 code[1209]=0x0f;code[1210]=0x85;code.writeInt32LE(7-1215,1211);
 for(const accounting of [0,1]){
  const h=await harness(code,[0],preset,undefined,undefined,undefined,accounting);h.ex.prepare(0,0x2000,0);h.ex.execute();const got=h.snap();expect(h.ex.interpretation()).toBe(0);expect(h.stats()[3]).toBeGreaterThan(0);expect(h.ex.retired()).toBe(accounting?1809n:0n);
  h.ex.prepare(1,0x2000,0);h.ex.execute();expect(got).toEqual(h.snap());
 }
});

// Known answers exercise warm exact-PC sites and cross-chunk weak N calls in
// both accounting modes. OFF must leave all counters zero without disabling K32.
for(const accounting of [0,1])for(const suspension of ['asyncify',...(jspiApi()?['jspi']:[])] as ('asyncify'|'jspi')[])
it('exact warm indirect CALL/tail retirement, separate objects '+accounting+' '+suspension,async()=>{
 for(const tail of [false,true]){
  const code=Buffer.alloc(0x100,0x90);
  Buffer.from('b9040000004c8d05b4000000','hex').copy(code);
  const next=tail?17:15;
  Buffer.from(tail?'e82f000000':'41ff10','hex').copy(code,12);
  Buffer.from('ffc97500c3','hex').copy(code,next);code[next+3]=256+12-(next+4);
  if(tail)Buffer.from('41ff20','hex').copy(code,0x40);
  Buffer.from('ffc0c3','hex').copy(code,tail?0x80:0x40);code.writeBigUInt64LE(tail?0x2080n:0x2040n,0xc0);
  const h=await harness(code,tail?[0,0x40,0x80]:[0,0x40],'fast',undefined,'split',suspension,accounting);
  h.ex.prepare(0,0x2000,0);h.ex.execute();const got=h.snap();
  expect(h.ex.interpretation()).toBe(0);expect(h.stats()[4]).toBe(3);expect(h.stats()[5]).toBe(1);
  expect(h.ex.retired()).toBe(accounting?(tail?27n:23n):0n);
  h.ex.prepare(1,0x2000,0);h.ex.execute();expect(got).toEqual(h.snap());
 }
},60000);

// Separate object files exercise real weak linkage, not concatenated definitions.
for(const suspension of ['asyncify',...(jspiApi()?['jspi']:[])] as ('asyncify'|'jspi')[]) {
 it('cross-chunk native calls execute directly but overrides stay outside ('+suspension+')',async()=>{
  const code=Buffer.alloc(0x50,0x90);Buffer.from('e83b000000ffc0c3','hex').copy(code);Buffer.from('b807000000c3','hex').copy(code,0x40);
  for(const layout of ['split','override'] as const){
   const h=await harness(code,[0,0x40],'size',undefined,layout,suspension);
   h.ex.prepare(0,0x2000,0);h.ex.execute();const got=h.snap();
   expect(h.ex.interpretation()).toBe(0);expect(h.stats()[1]).toBe(layout==='split'?1:0);
   expect(h.stats()[2]).toBe(layout==='split'?1:0);
   expect(new DataView(h.ex.memory.buffer).getBigUint64(h.ex.cpu(),true)).toBe(layout==='split'?8n:20n);
   if(layout==='split'){expect(h.ex.retired()).toBe(5n);h.ex.prepare(1,0x2000,0);h.ex.execute();expect(got).toEqual(h.snap());}
  }
  const missing=await harness(code,[0,0x40],'size',[0x2000],undefined,suspension);
  missing.ex.prepare(0,0x2000,0);missing.ex.execute();const state=missing.snap();expect(missing.stats()[1]).toBe(0);expect(missing.ex.interpretation()).toBeGreaterThan(0);
  missing.ex.prepare(1,0x2000,0);missing.ex.execute();expect(state).toEqual(missing.snap());
 });
 it('generated fast callers unwind before callbacks, park/rewind and nonlocal transfer ('+suspension+')',async()=>{
  const code=Buffer.alloc(0xa0,0x90);
  Buffer.from('4883ec28e8370000004883c42883c001c3','hex').copy(code);
  Buffer.from('4883ec28e8b74f00004883c42883c002c3','hex').copy(code,0x40);
  Buffer.from('b82a000000c3b863000000c3','hex').copy(code,0x80);
  for(const mode of [0,1,2]){
   const snapshots=[];
   for(const interpreted of [0,1]){
    const h=await harness(code,[0,0x40,0x80],'size',undefined,undefined,suspension);
    h.host.init();h.ex.prepare(interpreted,0x2000,0);h.ex.configure_service(mode);
    await h.host.update();
    if(mode===1){expect(h.host.suspended).toBe(true);expect(h.ex.service_complete()).toBe(0);await h.host.update();}
    expect(h.host.suspended).toBe(false);expect(h.ex.service_count()).toBe(1);expect(h.ex.service_frames()).toBe(0);expect(h.ex.service_complete()).toBe(1);
    if(!interpreted){expect(h.stats()[1]).toBeGreaterThan(0);expect(h.ex.interpretation()).toBe(0);}
    expect(h.ex.retired()).toBe(mode===2?8n:12n);
    snapshots.push(h.snap());
   }
   expect(snapshots[0]).toEqual(snapshots[1]);
  }
 },60000);
}


it('chunk cache distinguishes selection, partition boundaries and overridden native definitions',()=>{
 const root=join(ROOT,'node_modules/.cache/bgt/native-calls');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'cache-'));
 try{
  const code=Buffer.alloc(0x400,0x90);Buffer.from('e8fb010000c3','hex').copy(code);code[0x3ff]=0xc3;
  const file=join(dir,'test.exe');writeFileSync(file,pe(code,[0,0x200]));
  const a=analyzeCached(tool(),file,'probe',0x1000,dir,'fixture');
  const base={tool:tool(),file,id:'probe',base:0x1000,work:dir,analysis:a.analysis,key:a.key,budget:256};
  const all=liftChunks(base);expect(all.metrics.chunks).toBe(2);
  expect(liftChunks(base).metrics.chunks_cached).toBe(2);
  const selected=liftChunks({...base,selected:new Set([0x2000])});expect(selected.metrics.chunks).toBe(1);
  expect(readFileSync(selected.sources[1],'utf8')).toContain('__attribute__((weak)) void N_00002200');
  const restored=liftChunks(base);expect(restored.metrics.chunks).toBe(2);expect(restored.metrics.chunks_lifted).toBeGreaterThan(0);
  const skipped=liftChunks({...base,skip:[0x2200]});
  expect(skipped.sources.map((p:string)=>readFileSync(p,'utf8')).join('\n')).not.toMatch(/void N_00002200/);
  expect(liftChunks(base).metrics.chunks_lifted).toBe(2);
  const merged=liftChunks({...base,budget:2048});expect(merged.metrics.chunks).toBe(1);
  expect(liftChunks(base).metrics.chunks_lifted).toBeGreaterThan(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

// Reviewer #269: 90 is an accumulator exchange when REX.B selects r8.
it.each(['4190','4990','664190','4890','f390'])('REX.B accumulator exchange has independent width-correct expected values (%s)',async(op)=>{
 const code=Buffer.from('48b8887766554433221149b81122334455667788'+op+'c3','hex');
 const h=await harness(code,[0],'size');
 const expected:Record<string,[bigint,bigint]>={
  '4190':[0x44332211n,0x55667788n],
  '4990':[0x8877665544332211n,0x1122334455667788n],
  '664190':[0x1122334455662211n,0x8877665544337788n],
  '4890':[0x1122334455667788n,0x8877665544332211n],
  'f390':[0x1122334455667788n,0x8877665544332211n],
 };
 const snapshots=[];
 for(const interpreted of [0,1]){
  h.ex.prepare(interpreted,0x2000,0);h.ex.execute();
  const r=new BigUint64Array(h.ex.memory.buffer,h.ex.cpu(),16);
  expect([r[0],r[8]]).toEqual(expected[op]);snapshots.push(h.snap());
 }
 expect(snapshots[0]).toEqual(snapshots[1]);
});

it.each(['size','fast'])('generated indirect site reads a patched qword table and rejects high targets (%s)',async(preset)=>{
 const code=Buffer.alloc(0x100,0x90);
 Buffer.from('4c8d05b900000041ff10ffc0c3','hex').copy(code);
 Buffer.from('b807000000c3','hex').copy(code,0x40);Buffer.from('b809000000c3','hex').copy(code,0x80);
 code.writeBigUInt64LE(0x2040n,0xc0);
 const h=await harness(code,[0,0x40,0x80],preset);
 for(const target of [0x2040n,0x2080n,0x2040n,0x100002040n]){
  const snapshots=[];
  for(const interpreted of [0,1]){
   h.ex.prepare(interpreted,0x2000,0);
   new DataView(h.ex.memory.buffer).setBigUint64(h.ex.ram()+0x20c0,target,true);
   if(target>0xffffffffn)expect(()=>h.ex.execute()).toThrow();else{
    h.ex.execute();expect(new DataView(h.ex.memory.buffer).getBigUint64(h.ex.cpu(),true)).toBe(target===0x2040n?8n:10n);
   }
   snapshots.push(h.snap());
  }
  expect(snapshots[0]).toEqual(snapshots[1]);
 }
});

it.each(['size','fast'])('self-recursive targets retain the flat path without failed speculative fast frames (%s)',async(preset)=>{
 const code=Buffer.alloc(0x50,0x90);Buffer.from('b903000000e836000000c3','hex').copy(code);Buffer.from('85c97407ffc9e8f5ffffffffc0c3','hex').copy(code,0x40);
 const h=await harness(code,[0,0x40],preset);
 expect(h.text).not.toContain('x86_native_enter(X.eip,N_00002040)');
 h.ex.prepare(0,0x2000,0);h.ex.execute();const got=h.snap();expect(h.stats()[1]).toBe(0);expect(h.ex.interpretation()).toBe(0);expect(h.ex.retired()).toBe(25n);
 h.ex.prepare(1,0x2000,0);h.ex.execute();expect(got).toEqual(h.snap());
});
