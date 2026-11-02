// @bgt-examples: none
import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {compileC} from '../support/compile';
import {ROOT} from '../support/headless';
// @ts-expect-error ESM analyzer
import {x86tool} from '../../tools/build/pipeline.mjs';
function pe32(code:Buffer){
 const b=Buffer.alloc(0x400);b.write('MZ');b.writeUInt32LE(0x80,0x3c);b.write('PE\0\0',0x80);
 b.writeUInt16LE(0x14c,0x84);b.writeUInt16LE(1,0x86);b.writeUInt16LE(224,0x94);b.writeUInt16LE(0x10b,0x98);
 b.writeUInt32LE(0x1000,0x98+16);b.writeUInt32LE(0x1000000,0x98+28);b.writeUInt32LE(0x2000,0x98+56);b.writeUInt32LE(0x200,0x98+60);
 const s=0x178;b.write('.text',s);b.writeUInt32LE(code.length,s+8);b.writeUInt32LE(0x1000,s+12);b.writeUInt32LE(code.length,s+16);b.writeUInt32LE(0x200,s+20);b.writeUInt32LE(0x60000020,s+36);code.copy(b,0x200);return b;
}
it('strict i386 membership precedes resolved jump-table targets and direct calls/tail calls to overrides',async()=>{
 for(const edge of ['table','call','tail']) {
  const root=join(ROOT,'node_modules/.cache/bgt/i386-strict');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-'));
  try {
   const code=Buffer.alloc(0x48,0x90);
   if(edge==='table')Buffer.from('31c983f900ff248d40100001','hex').copy(code);
   else {code[0]=0xe8;code.writeInt32LE(0x20-5,1);code[5]=0xc3;if(edge==='tail'){code[5]=0xe9;code.writeInt32LE(0x20-10,6);}}
   Buffer.from('c70425002000007b000000c3','hex').copy(code,0x20);code.writeUInt32LE(0x1001020,0x40);code.writeUInt32LE(0,0x44);
   writeFileSync(join(dir,'input.exe'),pe32(code));const args=['lift',join(dir,'input.exe'),'--name','test','--out',join(dir,'lifted.c')];
   if(edge!=='table')args.push('--skip','1001020');execFileSync(x86tool(),args);
   const generated=readFileSync(join(dir,'lifted.c'),'utf8');
   if(edge==='table')expect(generated).toContain('case 0x01001020u: x86_coverage_lifted(0x01001020u,1);');
   writeFileSync(join(dir,'probe.c'),`#define TEST_WIDE 0\n#define X86_COVERAGE_MODE 2\nstatic const unsigned char test_code[]={${[...code].join(',')}};\n#include "${ROOT}/tests/fixtures/c/strings_harness.h"\nstatic unsigned policy_mem[32];void *x86_alloc(unsigned n){return n<=sizeof policy_mem?policy_mem:0;}\n${generated}\n${edge==='table'?'':'void F_01001020(void){x86_wr32(0x2000,123);X.eip=(uint32_t)x86_pop();}'}\nBGT_EXPORT(run) void run(void){reset(${edge==='tail'?'0x1001005':'0x1001000'});static const unsigned e[]={${edge==='tail'?'0x1001005':'0x1001000'}};static const x86_code_range_t r[]={{0x1001000,0x1001040,0}};x86_set_slice(e,1,r,1);unsigned p=x86_prepare_host_slice(1,0);*(unsigned *)(uintptr_t)((bgt_slice_policy_t *)(uintptr_t)p)->entries_ptr=${edge==='tail'?'0x1001005':'0x1001000'};${edge==='table'?'x86_wr32(0x1001040,0x1001020);':''}F_01001000();}\n`);
   // Jump-table source address is outside the tiny harness RAM; map a host page for its actual guest address.
   if(edge==='table'){
    let s=readFileSync(join(dir,'probe.c'),'utf8');s=s.replace('x86_wr32(0x1001040,0x1001020);','x86_pages[0x1001]=ram;x86_wr32(0x1001040,0x1001020);');writeFileSync(join(dir,'probe.c'),s);
   }
   const {instance}=await WebAssembly.instantiate(await compileC(relative(ROOT,join(dir,'probe.c')),[],false,['platforms/x86']),{bgt:{slice_missing:()=>{throw new Error('strict i386 stop');}}});
   const ex=instance.exports as unknown as {run:()=>void;ram:()=>number;memory:WebAssembly.Memory};
   expect(()=>ex.run(),edge).toThrow('strict i386 stop');expect(new DataView(ex.memory.buffer).getUint32(ex.ram()+0x2000,true),edge).toBe(0);
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
