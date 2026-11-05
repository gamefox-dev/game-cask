// @bgt-examples: none
// Original CC0-1.0. Emitted code + production dispatcher, not boundary substitutes.
import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../support/headless';
import { compileC } from '../support/compile';
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
async function harness(code:Buffer,cuts:number[],preset:string,select?:number[]) {
 const root=join(ROOT,'node_modules/.cache/bgt/native-calls');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-'));
 try{
  writeFileSync(join(dir,'test.exe'),pe(code,cuts));
  if(select)writeFileSync(join(dir,'selected.txt'),select.map(n=>n.toString(16)).join('\n'));
  execFileSync(tool(),['lift',join(dir,'test.exe'),'--base','1000','--name','probe','--out',join(dir,'lifted.c'),'--lift-preset',preset,...(select?['--select',join(dir,'selected.txt')]:[])]);
  const text=readFileSync(join(dir,'lifted.c'),'utf8');
  writeFileSync(join(dir,'test.c'),'#define X86_FLAT_GUEST 1\n#define X86_FLAT_BYTES 65536ull\n#define X86_PROFILE_ENABLED 0\n#define X86_COVERAGE_MODE 0\nstatic const unsigned char test_code[]={'+[...code].join(',')+'};\n'+text.replace('#include "x86_lift64.h"','#include "'+ROOT+'/platforms/x86/x86_lift64.h"')+'\n#include "'+ROOT+'/tests/fixtures/c/native_calls_harness.h"\n');
  const {exports}=await instantiateFixture(await compileC(relative(ROOT,join(dir,'test.c'))));
  const ex=exports as unknown as {memory:WebAssembly.Memory;prepare(i:number,pc:number,b:number):void;execute():void;resume():void;cpu():number;cpu_size():number;ram():number;stats():number;interpretation():number;generic():number;set_reg(i:number,v:bigint):void};
  const snap=()=>({cpu:new Uint8Array(ex.memory.buffer).slice(ex.cpu(),ex.cpu()+ex.cpu_size()),ram:new Uint8Array(ex.memory.buffer).slice(ex.ram()+0x1000,ex.ram()+0xa000)});
  return {ex,text,snap,stats:()=>Array.from(new BigUint64Array(ex.memory.buffer,ex.stats(),6),Number),peak:()=>new DataView(ex.memory.buffer).getUint32(ex.stats()+48,true)};
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
  for(const [prefix,expected] of [['4c8d0579000000',0],['4c8d05790000004531c0',1],['4c8d057900000065',1]] as const){
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
 h.ex.prepare(0,0x2000,0);h.ex.execute();const got=h.snap();expect(h.ex.interpretation()).toBe(0);expect(h.ex.generic()).toBe(1);
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
 const h=await harness(code,[0],preset);h.ex.prepare(0,0x2000,0);h.ex.execute();const got=h.snap();expect(h.ex.interpretation()).toBe(0);expect(h.stats()[3]).toBeGreaterThan(0);
 h.ex.prepare(1,0x2000,0);h.ex.execute();expect(got).toEqual(h.snap());
});
