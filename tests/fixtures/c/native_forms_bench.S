/* Original CC0-1.0 SSE move/shuffle + LOCK throughput fixture. No game bytes.
 * Win64 entry has one loop, 100,000 executions of every census form. */
.text
.globl entry
.def entry; .scl 2; .type 32; .endef
.seh_proc entry
entry:
  subq $40, %rsp
  .seh_stackalloc 40
  .seh_endprologue
  leaq data(%rip), %r8
  movl $100000, %r9d
loop:
  movq (%r8), %xmm0
  movlps %xmm0, 8(%r8)
  shufps $0xe5, %xmm0, %xmm0
  movl $1, %edx
  lock xaddl %edx, 16(%r8)
  movl %edx, %eax
  incl %eax
  movl $0, %edx
  lock cmpxchgl %edx, 16(%r8)
  decl %r9d
  jne loop
  /* Known checksum: each XADD 0->1 and successful CMPXCHG 1->0. */
  cmpl $0, 16(%r8)
  jne bad
  movq 8(%r8), %rax
  cmpq (%r8), %rax
  jne bad
  leaq message(%rip), %rcx
  call OutputDebugStringA
sleep:
  movl $5, %ecx
  call Sleep
  jmp sleep
bad:
  ud2
.seh_endproc
.data
.p2align 4
/* Retained absolute data reference produces a genuine PE base relocation. */
relocated_data_pointer:
  .quad data
data:
  .quad 0x1122334455667788
  .quad 0
  .long 0
message:
  .asciz "native forms checksum PASS"
.globl _tls_index
_tls_index:
  .long 0
