/* Original CC0-1.0: RIP-relative signed-offset jump table, including every code landing pad. */
.text
.globl x64_table
.seh_proc x64_table
x64_table:
.seh_endprologue
  cmpl $6,%ecx
  ja .Ldefault
  leaq .Ltable(%rip),%rdx
  movslq (%rdx,%rcx,4),%rax
  addq %rdx,%rax
  jmp *%rax
.Lcase0: movl $91,%eax; retq
.Lcase1: movl $17,%eax; retq
.Lcase2: movl $73,%eax; retq
.Lcase3: movl $39,%eax; retq
.Lcase4: movl $105,%eax; retq
.Lcase5: movl $62,%eax; retq
.Lcase6: movl $28,%eax; retq
.Ldefault: movl $-1,%eax; retq
.seh_endproc
.section .rdata,"dr"
.p2align 2
.Ltable:
.long .Lcase0-.Ltable,.Lcase1-.Ltable,.Lcase2-.Ltable,.Lcase3-.Ltable,.Lcase4-.Ltable,.Lcase5-.Ltable,.Lcase6-.Ltable
