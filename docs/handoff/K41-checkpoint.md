# K41 — emitted instruction forms (checkpoint, not final acceptance)

Branch lane/K41, base dev.25 4573726. Reviewer explicitly requested checkpoint/end near
150k context; a fresh session runs serial Tier 1 and writes docs/handoff/K41.md.
**No full Tier 1, CI or independent-validation pass is claimed.** CC0 fixtures only;
no games, web, installs, push, ABI/cache-key/oracle-policy/reference-semantic change.
Scratch root **/Users/dev/projects/pi-work/scratch-K41/** is retained; never delete it.
Port **BGT_E2E_PORT=5293**. All owned jobs exited before the checkpoint commit; no Tier1 runner is active.

## Retained production change

Only platforms/x86/x86_lift64.h: the old noinline i128 IMUL helper is renamed
xl_imul_wide; an always-inline xl_imul uses signed int64 products for widths 1/2/4,
and routes width8 to the old i128 recipe. A signed32×signed32 product fits in int64;
the width-truncated result and signed full-result comparison retain exact CF/OF.
All other flag bits are preserved. Register partial/zero-extension writes, pointer
checks, fault publication, clocks/retirement, calls/callbacks and suspension remain
unchanged. The emitter tools/x86/lift64.h is byte-identical to base after rejection.
Existing transitive header/source content dependencies invalidate objects naturally;
cache-freshness regression remains part of the pending broad suite.

## Measurement / ranking

Bench-only K39 counter/decode code copied from lane/K39 in kit-v03. K41 adds LLVM
DWARF line + inline-caller range attribution, using -g/-gdwarf-4 only on lifted TUs
without changing optimization flags. Original wasm operators only; added diagnostics
never count themselves and instrumented code is never timed. Block/loop entry markers,
synthetic exits and overlapping EA slices are excluded from totals. Compiler source
attribution is not a unique causal attribution: shared optimized work can move between
forms. Boundary/unattributed work is separate, and IMUL helper bodies use dynamic caller
context. All counted modules reproduce all330 original API hashes, accounting totals,
coverage counters and sorted code/kind/drop snapshots. API hashes are not whole-CPU hashes.

Full rankings, opcode inventories, raw paired samples/resources and artifact hashes:
[K41-checkpoint-measurements.json](K41-checkpoint-measurements.json). Top10 representative
emitted C / actual WAT excerpts / ideal exact shapes: [K41-forms.md](K41-forms.md).
Excerpts may include neighboring forms because LLVM merges expression trees.

Baseline dynamic operators attributed to forms (JSPI, exact accounting ON):

| fixture | highest forms (million original ops) |
|---|---|
| VM | ADD r64,r64 34.465; direct CALL 21.631; XOR m8,r8 20.019; CMP r8,m8 19.916; CMP r32,imm 19.634; XOR r32,r32 16.676; TEST r8,r8 16.154; ADD r64,imm 15.227; CMP r64,imm 14.236; SHL r32,imm 13.626 |
| flags | DEC r32 223.928; CMP r32,imm 207.990; ADD r32,r32 91.971; XOR r32,imm 15.995 |
| memory | direct CALL 351.208; ADD r32,r32 240.610; DEC r32 216.944; XOR r32,imm 126.222; MOV r32,m32 55.222; RET 51.288; POP 31.568; PUSH 27.620 |

MOV/LEA/stack forms already have straightforward scalar writes/one RSP update; no
speculative known-upper-zero state, weakened memory check or broad lazy flag descriptor
was introduced. Reviewer approved bounded eager width specialization first, requiring
leaner actual WAT, per-width random/edge tests and no regression beyond paired spread.

## Separately measured A/B results

30 untimed +300 timed sustained host updates; one discarded then9 alternating-order
fresh-instance pairs in one process. Instantiate/init excluded. Accounting ON,
CPU profile OFF; actual Asyncify and JSPI artifacts. Shared-host wall milliseconds,
not guest frames, isolated cycles or game gains. Negative paired delta is faster.

| change | fixture | Asyncify paired median (range) ms | JSPI paired median (range) ms |
|---|---|---:|---:|
| retained IMUL vs base | VM | -.219 (-2.322..+2.091) | -.717 (-1.455..-.643) |
| retained IMUL vs base | flags | -.001 (-.211..+.101) | +.015 (-.175..+.850) |
| retained IMUL vs base | memory | -.062 (-2.206..+4.687) | -.137 (-.685..+1.049) |
| rejected narrow ALU vs base | VM | +1.239 (-2.957..+3.212) | +.436 (+.352..+.512) |
| rejected narrow ALU vs base | flags | +.492 (+.292..+.795) | -.133 (-.252..-.042) |
| rejected narrow ALU vs base | memory | -.768 (-2.563..+1.339) | -.567 (-2.860..+.639) |
| rejected shift-mask vs IMUL | VM | +.193 (-5.717..+2.211) | -.053 (-.261..+.124) |
| rejected shift-mask vs IMUL | flags | +.032 (-.567..+.285) | -.011 (-.241..+.130) |
| rejected shift-mask vs IMUL | memory | +.442 (-2.873..+4.473) | -.104 (-1.747..+2.432) |

IMUL's VM-JSPI paired gain is about5.5%; all9 deltas negative. Asyncify and the other
fixtures are neutral within spread, not universal wins. VM IMUL-form ops including
outlined helper bodies **11,430,597→1,608,792**; owners **427,098,436→411,719,551**;
runtime **55,421,220→46,627,446**. These counts are exact-mode/accounting-ON, not K39's
weakened-state c variant, so totals are intentionally different from K39's table.

Rejected narrow ALU used i32 math for <=32-bit operands, preserving eager flags. It
slightly lowered whole-owner count (427,098,436→426,788,949), but VM-JSPI and flags-
Asyncify regressed consistently. Rejected shift-mask passed existing liveness to scalar
shifts without changing analysis: attributed SHL ops13,625,770→13,218,748, but total
owner work increased30,524 and timing was neutral. Reviewer explicitly selected
**IMUL only**. Rejected patches and immutable before/after artifacts remain in scratch;
no rejected helper/emitter code ships.

## Proof / gate boundary

- Every prepared variant: both actual modes,330-update lifted/interpreted API-hash
  equality, exact total/stable-thread retirement equality, interp0/stubs[].
- Retained and rejected counted variants: all330 original API hashes + exact core
  accounting/coverage equality. Counter analytical tests **5/5 PASS**.
- Initial final-focused candidate (IMUL+rejected shift): **12/12 PASS**,179 selection
  skips (not relaxed tests),100.53s. Final IMUL-only checkpoint rerun results are in
  logs/checkpoint-focused.{log,exit}: **10/10 PASS**,179 selection skips,97.23s,exit0.
- Added ALU matrix: 4widths ×9ops ×2409 edge/random pairs ×2initial carries ×64live masks;
  all arithmetic flags and preservation of all other bits. Instruction-level ALU
  tests cover AL/AH/BH,16/32/64 writes, normal/unmapped-fault complete CPU+RAM snapshots,
  diagnostic/address equality, both size/fast policies. IMUL adds4widths ×4292 edge/
  random full-product comparisons and register/immediate/memory forms with upper-bit
  and pre/post-operation fault state, both policies. The full-product reference uses
  signed i128; all flag bits compared, not only CF/OF.
- Header specializations are inline: debug attribution must not silently alter code.
  Ordinary -g0 versus attributed -g/-gdwarf-4 executable-section equality is checked
  for both artifacts of all3fixtures. **All six executable-section comparisons PASS**
  at final IMUL-only source. Reports: debug-identity-*.json and
  logs/checkpoint-identity-*.{log,exit}, all exit0.
- Earlier focused full-codegen attempt was author-stopped to replace expensive Vitest
  RAM deep traversal with **native Buffer.equals over every byte** in the new matrix.
  It is not a completed pass. No existing coverage/assertion/deadline was relaxed.
- Pre-rejection typecheck/leakcheck passed; lint initially failed on structuredClone
  globals and an unused bench adapter import. Both lint causes were repaired. Final
  checkpoint static-check logs are checkpoint-{types,eslint,leak}.{log,exit}:
  **typecheck, focused ESLint and leakcheck all exit0**. Diffcheck also exit0.

## Resume / next mandatory work

1. Read this checkpoint and actual exit markers; inspect clean branch. Do not revive
   rejected experiments. Checkpoint is not final acceptance.
2. Run serial Tier1 at final commit: doctor; npm run lint plus explicit real GCC and
   Clang checks; typecheck; **npm test with unchanged deadlines**; npm run test:e2e in
   Asyncify and JSPI (required WebGL2+WebGPU); all pipeline oracles ×2modes ×300frames,
   accounting ON; leakcheck/diffcheck. No timeout/skips/coverage weakening.
3. Prepared external runners: scratch-K41/tier1-final.sh and oracles-final.mjs. The
   runner waits for scratch-K41/final-source-ready (NOT created in this session),
   requires a clean committed tree, sets port5293 and uses --maxWorkers=1 only.
   **Neither Tier1 runner nor CI was started.** Suites must remain serial and background.
   Oracle runner deletes owned per-fixture temp outputs after saving reports.
4. Obtain fresh independent validation (none ran yet). Audit all raw gate reports;
   retain failed/aborted historical logs. Write final docs/handoff/K41.md with precise
   acceptance boundaries and a final <200-word reply. Preserve scratch root; remove
   owned temporary output files only after their jobs exit.

Reproduce bench: BGT_TRIAL_SCRATCH=... BGT_CPU_ACCOUNTING=1 BGT_CPU_PROFILE=0
BGT_PROFILE_NAMES=1 BGT_BUILD_JOBS=2; BGT_K41_FIXTURE=vm|flags|memory and
BGT_K41_PREPARE=base|imul with vitest --config tools/bench/k41.config.ts (base requires
base source, not current). Pair prepared artifacts with BGT_K41_PAIR=base,imul.
Counter: BGT_K41_REVISION=imul node tools/bench/k41-count.mjs vm, then
BGT_K41_FIXTURE=vm BGT_K41_REVISION=imul BGT_K41_COUNT=1 vitest --config ... .
Report: node tools/bench/k41-report.mjs. Do not time instrumented artifacts.
