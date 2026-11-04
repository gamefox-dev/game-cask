// @bgt-examples: none
// Original CC0 PE and full architecture oracle through production dispatch (both emission policies).
import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compileC } from '../support/compile';
import { ROOT } from '../support/headless';
import { instantiateFixture } from '../support/wasm-fixture';
// @ts-expect-error plain ESM
import { x86tool } from '../../tools/build/pipeline.mjs';
function fixture() {
  const code: number[] = [], labels = new Map<string, number>(), fixups: {at:number;target:string|number}[]=[];
  const emit=(hex:string)=>code.push(...Buffer.from(hex,'hex'));
  const relative=(hex:string,target:string|number)=>{emit(hex);fixups.push({at:code.length,target});emit('00000000');};
  const prep=()=>emit('b90b000000ba1600000041b82100000041b92c00000048c744242037000000');
  let output=0x14000;
  const save=()=>{relative('488905',output);output+=8;};
  emit('4883ec28');
  prep();relative('ff15',0x12080);save();
  prep();relative('e8','tail');save();
  prep();relative('488b05',0x12080);emit('4989c341ffd3');save();
  relative('488b1d',0x12080); // preserved across a different call and a loop join
  prep();relative('ff15',0x12080);save();prep();emit('ffd3');save();
  emit('41bc02000000');labels.set('loop',0x11000+code.length);
  prep();emit('ffd3');save();emit('41ffcc');relative('0f85','loop');
  // Patch the slot AFTER loading RBX. The old register target remains semantically live.
  relative('488d05','replacement');relative('488905',0x12080);
  prep();emit('ffd3');save();prep();relative('ff15',0x12080);save();
  emit('b800500000');relative('488905',0x12080);
  prep();relative('ff15',0x12080);save();emit('4883c428c3');
  labels.set('tail',0x11000+code.length);relative('ff25',0x12080);
  labels.set('replacement',0x11000+code.length);emit('b8e7030000c3');
  const bytes=Buffer.from(code);
  for(const f of fixups)bytes.writeInt32LE((typeof f.target==='string'?labels.get(f.target)!:f.target)-(0x11000+f.at+4),f.at);
  const pe=Buffer.alloc(0x1000);
  pe.write('MZ');pe.writeUInt32LE(0x80,0x3c);pe.write('PE\0\0',0x80);pe.writeUInt16LE(0x8664,0x84);pe.writeUInt16LE(3,0x86);pe.writeUInt16LE(240,0x94);
  const opt=0x98;pe.writeUInt16LE(0x20b,opt);pe.writeUInt32LE(0x1000,opt+16);pe.writeBigUInt64LE(0x10000n,opt+24);pe.writeUInt32LE(0x10000,opt+56);pe.writeUInt32LE(0x400,opt+60);
  pe.writeUInt32LE(0x2000,opt+112+8);pe.writeUInt32LE(40,opt+116+8);pe.writeUInt32LE(0x3000,opt+112+24);pe.writeUInt32LE(12,opt+116+24);
  for(const [i,name,va,raw,flags] of [[0,'.text',0x1000,0x400,0x60000020],[1,'.idata',0x2000,0x800,0xc0000040],[2,'.pdata',0x3000,0xc00,0x40000040]] as const){
    const s=0x188+40*i;pe.write(name,s);pe.writeUInt32LE(0x400,s+8);pe.writeUInt32LE(va,s+12);pe.writeUInt32LE(0x400,s+16);pe.writeUInt32LE(raw,s+20);pe.writeUInt32LE(flags,s+36);
  }
  bytes.copy(pe,0x400);pe.writeUInt32LE(0x2040,0x800);pe.writeUInt32LE(0x20c0,0x80c);pe.writeUInt32LE(0x2080,0x810);
  pe.writeBigUInt64LE(0x20e0n,0x840);pe.writeBigUInt64LE(0x20e0n,0x880);pe.write('kernel32.dll\0',0x8c0);pe.write('TestImport\0',0x8e2);
  pe.writeUInt32LE(0x1000,0xc00);pe.writeUInt32LE(0x1000+bytes.length,0xc04);
  return {pe,bytes};
}
it.each(['size','fast'])('guarded import call sites preserve every CPU/RAM byte (%s)', async preset=>{
  const root=join(ROOT,'node_modules/.cache/bgt/import-codegen');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-'));
  try {
    const {pe,bytes}=fixture();writeFileSync(join(dir,'input.exe'),pe);
    execFileSync(x86tool(),['lift',join(dir,'input.exe'),'--base','0x10000','--name','probe','--out',join(dir,'lifted.c'),'--lift-preset',preset]);
    const lifted=readFileSync(join(dir,'lifted.c'),'utf8');
    expect(lifted.match(/x86_try_import/g)?.length).toBeGreaterThanOrEqual(8);
    const stats=JSON.parse(readFileSync(join(dir,'lifted.c.stats.json'),'utf8'));
    writeFileSync(join(dir,'probe.c'), '#include "'+ROOT+'/tests/fixtures/c/import_codegen.h"\n'+lifted+'\nBGT_EXPORT(run) void run(unsigned interpreted,unsigned cold){\n' +
'__builtin_memset(&X,0,sizeof X);__builtin_memset(&x86_metrics,0,sizeof x86_metrics);X.mode64=1;X.mxcsr=0x1f80;X.r[ESP]=0x1e000;X.flags=0x202;\n'+
'x86_map(0x10000,0x10000);__builtin_memset(x86_flat+0x10000,0,0x10000);\n'+
'static const unsigned char code[]={'+[...bytes].join(',')+'};__builtin_memcpy(x86_flat+0x11000,code,sizeof code);\n'+
'x86_wr64(0x12080,0x5000);x86_set_thunks(0x5000,0x5010,test_thunk);x86_bind_import(0x12080,0x5000,0,test_bound,cold?0:test_leaf);\n'+
'x86_register_lifted(x86_lifted_probe,'+stats.entries+');x86_force_interp=interpreted;x86_push(0xfffffff4u);x86_invoke(0x11000,0xfffffff4u); }\n');
    const { exports: ex }=await instantiateFixture(await compileC(relative(ROOT,join(dir,'probe.c')),[],false,['platforms/x86']));
    const run=ex.run as (interpreted:number,cold:number)=>void, mem=()=>new Uint8Array((ex.memory as WebAssembly.Memory).buffer);
    const snapshot=()=>({cpu:mem().slice((ex.cpu as ()=>number)(),(ex.cpu as ()=>number)()+(ex.cpu_size as ()=>number)()),ram:mem().slice((ex.ram as ()=>number)(),(ex.ram as ()=>number)()+65536)});
    run(1,0);const reference=snapshot();
    for(const cold of [0,1]) {
      run(0,cold);expect(snapshot()).toEqual(reference);
      expect((ex.direct as ()=>bigint)()).toBe(9n);
      expect((ex.leaf as ()=>bigint)()).toBe(cold?0n:9n);
      expect((ex.thunks as ()=>bigint)()).toBe(0n);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
},180000);
