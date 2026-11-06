/* Original CC0-1.0. Fixed instruction shapes for K35; normal Win64 calling convention. */
.text
.globl k35_flags
.def k35_flags; .scl 2; .type 32; .endef
.seh_proc k35_flags
k35_flags:
.seh_endprologue
    xorl %eax,%eax
    movl $1,%edx
1:
    addl %edx,%eax
    cmpl $16384,%eax
    jb 2f
    subl $16384,%eax
2:
    xorl $21,%edx
    testl $1,%edx
    setne %r8b
    movzbl %r8b,%r8d
    addl %r8d,%eax
    decl %ecx
    jne 1b
    ret
.seh_endproc

.globl k35_memory
.def k35_memory; .scl 2; .type 32; .endef
.seh_proc k35_memory
k35_memory:
    pushq %rbx
.seh_pushreg %rbx
    subq $32,%rsp
.seh_stackalloc 32
.seh_endprologue
    movq %rcx,%rbx
    xorl %eax,%eax
3:
    movl (%rbx),%r8d
    addl 4(%rbx),%r8d
    xorl 8(%rbx),%r8d
    movl %r8d,12(%rbx)
    addl %r8d,%eax
    pushq %rax
    popq %r9
    call k35_leaf
    decl %edx
    jne 3b
    addq $32,%rsp
    popq %rbx
    ret
.seh_endproc

.def k35_leaf; .scl 2; .type 32; .endef
.seh_proc k35_leaf
k35_leaf:
.seh_endprologue
    xorl $85,%eax
    ret
.seh_endproc
