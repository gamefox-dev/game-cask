// Original CC0-1.0. Import-only CRT declarations, no compiler CRT startup/implementations.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function importSource(dir) {
  mkdirSync(dir,{recursive:true});
  const names=['strcmp','malloc','free','qsort'];
  // Standard COFF import subsections, coalesced with the ordinary kernel32 import library.
  const asm=[
    '.section .idata$2', ' .rva crt_ilt', ' .long 0,0', ' .rva crt_dll', ' .rva crt_iat',
    '.section .idata$4', '.p2align 3', 'crt_ilt:',
    ...names.flatMap(n=>[' .rva crt_name_'+n,' .long 0']), ' .quad 0',
    '.section .idata$5', '.p2align 3', 'crt_iat:',
    ...names.flatMap(n=>['.globl __imp_'+n,'__imp_'+n+':',' .rva crt_name_'+n,' .long 0']), ' .quad 0',
    '.section .idata$6', 'crt_dll:', ' .asciz "msvcrt.dll"',
    ...names.flatMap(n=>['.p2align 1','crt_name_'+n+':',' .short 0',' .asciz "'+n+'"']),
    '.text',
    ...names.flatMap(n=>['.globl '+n,'.seh_proc '+n,n+':','.seh_endprologue',' jmp *__imp_'+n+'(%rip)','.seh_endproc']),
  ].join('\n')+'\n';
  writeFileSync(join(dir,'crt-imports.S'),asm);
  return 'crt-imports.S';
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const dir=resolve(process.argv[2]),here=dirname(fileURLToPath(import.meta.url));
  const imports=importSource(dir);
  for(const file of ['imports.c','forms.S'])copyFileSync(join(here,file),join(dir,file));
  console.log(JSON.stringify(['imports.c','forms.S',imports]));
}
