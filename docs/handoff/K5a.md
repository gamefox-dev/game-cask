# Lane K5a — Q18 string instruction semantics

## Delivery / ownership

- Implementation commit: `c14606f` (`lane/K5a`, no push).
- Shared `platforms/x86/x86_sem.h` string helper now serves i386/AMD64 interpreted and generated execution.
  Both dispatchers use it; AMD64's old unconditional RSI/RDI validation is removed.
- **Reviewer-approved narrow cross-ownership edit:** `tools/x86/x86tool.c`, marked `LANE-K5a`, passes
  address size, instruction/successor addresses and source segment to the i386 helper, then returns on
  transfer. No other lifter policy changed. K5c also owns changes in this file: merge the small call-site
  diff, not an entire version of the file.
- No game files, input evidence, target disassembly, engine-specific behavior, dependencies, web access,
  system installs, ABI/profile changes or test weakening. Supplied target measurements stayed outside
  the repository. The porter must replay the actual target; this lane makes no post-fix target claim.

## Architectural contracts

- MOVS/CMPS use source and destination; STOS/SCAS use destination only; LODS uses source only.
  Unused indices and accumulator/count registers are neither validated nor rewritten. Zero repeat
  count accesses no memory and preserves registers/flags, including upper alias bits.
- Byte/word/dword/qword elements; no prefix, F3 and F2; DF increment/decrement. CMPS subtracts
  source minus destination, SCAS accumulator minus destination, with all six defined arithmetic flags.
  Repetition tests the newly produced ZF, not incoming ZF. Non-comparison repetition ignores ZF.
- Address-size aliases: AMD64 RSI/RDI/RCX or ESI/EDI/ECX (zero-extending actual updates); i386
  ESI/EDI/ECX or SI/DI/CX (preserving upper halves and wrapping at 16 bits). `0x67` decoding is
  newly enabled only for i386 string instructions; explicit 16-bit ModRM addressing remains unsupported.
- Source FS/AMD64 GS overrides affect only source operands, after address-size truncation. Destination
  remains ES/flat. INS/OUTS have no implementation in this decoder and remain explicitly unsupported;
  no fabricated port I/O was added.
- Access checks cover the whole element with the actual read/write permission before committing a
  store or iteration's register changes. A fault leaves the string IP and remaining count/indices at
  the faulting iteration. Restart does not replay completed elements. String qword stores preflight
  all eight bytes rather than exposing the general helper's split-dword partial store.
- REPE/REPNE CMPS/SCAS faults retain the invocation's pre-instruction EFLAGS. Quantum suspension is
  different: it exposes the last completed comparison's flags. Transfer/resume, and cooperation without
  transfer, establish the appropriate resumed fault baseline. IP remains at the string until completion.

## Known-answer coverage

`tests/unit/strings.test.ts` + original CC0 `tests/fixtures/c/strings_harness.h` build **540 independent
synthetic encoding snippets** into PE containers, lift them with the real tool, and execute both generated
and decoded paths. **20 focused tests / 5,438 execution cases**, plus four unsupported-I/O decode
checks, pass. (An earlier progress message overstated the total; this is the corrected sum of the
actual loop dimensions, counting each fault/restart scenario once rather than each reentry.) The central matrix alone checks **840 execution cases**:
5 operations × 7 width/architecture combinations × 2 address sizes × 3 repeat choices × 2 DF choices ×
2 execution modes. Expectations are independent register/memory/flag results, not two paths agreeing
with the same core. All 16 GPRs are checked there, including unused high-pointer sentinels.

Additional cases cover incoming-ZF independence, first-stop/count-exhaustion, an eleven-qword zero fill
with high unused RSI, count zero with invalid actual operands, 16/32-bit index wrap, source segment
selection, source/destination faults in either DF direction, first-iteration/non-REP faults, read-only
and execute-only protection, overlap propagation, cross-page qword writes, fault/repair/restart, and
F3/F2 quantum transfer → resume → fault. wasm's signed i64 export representation is normalized to
unsigned bits before exact register assertions; expectations are not relaxed.

## Fresh independent validation

Two genuine fresh sessions ran via `tools/harness/pi/run-pi.sh`, with `PI_BRIDGE=0`, scratch outputs under
`/tmp/lane-K5a/`; no repository edits by reviewers.

1. Initial review found that comparison quantum suspension incorrectly exposed pre-instruction flags.
   Fixed before the implementation commit, with explicit F3/F2 transfer/resume/fault regressions. Initial
   verdict and reproducer remain in scratch; not represented as a pass.
2. Fresh recheck independently passed that original native C semantic probe and an additional **224-case**
   CMPS/SCAS continuation matrix: both operations, F3/F2, all supported widths/address sizes, DF, transfer
   and no-transfer, another completed comparison followed by fault/repair/restart. **No concrete remaining
   in-scope implementation bug found.** `recheck-verdict.md` fingerprints the reviewed implementation.

These are actual semantic-helper runs with synthetic RAM/cooperation/fault hooks on the host, not native
x86 hardware, Windows SEH, generated-code/browser execution, or a certification of real task switching
inside REP. The developer's focused wasm/generated tests and broad gates are separate evidence.

## Final gates

Logs: `/tmp/lane-K5a/`. All implementation gates ran on the source committed in `c14606f`; the
following final commit adds this ledger only.

| Gate | Final evidence |
|---|---|
| `npm run doctor` | ready (`doctor-confirm.log`) |
| `npm run lint` | ESLint, real GCC and **24/24** example check-builds pass (`lint-confirm.log`) |
| `npm run typecheck` | pass (`typecheck-confirm.log`) |
| Focused string tests | **20/20** pass (`strings-final.log`) |
| `npm test` | **545 tests / 47 files passed**, zero skips/failures (`test-final.log`) |
| `npm run test:e2e` | **200 passed / 51 existing intentional skips / 0 failures / 0 flaky**, both actual GPU backends exercised, own port **5205** (`e2e-serial.log`) |
| Explicit pipeline oracles | **20/20 × 300 = 6,000 identical frame pairs**, error null, exit 0, lifted `interp_insns=0`, empty stubs (`oracle-status.txt`, `oracle-*.log`) |
| `npm run leakcheck` | **444 committable files** clean (`leak-final.log`) |

Oracle inventory: win32-conformance, win32-hello, x64-audio, x64-basics, x64-contracts, x64-cpp,
x64-cpprt, x64-crt, x64-gl, x64-gui, x64-handles, x64-input, x64-memory, x64-scale, x64-smoke,
x64-sysdlls, x64-threads, x64-tls, x86-handles, x86-threads. Commands were
`npm run oracle -- examples/<id> 300` for each. Four native BGT examples have no guest oracle;
their real build/browser coverage remains, not a fabricated differential self-comparison.

An initial concurrent browser/oracle run had **199 passes / 1 failure**: oracle publication temporarily
removed `x64-crt/manifest.json` during the WebGPU test, producing a missing-manifest/HTTP-200 SPA
response before guest startup. This was not concealed or reclassified as a pass. All oracles finished,
then the **entire** unchanged browser suite was rerun without concurrent build/publication and passed
as above. Preserve this sequencing for verification in the same clone.

No ENOSPC occurred. Heavy commands used the shared npm/npx gate; no lane-specific slot bypass.
The operator increased the machine-wide slot count during contention. Initial queued invocations,
the reviewer's cancelled global-setup attempt, and an early signed-i64 test-expectation failure are
not counted as final successful checks. Synthetic per-snippet build directories are removed in
`finally`; native scratch probe executables were removed after review. Small scratch sources/logs
and the normal reusable example/object caches remain outside tracked source.

## Remaining boundaries / integration

- Resume the porter against this commit and replay the actual startup and long oracle; clearing this
  generic CPU defect is not evidence that the next game startup path or rendering succeeds.
- Real fault delivery still uses the kit's explicit abort path, not Windows page-fault/SEH dispatch.
  Tests repair protection and reenter the saved CPU state to validate architectural restart.
- Preserve whole-CPU scheduler copies, protection metadata and the narrow i386 helper arguments when
  merging. No new CPU layout or scheduler API is required.
- Explicit 16-bit ModRM addressing, INS/OUTS port I/O, and broader unsupported segment/mode contracts
  remain outside this delivery; unsupported instructions must keep failing visibly.
