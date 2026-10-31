/* Original CC0-1.0. More straight-line instructions than the old address cap,
 * plus an indirect call and an interior continuation in a .pdata-owned range. */
.text
.globl entry
.seh_proc entry
entry:
  subq $40,%rsp
  .seh_stackalloc 40
  .seh_endprologue
  movl $17,%ecx
  call *__imp_Sleep(%rip)
  call *body_ptr(%rip)
  cmpl $123,%eax
  jne .Lbad
  leaq good(%rip),%rcx
  jmp .Llog
.Lbad:
  leaq bad(%rip),%rcx
.Llog:
  call *__imp_OutputDebugStringA(%rip)
.Lwait:
  movl $17,%ecx
  call *__imp_Sleep(%rip)
  jmp .Lwait
.seh_endproc

.seh_proc body
body:
  .seh_endprologue
  .rept 70000
  nop
  .endr
  /* Only the target block is executed; ownership must retain the entire range. */
  jmp *interior_ptr(%rip)
  movl $-1,%eax
  retq
.Linterior:
  movl $123,%eax
  retq
.seh_endproc

.data
.globl _tls_index
_tls_index: .long 0

.section .rdata,"dr"
.p2align 3
body_ptr: .quad body
interior_ptr: .quad .Linterior
good: .asciz "coverage known result 123"
bad: .asciz "coverage BAD"
