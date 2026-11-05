// Original CC0-1.0 workload. Never executes a PE on the host.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
export function callsFixture(dir, pattern, count = 5000) {
  mkdirSync(dir, {recursive:true});
  const id = 'k32-' + pattern;
  const proc = (name, body) => '.globl '+name+'\n.seh_proc '+name+'\n'+name+':\n.seh_endprologue\n'+body+'\n.seh_endproc\n';
  let asm = '.text\n', expected = 0, calls = 0;
  let body = 'pushq %rbx\nsubq $32,%rsp\nmovl $'+count+',%ebx\nxorl %eax,%eax\nagain:\n';
  if (pattern === 'direct') {
    body += 'call f0\n'; calls = count*16; expected = calls;
    for (let i=0;i<16;i++) asm += proc('f'+i, i===15 ? 'incl %eax\nret' : 'subq $40,%rsp\ncall f'+(i+1)+'\naddq $40,%rsp\nincl %eax\nret');
  } else if (pattern === 'deep') {
    body += 'movl $95,%ecx\ncall recur\n'; calls = count*96; expected = calls;
    asm += proc('recur','testl %ecx,%ecx\njz bottom\nsubq $40,%rsp\ndecl %ecx\ncall recur\naddq $40,%rsp\nbottom:\nincl %eax\nret');
  } else if (pattern === 'indirect' || pattern === 'tail') {
    body += 'movl %ebx,%edx\nandl $3,%edx\nleaq table(%rip),%r8\n' + (pattern==='tail' ? 'call veneer' : 'call *(%r8,%rdx,8)') + '\n';
    calls=count; expected=count;
    for(let i=0;i<4;i++)asm += proc('target'+i,'incl %eax\nret');
    if(pattern==='tail')asm+=proc('veneer','jmp *(%r8,%rdx,8)');
    asm += '.data\n.p2align 3\ntable: .quad target0,target1,target2,target3\n.text\n';
  } else if (pattern === 'regions') {
    // Three region crossings/iteration, forward condition and backward edge.
    body += 'testl $1,%ebx\njz path\n'+ 'incl %eax\n'.repeat(280)+'path:\n'+'incl %eax\n'.repeat(300);
    calls=count; expected=count*300+Math.ceil(count/2)*280;
  } else throw new Error('unknown pattern '+pattern);
  body += 'decl %ebx\njnz again\naddq $32,%rsp\npopq %rbx\nret';
  asm += proc('benchmark_loop',body);
  writeFileSync(join(dir,'loop.S'),asm);
  writeFileSync(join(dir,'bench.c'),'/* Original CC0-1.0. */\n#include <windows.h>\nint _tls_index;\nextern unsigned benchmark_loop(void);\nstatic void *volatile relocation_anchor=(void *)&relocation_anchor;\nvoid entry(void){(void)relocation_anchor;OutputDebugStringA("CALLS begin");unsigned result=benchmark_loop();OutputDebugStringA("CALLS end");unsigned fail=result!='+expected+'u;OutputDebugStringA(fail?"CALLS FAIL":"CALLS PASS");ExitProcess(fail); }\n');
  writeFileSync(join(dir,'stats.c'),'#include "x86_lift64.h"\n#include "bgt.h"\n#if defined(X86_NATIVE_FAST_VERSION) && X86_NATIVE_STATS\nBGT_EXPORT(k32_stats) unsigned stats(void){return (unsigned)(uintptr_t)&x86_native_stats;}\n#endif\n');
  writeFileSync(join(dir,'game.json'),JSON.stringify({id,name:'CC0 K32 '+pattern,sources:['stats.c'],cflags:process.env.BGT_CALLS_STATS==='1'?['-DX86_NATIVE_STATS=1']:[],includes:['../../../../platforms/x86'],pipeline:{platform:'win32',fixture:{target:'x86_64-windows-gnu',sources:['bench.c','loop.S'],out:'bench.exe',libs:['kernel32']},modules:[{from:'./build/bench.exe',main:true}]}}));
  return {id,pattern,count,calls,expected};
}
