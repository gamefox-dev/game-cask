/* Original CC0-1.0. Source-built Win64 dispatch controls; never host-executed. */
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {callsFixture} from './calls-fixture.mjs';
export function dispatchFixture(dir,pattern,count=100000) {
 const fixture=callsFixture(dir,pattern==='mixed'?'indirect':pattern,count);
 const cfg=JSON.parse(readFileSync(join(dir,'game.json'),'utf8'));
 cfg.id='k49-'+pattern;cfg.name='CC0 K49 '+pattern;cfg.pipeline.suspensionBuild='dual';
 cfg.cflags=[];cfg.sources=[];
 if(pattern==='mixed') {
  // Win64 nonvolatile storage, 32-byte home area. CPUID is intentionally generic.
  // Four real target values are read every iteration, never folded by the driver.
  writeFileSync(join(dir,'loop.S'),
   '.text\n.globl benchmark_loop\n.seh_proc benchmark_loop\nbenchmark_loop:\n.seh_endprologue\n'+
   'pushq %rbx\npushq %rsi\nsubq $40,%rsp\nmovl $'+count+',%esi\nloop49:\n'+
   'movl %esi,%edx\nandl $3,%edx\nleaq table49(%rip),%r8\ncall *(%r8,%rdx,8)\n'+
   'movl $37,%ecx\ncall *__imp_SetLastError(%rip)\ncall *__imp_GetLastError(%rip)\n'+
   'cmpl $37,%eax\njne bad49\ncall *__imp_GetTickCount64(%rip)\n'+
   'xorl %eax,%eax\ncpuid\ndecl %esi\njnz loop49\nxorl %eax,%eax\njmp done49\n'+
   'bad49: movl $1,%eax\ndone49: addq $40,%rsp\npopq %rsi\npopq %rbx\nret\n.seh_endproc\n'+
   [0,1,2,3].map(i=>'.globl t49_'+i+'\n.seh_proc t49_'+i+'\nt49_'+i+':\n.seh_endprologue\nincl %eax\nret\n.seh_endproc\n').join('')+
   '.data\n.p2align 3\ntable49: .quad t49_0,t49_1,t49_2,t49_3\n');
  fixture.expected=0;
  const source=readFileSync(join(dir,'bench.c'),'utf8').replace('result!='+fixture.calls+'u','result!=0u');
  writeFileSync(join(dir,'bench.c'),source);
 }
 writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));
 return {...fixture,id:cfg.id,pattern};
}
