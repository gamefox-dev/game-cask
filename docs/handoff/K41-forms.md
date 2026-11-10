# K41 baseline: representative C / actual wasm / ideal shape

Compiler-source attribution, not isolated causal costs. Each form combines multiple sites and live masks. C is one representative site; the actual WAT excerpt can be another site of the same form. Full immutable WAT, map and hashes remain in scratch. Excerpts deliberately retain neighboring source comments: optimized expression trees can combine multiple guest instructions. Ideal shapes must preserve exact state, fault order and deterministic undefined-flag choices; they are not all measured wins.

## add_r64_r64 — 34464982 dynamic original operators

Actual emitted C (1001220, add rcx, rbp):
~~~c
dirty|=0x2u;t=(uint64_t)r[1];u=(uint64_t)r[5];t=xl_alu_full(0,t,u,8,&flags);r[1]=(uint64_t)(t);
~~~
Actual WAT excerpt (source-attributed form; full surrounding function in scratch):
~~~wat
                                                                                                                          ;;@ form-add_r64_r64:1:0
                                                                                                                          (i64.add
                                                                                                                           ;;@ boundary:1:0
                                                                                                                           (local.get $11)
                                                                                                                           ;;@ form-add_r64_r64:1:0
                                                                                                                           (local.tee $29
                                                                                                                            ;;@ form-lea_r64_m64:1:0
                                                                                                                            (i64.mul
                                                                                                                             ;;@ boundary:1:0
                                                                                                                             (local.tee $20
                                                                                                                              ;;@ form-mov_r32_r32:1:0
                                                                                                                              (i64.and
                                                                                                                               ;;@ boundary:1:0
                                                                                                                               (local.get $13)
                                                                                                                               ;;@ boundary:1:0
                                                                                                                               (i64.const 4294967295)
                                                                                                                              )
                                                                                                                             )
                                                                                                                             ;;@ boundary:1:0
                                                                                                                             (i64.const 12)
                                                                                                                            )
                                                                                                                           )
                                                                                                                          )
                                                                                                                         )
                                                                                                                        )
                                                                                                                        ;;@ form-call_:1:0
                                                                                                                        (i64.store offset=2632288
                                                                                                                         ;;@ boundary:1:0
                                                                                                                         (i32.const 0)
                                                                                                                         ;;@ form-lea_r64_m64:1:0
                                                                                                                         (i64.mul
                                                                                                                          ;;@ boundary:1:0
                                                                                                                          (local.get $20)
                                                                                                                          ;;@ boundary:1:0
                                                                                                                          (i64.const 3)
~~~
Ideal exact shape: One i64.add plus exact carry/overflow/AF/SZP production; preserve other flags.

## call_ — 21630715 dynamic original operators

Actual emitted C (100101c, call 0x1001ad0):
~~~c
dirty|=0x10u;t=0x01001ad0u;r[4]-=8;address=(uint32_t)r[4];p=xl_pointer_checked(address,8,2);if(!p){fault=0x100102100000028ull;value=0x01001021ull;goto memory_fault;}
xl_store(p,0x01001021ull,8);XR_ADD(retire_clock,t>UINT32_MAX);X.r[0]=r[0];X.r[1]=r[1];X.r[2]=r[2];X.r[3]=r[3];X.r[4]=r[4];X.r[5]=r[5];X.r[6]=r[6];X.r[7]=r[7];X.r[8]=r[8];X.r[9]=r[9];X.r[10]=r[10];X.r[11]=r[11];X.r[12]=r[12];X.r[13]=r[13];X.r[14]=r[14];X.r[15]=r[15];x86_retire(XR_LIFTED,clock-retire_clock);retire_clock=clock;X.flags=flags;X.tsc=clock;X.frame_insns=budget;
X.eip=0x01001021u;X.eip=x86_address(t);if(x86_native_enter(X.eip,N_01001ad0)){uint64_t floor=X.r[4];N_01001ad0(X.eip);if(!x86_native_resume(0x01001021u,floor,N_01001000))return;r[0]=X.r[0];r[1]=X.r[1];r[2]=X.r[2];r[3]=X.r[3];r[4]=X.r[4];r[5]=X.r[5];r[6]=X.r[6];r[7]=X.r[7];r[8]=X.r[8];r[9]=X.r[9];r[10]=X.r[10];r[11]=X.r[11];r[12]=X.r[12];r[13]=X.r[13];r[14]=X.r[14];r[15]=X.r[15];flags=X.flags;clock=X.tsc;budget=X.frame_insns;retire_clock=clock;
dirty=0;pc=X.eip;x86_coverage_lifted(pc,1);goto L_01001021;
}
return;
~~~
Actual WAT excerpt (source-attributed form; full surrounding function in scratch):
~~~wat
                                       ;;@ form-call_:1:0
                                       (i64.store align=1
                                        (i32.add
                                         (i32.load offset=8924704
                                          (i32.const 0)
                                         )
                                         (i32.wrap_i64
                                          (local.get $6)
                                         )
                                        )
                                        ;;@ boundary:1:0
                                        (i64.const 16781526)
                                       )
                                       ;;@ form-call_:1:0
                                       (i64.store offset=120
                                        (i32.const 2632288)
                                        (local.get $5)
                                       )
                                       ;;@ form-call_:1:0
                                       (i64.store offset=112
                                        (i32.const 2632288)
                                        (local.get $27)
                                       )
                                       ;;@ form-call_:1:0
                                       (i64.store offset=104
                                        (i32.const 2632288)
                                        (local.get $7)
                                       )
                                       ;;@ form-call_:1:0
                                       (i64.store offset=96
                                        (i32.const 2632288)
                                        (local.get $8)
                                       )
                                       ;;@ form-call_:1:0
                                       (i64.store offset=88
~~~
Ideal exact shape: One RSP decrement and checked RA store, followed by exact publication and existing guarded native entry/resume. Admission is not optional.

## xor_m8_r8 — 20018807 dynamic original operators

Actual emitted C (100123e, xor byte [r12+rax], r14b):
~~~c
address=(((r[12]+0x0ull)+(r[0]<<0)));p=xl_pointer_checked(address,1,1);if(!p){fault=0x100124200000301ull;value=0;goto memory_fault;}
t=xl_load(p,1);u=(uint8_t)r[14];t=xl_alu_full(6,t,u,1,&flags);address=(((r[12]+0x0ull)+(r[0]<<0)));p=xl_pointer_checked(address,1,2);if(!p){fault=0x100124200000321ull;value=t;goto memory_fault;}
xl_store(p,t,1);
~~~
Actual WAT excerpt (source-attributed form; full surrounding function in scratch):
~~~wat
                                                            ;;@ form-xor_m8_r8:1:0
                                                            (br_if $block288
                                                             (local.tee $22
                                                              (i64.gt_u
                                                               ;;@ boundary:1:0
                                                               (local.tee $29
                                                                ;;@ form-xor_m8_r8:1:0
                                                                (i64.add
                                                                 (local.tee $15
                                                                  ;;@ form-and_r32_i32:1:0
                                                                  (i64.and
                                                                   ;;@ form-add_r32_r32:1:0
                                                                   (local.tee $20
                                                                    (i64.add
                                                                     ;;@ boundary:1:0
                                                                     (local.get $4)
                                                                     ;;@ form-lea_r32_m32:1:0
                                                                     (i64.mul
                                                                      ;;@ boundary:1:0
                                                                      (local.get $26)
                                                                      ;;@ boundary:1:0
                                                                      (i64.const 13)
                                                                     )
                                                                    )
                                                                   )
                                                                   ;;@ form-add_r32_r32:1:0
                                                                   (i64.const 8191)
                                                                  )
                                                                 )
                                                                 ;;@ form-xor_m8_r8:1:0
                                                                 (local.get $6)
                                                                )
                                                               )
                                                               ;;@ boundary:1:0
                                                               (i64.const 1073741823)
~~~
Ideal exact shape: Checked byte read, i32 XOR, eager exact flags, checked byte write; failing write exposes newly computed flags.

## cmp_r8_m8 — 19916316 dynamic original operators

Actual emitted C (10013a0, cmp cl, byte [rax]):
~~~c
t=(uint8_t)r[1];p=x86_flat+(uint32_t)(((r[0]+0x0ull)));
u=xl_load(p,1);t=xl_alu_full(7,t,u,1,&flags);
~~~
Actual WAT excerpt (source-attributed form; full surrounding function in scratch):
~~~wat
                                                                                            ;;@ form-cmp_r8_m8:1:0
                                                                                            (local.set $28
                                                                                             (i32.const 0)
                                                                                            )
                                                                                            ;;@ form-cmp_r8_m8:1:0
                                                                                            (local.set $2
                                                                                             (i32.xor
                                                                                              (i32.or
                                                                                               (i32.or
                                                                                                (i32.or
                                                                                                 (i32.and
                                                                                                  (i32.wrap_i64
                                                                                                   (local.tee $29
                                                                                                    (i64.sub
                                                                                                     (local.get $15)
                                                                                                     (local.tee $30
                                                                                                      (i64.load8_u
                                                                                                       (i32.add
                                                                                                        (i32.load offset=8924704
                                                                                                         (i32.const 0)
                                                                                                        )
                                                                                                        (i32.wrap_i64
                                                                                                         (local.get $16)
                                                                                                        )
                                                                                                       )
                                                                                                      )
                                                                                                     )
                                                                                                    )
                                                                                                   )
                                                                                                  )
                                                                                                  (i32.const 128)
                                                                                                 )
                                                                                                 (i32.and
                                                                                                  (local.get $2)
                                                                                                  (i32.const -2262)
~~~
Ideal exact shape: Checked byte read and width-8 subtract/compare flag recipe; no register write.

## cmp_r32_i32 — 19633768 dynamic original operators

Actual emitted C (100110e, cmp edi, 0x100):
~~~c
t=(uint32_t)r[7];u=0x100ull;t=xl_alu_full(7,t,u,4,&flags);
~~~
Actual WAT excerpt (source-attributed form; full surrounding function in scratch):
~~~wat
                                  ;;@ form-cmp_r32_i32:1:0
                                  (local.set $27
                                   (i64.sub
                                    ;;@ boundary:1:0
                                    (i64.const 254)
                                    ;;@ form-cmp_r32_i32:1:0
                                    (local.get $13)
                                   )
                                  )
                                  ;;@ form-cmp_r32_i32:1:0
                                  (local.set $4
                                   (i32.xor
                                    (i32.or
                                     (i32.or
                                      (i32.or
                                       (i32.and
                                        (i32.shr_u
                                         (local.tee $20
                                          (i32.wrap_i64
                                           (local.tee $14
                                            (i64.add
                                             (local.get $13)
                                             (i64.const 4294967041)
                                            )
                                           )
                                          )
                                         )
                                         (i32.const 24)
                                        )
                                        (i32.const 128)
                                       )
                                       (i32.and
                                        (local.get $4)
                                        (i32.const -2262)
                                       )
~~~
Ideal exact shape: i32 subtraction and unsigned carry/overflow/SZP/AF recipe, with one incoming low-32 extraction.

## xor_r32_r32 — 16676319 dynamic original operators

Actual emitted C (1001030, xor eax, eax):
~~~c
dirty|=0x1u;t=(uint32_t)r[0];u=(uint32_t)r[0];t=xl_alu_full(6,t,u,4,&flags);r[0]=(uint32_t)(t);
~~~
Actual WAT excerpt (source-attributed form; full surrounding function in scratch):
~~~wat
                                                      ;;@ form-xor_r32_r32:1:0
                                                      (local.set $4
                                                       (i32.or
                                                        (i32.and
                                                         ;;@ boundary:1:0
                                                         (local.get $4)
                                                         ;;@ boundary:1:0
                                                         (i32.const -2262)
                                                        )
                                                        ;;@ form-xor_r32_r32:1:0
                                                        (i32.const 68)
                                                       )
                                                      )
                                                      ;;@ form-xor_r32_r32:1:0
                                                      (local.set $5
                                                       (i64.const 16789648)
                                                      )
                                                      ;;@ form-xor_r32_r32:1:0
                                                      (local.set $27
                                                       (i64.const 0)
                                                      )
                                                      ;;@ form-xor_r32_r32:1:0
                                                      (local.set $13
                                                       (i64.const 3)
                                                      )
                                                      ;;@ form-xor_r32_r32:1:0
                                                      (local.set $17
                                                       (i64.const 16802264)
                                                      )
                                                      ;;@ form-xor_r32_r32:1:0
                                                      (local.set $20
                                                       (i32.const 49288)
                                                      )
                                                     )
                                                     ;;@ boundary:1:0
~~~
Ideal exact shape: For identical operands: zero register and constant arithmetic flags; otherwise i32 XOR and exact flags.

## test_r8_r8 — 16154403 dynamic original operators

Actual emitted C (1001173, test dl, dl):
~~~c
t=(uint8_t)r[2];u=(uint8_t)r[2];t=xl_alu_full(16,t,u,1,&flags);
~~~
Actual WAT excerpt (source-attributed form; full surrounding function in scratch):
~~~wat
                  ;;@ form-test_r8_r8:1:0
                  (local.set $4
                   (i32.or
                    (local.tee $15
                     (select
                      (local.tee $15
                       (i32.or
                        (select
                         (i32.and
                          ;;@ form-movzx_r32_m8:1:0
                          (local.tee $0
                           (i32.load8_u
                            (i32.add
                             (i32.load offset=8924704
                              (i32.const 0)
                             )
                             (i32.wrap_i64
                              (local.get $7)
                             )
                            )
                           )
                          )
                          ;;@ form-movzx_r32_m8:1:0
                          (i32.const 16)
                         )
                         ;;@ form-test_r8_r8:1:0
                         (i32.const 64)
                         ;;@ form-test_r8_r8:1:0
                         (local.get $0)
                        )
                        ;;@ form-test_r8_r8:1:0
                        (i32.and
                         (local.get $0)
                         (i32.const 128)
                        )
~~~
Ideal exact shape: i32 AND and exact deterministic reference flags, including its AF choice; no destination write.

## add_r64_i64 — 15227326 dynamic original operators

Actual emitted C (100108d, add rax, 0x10):
~~~c
dirty|=0x1u;t=(uint64_t)r[0];u=0x10ull;t=xl_alu_full(0,t,u,8,&flags);r[0]=(uint64_t)(t);
goto L_01001091;
~~~
Actual WAT excerpt (source-attributed form; full surrounding function in scratch):
~~~wat
                                                         ;;@ form-add_r64_i64:1:0
                                                         (local.set $4
                                                          (i32.or
                                                           (i32.or
                                                            (select
                                                             (i32.or
                                                              (local.tee $0
                                                               (select
                                                                (i32.or
                                                                 (local.tee $0
                                                                  (i32.xor
                                                                   (i32.or
                                                                    (i32.and
                                                                     (i32.wrap_i64
                                                                      (i64.xor
                                                                       (local.tee $30
                                                                        (i64.add
                                                                         ;;@ boundary:1:0
                                                                         (local.get $21)
                                                                         ;;@ boundary:1:0
                                                                         (i64.const 16)
                                                                        )
                                                                       )
                                                                       ;;@ form-add_r64_i64:1:0
                                                                       (local.get $21)
                                                                      )
                                                                     )
                                                                     ;;@ form-add_r64_i64:1:0
                                                                     (i32.const 16)
                                                                    )
                                                                    ;;@ form-add_r64_i64:1:0
                                                                    (select
                                                                     (i32.or
                                                                      (local.tee $0
                                                                       (i64.gt_u
~~~
Ideal exact shape: One i64.add and exact immediate-specialized flags.

## cmp_r64_i64 — 14235592 dynamic original operators

Actual emitted C (1001095, cmp rax, 0x100):
~~~c
t=(uint64_t)r[0];u=0x100ull;t=xl_alu_full(7,t,u,8,&flags);
~~~
Actual WAT excerpt (source-attributed form; full surrounding function in scratch):
~~~wat
                                                        ;;@ form-cmp_r64_i64:1:0
                                                        (local.set $4
                                                         (i32.or
                                                          (i32.xor
                                                           (i32.or
                                                            (i32.and
                                                             ;;@ boundary:1:0
                                                             (local.get $4)
                                                             ;;@ boundary:1:0
                                                             (i32.const -2262)
                                                            )
                                                            ;;@ form-cmp_r64_i64:1:0
                                                            (i32.shl
                                                             (i32.and
                                                              (i32.popcnt
                                                               (i32.and
                                                                (i32.wrap_i64
                                                                 (local.get $21)
                                                                )
                                                                (i32.const 255)
                                                               )
                                                              )
                                                              (i32.const 1)
                                                             )
                                                             (i32.const 2)
                                                            )
                                                           )
                                                           ;;@ form-cmp_r64_i64:1:0
                                                           (i32.const 4)
                                                          )
                                                          ;;@ form-cmp_r64_i64:1:0
                                                          (local.tee $2
                                                           (select
                                                            (i32.or
                                                             (local.tee $20
~~~
Ideal exact shape: One i64 subtraction/compare and exact immediate-specialized flags.

## shl_r32_i8 — 13625770 dynamic original operators

Actual emitted C (1001280, shl esi, 0x4):
~~~c
dirty|=0x40u;t=(uint32_t)r[6];u=0x4ull;t=xl_shift(12,t,(uint32_t)u,4,&flags);r[6]=(uint32_t)(t);
~~~
Actual WAT excerpt (source-attributed form; full surrounding function in scratch):
~~~wat
                                                                                                                           ;;@ form-shl_r32_i8:1:0
                                                                                                                           (i32.and
                                                                                                                            ;;@ form-shr_r32_i8:1:0
                                                                                                                            (local.get $2)
                                                                                                                            ;;@ form-shr_r32_i8:1:0
                                                                                                                            (i32.const -2246)
                                                                                                                           )
                                                                                                                          )
                                                                                                                          ;;@ form-shr_r32_i8:1:0
                                                                                                                          (i32.and
                                                                                                                           (i32.shr_u
                                                                                                                            (local.get $1)
                                                                                                                            (i32.const 20)
                                                                                                                           )
                                                                                                                           (i32.const 2048)
                                                                                                                          )
                                                                                                                         )
                                                                                                                         ;;@ form-shr_r32_i8:1:0
                                                                                                                         (i32.shl
                                                                                                                          (i64.eqz
                                                                                                                           (local.tee $14
                                                                                                                            (i64.and
                                                                                                                             (local.tee $20
                                                                                                                              (i64.shr_u
                                                                                                                               (local.get $14)
                                                                                                                               (i64.const 4)
                                                                                                                              )
                                                                                                                             )
                                                                                                                             (i64.const 268435455)
                                                                                                                            )
                                                                                                                           )
                                                                                                                          )
                                                                                                                          (i32.const 6)
                                                                                                                         )
                                                                                                                        )
~~~
Ideal exact shape: One i32 shift with zero-extension plus live flag recipe; proven-dead recipes can disappear only without increasing surrounding work.
