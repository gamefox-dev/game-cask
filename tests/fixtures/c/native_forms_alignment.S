/* SPDX-License-Identifier: CC0-1.0 — called with Windows x64 shadow space. */
.text
.globl stack_contract
.def stack_contract; .scl 2; .type 32; .endef
.seh_proc stack_contract
stack_contract:
  movq %rsp, %rax
  andl $15, %eax
  cmpl $8, %eax
  jne bad_stack
  subq $40, %rsp
  .seh_stackalloc 40
  .seh_endprologue
  movq %rsp, %rax
  andl $15, %eax
  jne restore_bad
  /* An aligned legacy source on the real guest stack. */
  xorps %xmm0, %xmm0
  movups %xmm0, (%rsp)
  shufps $0xe5, (%rsp), %xmm0
  movl $1, %eax
  addq $40, %rsp
  ret
restore_bad:
  addq $40, %rsp
bad_stack:
  xorl %eax, %eax
  ret
.seh_endproc
