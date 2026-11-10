// Original CC0-1.0. Mixed small direct/virtual calls; PE runs only in the kit.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function k40Fixture(dir){
 mkdirSync(dir,{recursive:true});
 const proc=(name,body)=>'.globl '+name+'\n.seh_proc '+name+'\n'+name+':\n.seh_endprologue\n'+body+'\n.seh_endproc\n';
 let asm='.text\n';
 for(let i=0;i<32;i++)asm+=proc('leaf'+i,'addl $1,%eax\nxorl $85,%eax\n'.repeat(5)+'ret');
 let body='pushq %rbx\nsubq $32,%rsp\nmovl $256,%ebx\nxorl %eax,%eax\nagain:\n';
 for(let i=0;i<4;i++)body+='call leaf'+i+'\nmovl %ebx,%edx\nandl $31,%edx\nleaq vtable(%rip),%r8\ncall *(%r8,%rdx,8)\n';
 body+='decl %ebx\njnz again\naddq $32,%rsp\npopq %rbx\nret';asm+=proc('kernel',body);
 asm+='.data\n.p2align 3\nvtable: .quad '+Array.from({length:32},(_,i)=>'leaf'+i).join(',')+'\n';
 writeFileSync(join(dir,'kernel.S'),asm);
 let expected=0;for(let i=0;i<256*8*5;i++)expected=((expected+1)^85)>>>0;
 writeFileSync(join(dir,'main.c'),'/* Original CC0-1.0. */\n#include <windows.h>\nextern unsigned kernel(void);\nint _tls_index;\nstatic void *volatile anchor=&anchor;\nvoid entry(void){(void)anchor;for(unsigned i=0;;i++){if(kernel()!='+expected+'u){OutputDebugStringA("k40 FAIL");ExitProcess(1);}if(!i)OutputDebugStringA("k40 OK");Sleep(5);}}\n');
 writeFileSync(join(dir,'game.json'),JSON.stringify({id:'k40-calls',name:'CC0 K40 mixed calls',pipeline:{platform:'win32',suspensionBuild:'dual',fixture:{target:'x86_64-windows-gnu',sources:['main.c','kernel.S'],out:'calls.exe',libs:['kernel32']},modules:[{from:'./build/calls.exe',main:true}]}}));
 return {dir,id:'k40-calls',expected:'guest: k40 OK'};
}
