/* Original CC0-1.0: exact Win64 import call forms, including an ABI tail veneer. */
.text
.globl iat_compare
.seh_proc iat_compare
iat_compare:
 subq $40,%rsp
 .seh_stackalloc 40
 .seh_endprologue
 call *__imp_strcmp(%rip)
 addq $40,%rsp
 ret
.seh_endproc
.globl tail_compare
.seh_proc tail_compare
tail_compare:
 .seh_endprologue
 jmp *__imp_strcmp(%rip)
.seh_endproc
.globl reg_compare
.seh_proc reg_compare
reg_compare:
 subq $40,%rsp
 .seh_stackalloc 40
 .seh_endprologue
 movq __imp_strcmp(%rip),%rax
 movq %rax,%r11
 call *%r11
 addq $40,%rsp
 ret
.seh_endproc
.globl saved_compare
.seh_proc saved_compare
saved_compare:
 pushq %rbx
 .seh_pushreg %rbx
 pushq %rsi
 .seh_pushreg %rsi
 pushq %rdi
 .seh_pushreg %rdi
 subq $32,%rsp
 .seh_stackalloc 32
 .seh_endprologue
 movq %rcx,%rsi
 movq %rdx,%rdi
 movq __imp_strcmp(%rip),%rbx
 call *__imp_GetCurrentThreadId(%rip)
 movq %rsi,%rcx
 movq %rdi,%rdx
 call *%rbx
 addq $32,%rsp
 popq %rdi
 popq %rsi
 popq %rbx
 ret
.seh_endproc
/* The original IAT operand is read on every call, including after patching. */
.globl patch_compare
.seh_proc patch_compare
patch_compare:
 .seh_endprologue
 jmp *__imp_strcmp(%rip)
.seh_endproc
