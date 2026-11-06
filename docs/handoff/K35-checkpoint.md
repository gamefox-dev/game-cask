# K35 checkpoint — Q74 fewer wasm operations per lifted instruction

**New continuation: read [K35b-checkpoint.md](K35b-checkpoint.md) first.** Boolean spans measured/retained;
lazy CMP/TEST measured/rejected; serialized broad gates launched. This older checkpoint remains historical.

**Checkpoint only, not lane acceptance.** Branch lane/K35, base030ccb6 (dev.22 candidate).
Reviewer explicitly stopped this session near150k context to conserve quota; a fresh session continues.
No compaction, game inputs, ABI/schema/oracle changes, installs, web or push. Sole production edit:
**platforms/x86/x86_lift64.h**, lifted-only always-inline low-byte parity via compiler builtin.
Reference semantics are unchanged. Existing transitive header content keys invalidate objects/postprocessing;
reviewer approved existing cache handling. No new cache schema. No structural optimization implemented yet.

## Measured parity step

Nine alternating-order same-process fresh-instance pairs after one discarded pair per mode;30 untimed warmup
updates then300 timed sustained-work updates, compile/instantiate/init excluded. Profile0/accounting0.
Shared-machine host milliseconds, not rendered frames, CPU cycles or a game-speed claim.

| Fixture | Mode | Baseline median ms | parity median ms | Paired delta median (range) |
| --- | --- | ---: | ---: | ---: |
| sustained K34 VM | Asyncify |21.206|19.466|−1.674 (−7.766..−0.703)|
| sustained K34 VM | JSPI |19.734|17.760|−1.743 (−6.519..+9.746)|
| flags control | Asyncify |23.713|16.082|−4.783 (−18.613..+5.829)|
| flags control | JSPI |15.133|16.672|**+1.701** (−5.947..+15.124)|
| memory/stack control | Asyncify |105.426|97.441|−10.811 (−54.644..+31.133)|
| memory/stack control | JSPI |87.081|80.932|−5.971 (−11.616..−5.340)|

**Flags-control JSPI regressed in this noisy sample. No universal parity speedup claim.**
VM paired medians favor parity ~8%; memory JSPI favors it consistently; other spreads are substantial.
All3 fixtures ×2 modes ×2 variants have identical300-update lifted/interpreted oracle hashes, null errors.
New CC0 fixed-assembly controls justify isolating flag/conditional and affine-memory+stack/call patterns
without host-compiler branch elimination. Independent JS code computes their expected scalar results.

Compact samples/resources/artifact/oracle identities: **K35-checkpoint-measurements.json**.
External raw/archive root: **/Users/dev/projects/pi-work/scratch-K35/keep/checkpoint/**.
Includes base/candidate dual artifacts for each fixture, raw pairs, named profile artifacts and dynamic capture.

## Measure-first actual wasm inventory

Named V8 100us sampling,100 untimed warmup +10000 sustained updates; actual both modes, profile0/accountingOFF.
Binaryen disassembly of actual named JSPI wasm. Counts below include const/local/control operators and cold replay/
landing paths, exclude declarations. These are **static inventories, not dynamic operations or physical spills**.
Asyncify/JSPIsamples5050/4371. Reproduce with k35-profile and k35-inspect tools; disassemble before inspection.

| Hot R region | guest insns | wasm ops | ops/static guest | loads/stores | local ops | calls | branch/control | switches | JSPI self samples |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
|010011a0|222|8321|37.48|349/295|2508|197|572|6|1466|
|010015b0|62|2508|40.45|77/89|808|57|179|2|931|
|01001170|15|694|46.27|20/23|269|18|43|1|362|
|010014f0|40|1267|31.68|53/63|384|39|77|3|153|
|01001580|16|230|14.38|10/17|67|9|7|0|69|

Ranked preliminary costs (not additive dynamic cycle shares):
1. Full flag production commonly30–70 inline operations plus old22-op outlined xs_parity; branch consumption
   then extracts packed bits. Most hot state is already in wasm locals; flags/liveness/control shape is structural.
2. Span xl_pointer has41 static operators,3 loads,5 branches/control including its cold tail. Each operand also
   needs effective-address arithmetic, full-width check,64→32 wrap, arena base add and actual load/store.
   Span returns a pointer whose address is discarded and recomputed by the checked block.
3. Stack uses local RSP already, but guard/base/address work persists; CALL/RET also publish/reload CPU state,
   RIP/TSC/budget/retirement at native boundaries. Hundreds of static hot-region memory ops include cold spills,
   not evidence that every guest register access is a struct load/store.
4. Block budget/TSC reservation is roughly9 wasm operations on representative successful paths, plus rare exit
   publication. A local copy is2 ops; a constant-address CPU load/store is typically3. These are path recipes,
   not measured global costs. K31OFF retirement compiles away; ON exactness still needs the final matrix.
5. Conditional/switch costs are visible above; entry dispatch switches and cold landings must not be charged
   once per dynamically retired instruction. Existing region locals, affine spans, native calls and flag liveness
   predate K35; do not claim them as new optimizations.

Before parity, xl_pointer self samples278/231 and xs_parity183/45 Asyncify/JSPI. After parity, the VM JSPI wasm
has no xs_parity function/calls and has343 popcnt operators. IMUL is not a ranked sampled bottleneck.

## Dynamic instrumentation state (unfinished analysis)

**tools/bench/k35-dynamic.test.ts** instruments only owned generated scratch C, after successful block guard/
quantum reservation and at sequential instruction labels. Private counter/export is diagnostic-only, never timed
or shipped. Both suspension modes passed with identical per-site count vectors:1853sites,343active,
15,766,947site visits over300updates after100warmup. Raw **k35-dynamic3/dynamic.json** retained.
Classifying writes consumed only by next Jcc/SETcc/CMOVcc, flag-live-out/fault barriers and block frequencies
remains undone. Do not infer those from static inventories or the unvalidated quick substring classifier.
Two earlier diagnostic attempts failed setup (missing private export): lift content-integrity correctly regenerated
modified C. Current tool updates/restores its scratch integrity record as well as source in finally; production keys
unchanged. First two failed logs retained. No claims from failed runs.

## Exact continuation plan

1. Read this handoff, original user brief, CLAUDE/pipeline/K34/K32/K31, and raw paired evidence. Verify clean branch.
2. **Boolean-span experiment**, separately A/B against parity in both modes/all3fixtures: use a boolean validity
   result rather than unused host-pointer return; no permission bypass except inside existing protection-active
   gating, full-width/overflow/hole/cross-page checks intact, original generic cold boundary/fault order.
   Reviewer approved trying parity then this bounded experiment; not yet implemented.
3. Finish diagnostic dynamic classification, including count-weighted same-block flag producer→conditional
   use, other flag readers and required materializations; quantify actual block reservations vs region alternative.
   Do not use diagnostic build wall time as throughput evidence.
4. **ask_reviewer before implementing structural flags design**: compare direct CMP/TEST/SUB+Jcc fusion and
   lazy op/operands/result locals. Define materialization at every flag read, fault/exception, generic/native exit,
   callback and suspension; preserve interior entries, quantum/TSC/retirement and register alias semantics.
   Reviewer says37–46static ops/guest is structural and small helpers alone do not meet the original ambition.
5. Each retained item separately paired9samples/mode/all3fixtures; repeat noisy flagsJSPI control honestly.
   Add exact fault-state regressions, accountingONexact checks and cache artifact invalidation evidence.
6. Full requested Tier1: doctor, Clang+realGCC lint, types, units, browsers both native backends/both actual
   suspension modes using BGT_E2E_PORT, leakcheck, every pipeline oracle300frames; separate fresh review.
   Suites serial/background, delete owned disposable outputs after jobs exit. Finish docs/handoff/K35.md.

Inherited K34 cross-page partial-qword-store and oversized narrow-SAR followups stay untouched; identical shared
reference traces are not blanket architectural certification. Any reference/oracle-impacting repair needs reviewer.

## Checkpoint validation / honesty boundary

- Parity-focused codegen **176/176PASS**,488.85s; exhaustive ALU mask/shift comparisons and existing full-CPU/RAM,
  pointer/permission/fault/interior/quantum tests. No test assertion/deadline weakening.
- All3paired fixture prepares/oracles and comparisons PASS; counts/modes above. Dynamic capture1/1PASS.
- Final focused ESLint, typecheck, leakcheck and diff-check PASS. Initial ESLint found an unused inspector
  destructure; repaired and rerun green. Public VM artifact rebuilt without the private counter export.
- No full Tier1, independent validation or CI claim. Broad gates still outstanding, not silently accepted.
- Early duplicate preparers were accidentally launched; own roots terminated and clean serial measurements rerun.
  One diagnostic overlapped the codegen suite, so those are correctness-only runs, not timing comparators. No foreign
  processes/locks/caches modified. Reviewer explicitly acknowledged this disclosure and ordered checkpoint.
