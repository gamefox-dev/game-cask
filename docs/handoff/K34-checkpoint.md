# K34 checkpoint — reviewer #328

## Source / review boundary

Branch lane/K34, based on dev.19 958d5f0 and merged dev.20/K31 (0edf02c via 9f157b1).
**Final production source 4061c0d; final tests 9500bc0.** Subsequent changes are docs only.
Coordinator launched a fresh read-only **external vK34 against 9500bc0** (inline semantics,
faults/guards, K31 ON counts, cache and performance review). Verdict is pending; do not claim PASS.
No game files, web, installs, push, ABI/cache schema/oracle schema changes, or test weakening.
K31 accounting stays default-OFF. No full Tier1/CI or game-frame-speed claim.

## Finished measurement (do not repeat)

CC0 AMD64 bytecode VM: 16-way switch, small noinline helpers, tagged values, pointer accesses,
hash lookup and string comparison/length loops. Initial startup-inclusive named V8 wasm profile:
xl_alu_full 1673/7608 samples (22.0%), xl_pointer_checked 640 (8.4%), x64_shift 606 (8.0%).
At least 889/942 allocation/map samples are boot/GDI/decode/cache setup; 483 scheduler samples are
Sleep/update tail work, not a proven sustained VM bottleneck. Existing GPR locals, flag liveness and
merged guards were confirmed, not newly invented. The dirty-spill experiment was rejected (no win).

Sustained fixture does 30 untimed warmup updates, then 300 timed updates with real dispatch work on
every Sleep. Nine alternating same-process fresh-instance A/B pairs after one discarded pair, in
both suspension modes. Deltas are candidate minus baseline in ms; ranges retain contaminated samples.

| Item | Mode | Baseline median | Candidate median | Paired delta (range) |
|---|---:|---:|---:|---:|
| always-inline full-flag ALU wrapper | Asyncify | 36.55 | 24.58 | -12.49 (-30.18..-10.41) |
| same | JSPI | 34.37 | 22.80 | -11.57 (-11.79..-11.41) |
| default checked-pointer same-page path | Asyncify | 24.66 | 22.39 | -2.63 (-2.81..-1.40) |
| same | JSPI | 22.80 | 19.93 | -2.88 (-3.15..-2.66) |
| always-inline SHL/SAL/SHR/SAR | Asyncify | 22.27 | 18.85 | -3.45 (-4.34..-2.82) |
| same | JSPI | 20.10 | 16.63 | -3.43 (-3.69..-3.26) |

Each candidate's sustained lifted/interpreted 300-frame oracle hashes/traces agree in both modes,
with interp0/stubs[]. Earlier startup-inclusive JSPI ALU 10.866→7.933ms was favorable; Asyncify
ordering was contaminated and is not claimed. Do not turn these shared-host synthetic update times
into a real-game or quiet-host speedup. Raw reports keep every observation in scratch-K34/b/.

Source: platforms/x86/x86_lift64.h (ALU wrapper, checked pointer, scalar shift), tools/x86/lift64.h
(shift sites), CC0 benchmark harness. Rotates retain shared semantics. Pointer slow path retains
full width, holes, permissions, cross-page partial-store behavior and precise spill/fault replay.

Static linked-name audit (raw JSPI artifacts): sustained base has xl_alu_full and xl_pointer_checked;
wrapper removes xl_alu_full; pointer removes xl_pointer_checked and retains xl_pointer_full; shift
has no xl_shift definition (inlined), while x64_shift remains for shared semantics/rotates. Raw bytes
base1455777→wrapper1471701→pointer1489687→shift1489372: speed trades some size, not a size win.

## Finished focused correctness

- Inherited final-focused.log/.exit: **181/181 PASS**, two files (codegen + build-chunks), exit0,
  946.56s total. Includes exhaustive xl_shift/reference flags and mid-region shift+memory-fault
  full CPU/RAM/PC/clock snapshot with correct independent RAX=0x80000000 expectation. Existing
  tests cover high addresses, holes, permissions, partial stores, dead/live flags and both modes.
- Earlier overlapping codegen2.log/.exit: **174 pass /2 failed**, exit1, loaded stale RAX=0
  expectation. It was already corrected before final-focused loaded. Do not relabel it green.
- Final-source cache-focused4.log/.exit: **1/1 PASS**, exit0, 24.42s test body. New
  tests/unit/lifted-header-cache.test.ts copies actual x86_lift64.h to a private temp tree,
  mutates only the exported probe helper result and requires one object recompile + header miss,
  changed linked/JSPI/Asyncify hashes + cold postprocess, then complete warm reuse. Production
  header is never edited. Tiny i386 pipeline avoids an unnecessary PE64 relocation requirement;
  the exported helper probe defines X86_WIDE_CPU. First AMD64 setup attempts failed on missing
  relocation metadata, not a correctness assertion. Cache-focused2 was inadvertently reused by
  a later harness attempt; its currently retained output is a prior simple-probe PASS, not final
  copied-real-header proof. Only cache-focused4 establishes that final source proof.
- types4.log/.exit and cache-eslint4.log/.exit: PASS0; gates-focused3.exit=0 is the final
  prerequisite marker written by gates-focused4.sh. Earlier gates-focused.exit=1 is historical.

## Live serial Tier1 — leave running

Scratch root: **/Users/dev/projects/pi-work/scratch-K34**.
Active detached root **PID21467** (identity observed via kill0 on this checkpoint), launched by
scratch-K34/tier1.sh. PID file tier1b.pid, launch log tier1b-launch.log. Do not signal a PID without
rechecking identity. Prior roots6289/86415 and focused roots have completed. No new suite overlap.

Gate evidence: **scratch-K34/tier1/**. Each stage writes NAME.started/.log/.exit/.finished;
runner.exit is written only on completion or gate failure. At checkpoint **doctor.exit=0**, and
**lint-clang is running** (no exit marker yet, only normal toolchain warnings). An inspection-shell
exit1 came from tail on nonexistent future units.log; it was NOT a lint failure. The old tier1/blocked
file is from an earlier prerequisite launch and is NOT the current active runner state.
source.txt is9500bc0, source.diff is empty. Production/tests do not change during this run.

Runner uses existing heavy shim, BGT_BUILD_JOBS=2, ZIG_GLOBAL_CACHE_DIR=scratch-K34/zig-cache,
BGT_E2E_PORT=5279, dual artifacts, actual Node JSPI, required WebGPU, no light exclusions. Serial plan:
1. doctor (PASS), full lint CC=clang, full lint realGCC14, explicit clang host checks,
   explicit x64-scale check-build, types, full npm test -- --maxWorkers=1;
2. full npm run test:e2e Asyncify then JSPI, both backends +auto. Copies JSON to
   tier1/e2e-{asyncify,jspi}-results.json, removes only owned bulky browser HTML/artifacts;
3. enumerate every examples/*/game.json pipeline into oracle-inventory.txt (expected34), then
   both modes ×300 frames, raw reports copied to tier1/oracles/MODE-ID.json;
4. leakcheck + diffcheck. First failed step stops; inspect before repairing/relaunching.

## Next session

1. Read this checkpoint first, original brief and reviewer decisions. Inspect active Tier1 markers/logs;
   do not repeat any completed green suite. Diagnose actual failures without assertion/deadline/skip changes.
2. Obtain external vK34 verdict through coordinator; list any later code delta precisely and re-review it.
3. Audit full browser inventories/skips/native backends and all 68 oracle reports, exact300 requested/
   compared, no errors, zero lifted interpretation/stubs, equal within/cross-mode state and semantic hashes.
4. Finish docs/handoff/K34.md with exact evidence, no inflated independent/CI/game claims. Commit, never push.
5. Clean owned disposable outputs only after jobs finish; disk last ~5.7GiB free. Keep raw measurements/logs.

Retained A/B artifacts: b/{base,inline,pointer,wrapper,sustained-base,sustained-wrapper,sustained-pointer,
sustained-shift}/game + evidence.json. Paired raw reports b/{alu,wrapper,pointer,yield,sustained-alu,
sustained-pointer,sustained-shift}-paired.json. No additional performance samples are required for these items.
