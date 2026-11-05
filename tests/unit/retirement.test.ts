// @bgt-examples: none
// Original CC0-1.0. Exact answers count decoded guest instructions, not TSC
// attempts, dispatch calls, REP iterations or synthetic import/callback returns.
import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {compileC} from '../support/compile';
import {ROOT} from '../support/headless';
import {instantiateFixture} from '../support/wasm-fixture';
import {GameHost} from '../../bgt/runtime/host';
import {Vfs} from '../../bgt/runtime/vfs';
import {jspiApi} from '../../bgt/runtime/jspi';
// @ts-expect-error plain ESM tool
import {x86tool} from '../../tools/build/pipeline.mjs';
// @ts-expect-error plain ESM tool
import {transform} from '../../tools/build/asyncify.mjs';
// @ts-expect-error plain ESM flags
import {WASM_OPT_FEATURES} from '../../tools/build/build.mjs';
const BASE=0x1001000;
function pe(code:Buffer,wide:number) {
 const b=Buffer.alloc(0x400+Math.ceil(code.length/512)*512),opt=0x98,sh=opt+(wide?240:224);
 b.write('MZ');b.writeUInt32LE(0x80,0x3c);b.write('PE\0\0',0x80);
 b.writeUInt16LE(wide?0x8664:0x14c,0x84);b.writeUInt16LE(1,0x86);b.writeUInt16LE(wide?240:224,0x94);
 b.writeUInt16LE(wide?0x20b:0x10b,opt);b.writeUInt32LE(0x1000,opt+16);
 if(wide)b.writeBigUInt64LE(0x1000000n,opt+24);else b.writeUInt32LE(0x1000000,opt+28);
 b.writeUInt32LE(0x2000000,opt+56);b.writeUInt32LE(0x400,opt+60);
 b.write('.text',sh);b.writeUInt32LE(code.length,sh+8);b.writeUInt32LE(0x1000,sh+12);
 b.writeUInt32LE(code.length,sh+16);b.writeUInt32LE(0x400,sh+20);b.writeUInt32LE(0x60000020,sh+36);
 code.copy(b,0x400);return b;
}
type Ex={prepare(interpreted:number,entry:number):void;run(entry:number):void;resume():void;
 retired(kind:number):bigint;thread_retired(i:number):bigint;clock():bigint;set_budget(n:number):void;
 stop(yes:number,park:number):void;clear_transfer():void;reset_census():void;set_reg(i:number,n:number):void;
 pc():number;transfer():number;remaining():number;select_task(i:number,pc:number):void;active_time():number;parked_time():number};
async function fixture(hex:string,width:number,preset:string,account=1,profile=1) {
 const root=join(ROOT,'node_modules/.cache/bgt/retirement-tests');mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'case-')),code=Buffer.from(hex,'hex');
 try {
  writeFileSync(join(dir,'input.exe'),pe(code,width));
  execFileSync(x86tool(),['lift',join(dir,'input.exe'),'--name','probe','--out',join(dir,'lifted.c'),'--lift-preset',preset]);
  const generated=readFileSync(join(dir,'lifted.c'),'utf8').replace(/#include "x86_lift(64)?.h"/g,(_,w)=>'#include "'+ROOT+'/platforms/x86/x86_lift'+(w??'')+'.h"');
  writeFileSync(join(dir,'probe.c'),'static const unsigned char test_code[]={'+[...code].join(',')+'};\n#include "'+ROOT+'/tests/fixtures/c/retirement_runtime.h"\n'+generated);
  return await compileC(relative(ROOT,join(dir,'probe.c')),['MODE64='+width,'X86_ACCOUNTING_ENABLED='+account,'X86_PROFILE_ENABLED='+profile],true);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
for(const width of [0,1])for(const preset of ['size','fast'])it('exact mixed retirement / quantum / REP / context restoration '+width+' '+preset,async()=>{
 // 18: MOV,XOR; three ADD/DEC/JNZ; CPUID; MOV; zero-count REP;
 // CALL; main RET; callee NOP,RET. i386 BSWAP / AMD64 CPUID are generic.
 const code='b90300000031c083c007ffc975f9'+(width?'0fa2':'0fc8')+'b900000000f3aae801000000c390c3';
 for(const profile of [0,1])for(const interpreted of [0,1]) {
  const {exports}=await instantiateFixture(await fixture(code,width,preset,1,profile));const ex=exports as unknown as Ex;
  ex.prepare(interpreted,BASE);ex.set_reg(7,0x2000);ex.set_budget(2000000);ex.stop(1,0);
  ex.run(BASE);expect(ex.transfer()).not.toBe(0);expect(ex.retired(3)).toBe(0n);
  if(width)expect(ex.clock()).toBe(1n); // attempted, NOT retired
  ex.clear_transfer();ex.resume();expect(ex.retired(3)).toBe(18n);expect(ex.thread_retired(0)).toBe(18n);
  if(interpreted)expect(ex.retired(2)).toBe(18n);
  else {expect(ex.retired(0)).toBeGreaterThan(0n);expect(ex.retired(1)).toBeGreaterThan(0n);expect(ex.retired(2)).toBe(0n);}
  ex.reset_census();expect(ex.retired(3)).toBe(18n);
  const clock=ex.clock();ex.select_task(1,BASE);ex.set_reg(7,0x2000);ex.run(BASE);
  expect(ex.retired(3)).toBe(36n);expect(ex.thread_retired(1)).toBe(18n);expect(ex.thread_retired(0)).toBe(18n);
  ex.select_task(0,BASE);expect(ex.clock()).toBe(clock);ex.run(BASE);
  expect(ex.retired(3)).toBe(54n);expect(ex.thread_retired(0)).toBe(36n);
 }
 for(const budget of [1999999,1999998])for(const interpreted of [0,1]) {
  const {exports}=await instantiateFixture(await fixture('f3aac3',width,preset));const ex=exports as unknown as Ex;
  ex.prepare(interpreted,BASE);ex.set_reg(1,2);ex.set_reg(7,0x2000);ex.set_budget(budget);ex.stop(1,0);ex.run(BASE);
  expect(ex.transfer()).not.toBe(0);expect(ex.remaining()).toBe(budget===1999999?2:1);expect(ex.retired(3)).toBe(0n);
  ex.clear_transfer();ex.resume();expect(ex.remaining()).toBe(0);expect(ex.retired(3)).toBe(2n);
 }
 for(const interpreted of [0,1]) {
  const {exports}=await instantiateFixture(await fixture('b8010000008b03c3',width,preset));const ex=exports as unknown as Ex;
  ex.prepare(interpreted,BASE);ex.set_reg(3,0x2000000);expect(()=>ex.run(BASE)).toThrow();expect(ex.retired(3)).toBe(1n);
 }
 const {exports}=await instantiateFixture(await fixture(code,width,preset,0));const ex=exports as unknown as Ex;
 ex.prepare(0,BASE);ex.run(BASE);expect(ex.retired(3)).toBe(0n);
},600000);
for(const preset of ['size','fast'])it('full-width control-target faults exclude the failing native or interpreted instruction '+preset,async()=>{
 for(const [code,expected] of [
  ['48b80000000001000000ffd0',1n], // MOV RAX,2^32; CALL RAX (invalid target)
  ['48b80000000001000000ffe0',1n], // MOV; JMP RAX (invalid target)
  ['48b8000000000100000050c3',2n], // MOV; PUSH RAX; RET (invalid target)
 ] as const) {
  const raw=await fixture(code,1,preset);
  for(const interpreted of [0,1]) {
   const {exports}=await instantiateFixture(raw),ex=exports as unknown as Ex;
   ex.prepare(interpreted,BASE);expect(()=>ex.run(BASE)).toThrow();expect(ex.retired(3)).toBe(expected);
  }
 }
},600000);
it('retirement commits once across actual Asyncify rewind and JSPI parked continuation',async()=>{
 if(process.env.BGT_TEST_JSPI==='1')expect(jspiApi()).not.toBeNull();
 const raw=await fixture('b80100000083c002c3',1,'fast');
 const root=join(ROOT,'node_modules/.cache/bgt/retirement-tests');const dir=mkdtempSync(join(root,'park-'));
 try {
  writeFileSync(join(dir,'raw.wasm'),raw);transform(join(dir,'raw.wasm'),join(dir,'async.wasm'),[...WASM_OPT_FEATURES,'-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield']);
  for(const mode of ['asyncify',...(jspiApi()?['jspi']:[])] as ('asyncify'|'jspi')[])for(const interpreted of [0,1]) {
   let now=0;
   const host=await GameHost.create(mode==='jspi'?raw:readFileSync(join(dir,'async.wasm')),{vfs:new Vfs(),now:()=>now,log:()=>{}},{backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0,suspensionMode:mode});
   const ex=(host as unknown as {exports:Ex}).exports;ex.prepare(interpreted,BASE);ex.set_budget(2000000);ex.stop(0,1);
   host.init();await host.update();expect(host.suspended).toBe(true);expect(ex.retired(3)).toBe(0n);
   now=1000;expect(ex.active_time()).toBe(0);expect(ex.parked_time()).toBe(1000000);
   await host.update();expect(host.suspended).toBe(false);
   expect(ex.retired(3)).toBe(3n);expect(ex.active_time()).toBe(0);expect(ex.parked_time()).toBe(1000000);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},600000);
