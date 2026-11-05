/* Original CC0-1.0. Real Windows AMD64 unwind metadata, not host unwinding. */
.text
.globl seh_catch
.seh_proc seh_catch
seh_catch:
 pushq %rbx
 .seh_pushreg %rbx
 subq $48,%rsp
 .seh_stackalloc 48
 .seh_endprologue
 .seh_handler seh_specific, @except
 .seh_handlerdata
 .long 1
 .rva catch_begin, catch_end, seh_filter, catch_landing
 .text
 movq %rsp,seh_expected_sp(%rip)
 movl $0x12345678,%ebx
 movl $0x76543210,40(%rsp)
catch_begin:
 call seh_bridge
 movl $1,seh_bad_return(%rip)
catch_end:
 nop
catch_landing:
 cmpl $0x12345678,%ebx
 jne broken
 cmpl $0x76543210,40(%rsp)
 jne broken
 cmpq seh_expected_sp(%rip),%rsp
 jne broken
 movl $1,seh_landed(%rip)
 jmp done
broken:
 movl $2,seh_bad_return(%rip)
done:
 addq $48,%rsp
 popq %rbx
 ret
.seh_endproc

.globl seh_bridge
.seh_proc seh_bridge
seh_bridge:
 pushq %rbx
 .seh_pushreg %rbx
 subq $32,%rsp
 .seh_stackalloc 32
 .seh_endprologue
 .seh_handler seh_observer, @except, @unwind
 movl $0x55aa55aa,%ebx
 movl $5,%ecx
 call *__imp_Sleep(%rip)
 leaq bridge_text(%rip),%rcx
 call *__imp_OutputDebugStringA(%rip)
 call seh_raise
 movl $3,seh_bad_return(%rip)
 addq $32,%rsp
 popq %rbx
 ret
.seh_endproc

.globl seh_raise
.seh_proc seh_raise
seh_raise:
 subq $40,%rsp
 .seh_stackalloc 40
 .seh_endprologue
 leaq raising_text(%rip),%rcx
 call *__imp_OutputDebugStringA(%rip)
 movl $0xe0420032,%ecx
 xorl %edx,%edx
 movl $2,%r8d
 leaq seh_args(%rip),%r9
 call *__imp_RaiseException(%rip)
 movl $4,seh_bad_return(%rip)
 addq $40,%rsp
 ret
.seh_endproc
.section .rdata,"dr"
bridge_text: .asciz "SEH bridge"
raising_text: .asciz "SEH raising"
.p2align 3
seh_args: .quad 0x1122334455667788,0x8877665544332211
