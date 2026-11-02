/* Original CC0-1.0. A legal interior function pointer into a no-stack leaf's unwind range.
 * No engine addresses or captured instructions. All external entries use the ordinary Win64 ABI. */
.text
.globl boundary_landing
.def boundary_landing; .scl 2; .type 32; .endef
.seh_proc boundary_landing
boundary_landing:
.seh_endprologue
.rept 32
nop
.endr
.globl boundary_landing_entry
.def boundary_landing_entry; .scl 2; .type 32; .endef
boundary_landing_entry:
cvtsi2ss %ecx, %xmm0
cvtss2sd %xmm0, %xmm0
cvttsd2si %xmm0, %eax
ret
.seh_endproc
