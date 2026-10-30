# Lane F — native AMD64 codegen handoff

## Verdict / acceptance boundary

**Functional gates are green; the literal x64-crt 2× performance gate is NOT met. Do not mark Lane F complete
against that gate.** The CPU-heavy fixture meets both thresholds: whole wasm **4,268,957 → 880,331 B (4.85× smaller)**,
**128.14 → 26.43 B/instruction**, and median 300-frame execution **19.559 → 5.357 ms (3.65× faster)**.
`x64-crt` improves **1,142,858 → 735,581 B (1.55× smaller)**, **213.82 → 137.62 B/instruction**, and
**2.198 → 2.003 ms (1.10× faster)**, not 2×. No marginal-size substitution or idle-loop timing claim is used.

This is an explicit reduced delivery, not a claimed finish-line success. Several general approaches were measured
and rejected (smaller/larger regions, directly registering overlapping regions, alternate spill/fault outlining,
and forced memory-helper inlining). Some regressed size/time; direct-region registration also introduced interpreted
entries. Those experiments are not retained. Further x64-crt work needs better compact call/continuation and
checked-memory emission; fixed profile overhead also matters. Two reviewer-bridge questions about timing/scope
expired: no reviewer approved relaxing the literal whole-module gate. No platform/build ownership expansion was made.

## Implementation

- Specialized AMD64 integer ALU, aliases/zero extension, shifts, multiply, stack operations, effective addresses,
  CMOV/SET, branches/calls/returns, and common SSE/SSE2 move/logic/arithmetic emission. Unsupported families retain
  predecoded shared semantics, not per-game replacements.
- GPRs are C locals, with changed-register writeback at calls, exits and generic/quantum boundaries. XMM values use
  direct vector locals per operation; they are not claimed to be whole-function register-local allocated.
- Per-flag fixed-point liveness over local CFG successors. Generic instructions, external edges and observable
  faults are conservative barriers. Read-modify-write faults preserve newly computed flags. Guarded blocks may
  discard flags only when their whole-block memory check proves the native path cannot fault.
- Flat-memory span guards combine affine, unchanged-base accesses (including tracked stack deltas). Spans are at
  most 4096 bytes, so checking first/last mapped pages is sufficient. The native path then uses direct unaligned
  memcpy loads/stores. No raw pointer survives a call, growth, generic operation or yield.
- Failed guards, interior landing entries and precise quantum crossings return to registry-managed shared-semantic
  execution for a bounded instruction count. This path is counted as generic, not interpreted. It is a cold guard
  deoptimization, not an embedded guest interpreter loop. All instruction addresses remain valid resumptions.
- Generic/quantum boundaries return out of native local frames before a callback or suspension. Pending state is
  consumed/cleared before execution. Recursive calls to the same address are recognized as progress using TSC.
- Retained reference behavior includes implicit stack-address low-32-bit truncation, full-width explicit memory-EA
  validation, partial cross-page qword stores, and scalar read widths for prefixed SSE logical operations.
- Smaller shared flat-memory primitives and mapped SIMD memcpy accesses also reduce runtime overhead. The i386
  emitter/paged-memory behavior is unchanged; `win32-hello` remains the 32-bit regression/oracle case.
- No BGT ABI/layout changes, dependencies, system installs, game inputs or engine-specific paths.

## Reproduction and complete benchmark

```sh
BGT_CODEGEN_REPORT=/absolute/report.json \
  npx vitest run --config tools/bench/codegen.config.ts
```

See `tools/bench/README-codegen.md`. Both reports are committed as
[codegen-before.json](codegen-before.json) / [codegen-after.json](codegen-after.json).
Before was independently rerun in a temporary detached worktree of **dfce3a8e71868ac1fc15e71062dd8a5a5ea2f60b**
using the same benchmark files, shared installed dependencies/toolchain, and sequential execution. That worktree
was removed. After is this commit's source; its `base` field still names the parent because measurement preceded
commit. The first session's inherited measurements were inspected but are not the before values below.

macOS arm64 / Node 24.19.0 / Zig 0.13.0. Each row has a discarded fresh-instance warmup followed by five fresh-instance
samples of 300 update/render/consume frames, with the median reported. Compilation/instantiation/init are excluded;
guest startup executes in the updates. CPU fixture checksum is asserted as `00000009 a47a8001`. Runtime metrics,
all samples, logs and cache state are in the JSON. Whole wasm includes profile + Asyncify, not marginal code size.
Small programs are dominated partly by host/frame work; run times are not standalone CPU-cycle measurements.

| Program | Instructions | specialized/generic before → after | Whole wasm B/insn before → after | Build ms before → after | Run ms before → after |
|---|---:|---:|---:|---:|---:|
| codegen-cpu | 33314 | 0/33314 → 33314/0 | 128.14 → 26.43 | 7989.6 → 6297.2 | 19.559 → 5.357 |
| x64-basics | 164 | 0/164 → 140/24 | 3150.61 → 2444.51 | 752.2 → 290.0 | 1.722 → 1.252 |
| x64-cpp | 30873 | 0/30873 → 30571/302 | 126.59 → 65.74 | 7426.2 → 480.3 | 1.938 → 2.112 |
| x64-cpprt | 103481 | 0/103481 → 102234/1247 | 139.12 → 57.99 | 23514.8 → 699.5 | 3.636 → 2.582 |
| x64-crt | 5345 | 0/5345 → 5130/215 | 213.82 → 137.62 | 2870.4 → 340.3 | 2.198 → 2.003 |
| x64-gui | 1667 | 0/1667 → 1658/9 | 412.62 → 299.93 | 1048.6 → 319.5 | 1.516 → 1.284 |
| x64-memory | 1610 | 0/1610 → 1593/17 | 421.17 → 309.44 | 3474.2 → 325.2 | 1515.317 → 157.478 |
| x64-tls | 1933 | 0/1933 → 1914/19 | 371.39 → 263.86 | 1292.5 → 328.7 | 1.705 → 1.244 |
| win32-hello | 756 | 705/51 → 705/51 | 438.70 → 438.51 | 2585.5 → 312.5 | 2.203 → 2.351 |

**Build-time caveat:** before compiled 2/16 objects for most x64 fixtures, all 16 for CPU/memory, and all 17 for
hello. After compiled only 1/16 for CPU and 0/16 or 0/17 for the rest. All Asyncify postprocesses were cache hits.
Therefore these build times are reported, **not** claimed as compiler speedups. `x64-cpp` and hello do not show
execution improvement in this timing sample. No 7M-instruction feasibility or universal speedup claim.

## Final functional evidence

All following gates ran after the final semantic fixes (SSE prefix width and high-RSP implicit-stack fidelity):

- `npm run doctor`: ready (Node/deps/Zig/Chromium found).
- `npm run lint`: ESLint and all example check-builds green; `npm run typecheck`: green.
- `npm test`: **102 tests / 18 files passed**. Six new codegen tests compare full CPU bytes and 64 KiB RAM,
  not just API traces: exhaustive ALU masks, aliases/CFG/generic/quantum/interior entries, faults/partial stores,
  high RSP, prefixed SSE logic read widths, scalar/packed SSE.
- `npm run test:e2e`: **81 passed, 4 existing skips**. Includes both renderers, native CRT fixtures, C++ exceptions,
  TLS, and the 600 MiB / 2048 MiB-window memory fixture. No existing assertion/time limit was weakened.
- Eight explicit `npm run oracle -- examples/<id> 300` commands: **all identical; both errors null** for
  x64-basics, x64-cpp, x64-cpprt, x64-crt, x64-gui, x64-memory, x64-tls, and win32-hello.
- Benchmark: **1 test, 9 programs**, expected CPU checksum and zero interpreted instructions throughout.
- `npm run leakcheck`: **231 committable files checked**, green.

Logs are in `/Users/dev/projects/pi-work/scratch-F/{doctor,lint,typecheck,test,e2e,bench,leak}-final.log` and
`final-oracle-*.log`. No ENOSPC occurred in the resumed session; the temporary base worktree and large inherited
WAT/LLVM scratch dumps were removed. The previous interrupted files were readable and compiled; none was truncated.

## Independent review

A genuinely fresh session ran via `tools/harness/pi/run-pi.sh`. The first review timed out without a verdict;
its scratch probe exposed 22 CPU-snapshot mismatches when subsequently run by the implementer. Those were fixed
(SSE prefix width/high-RSP cases) and have committed regressions. A second fresh reviewer independently rebuilt
the lifter and reran **205 cases × 4 seeds: 0 mismatches**, plus an extension with
**226 cases × 4 seeds: 0 mismatches**.
The second reviewer found no remaining concrete bug in guard/span or native-boundary code. Its snapshot harness
substitutes dispatch helpers, so it explicitly did not claim end-to-end scheduler/callback validation and did not
approve the unmet x64-crt performance gate. Fresh-session output is in scratch-F/review-final.txt and its session log.

## Ownership and next work

Changed owned files: `tools/x86/lift64.h`, new `tools/x86/lift64_guard.h`; `platforms/x86/x86.h`, `x86_rt.c`,
`x86_simd.c`, new `x86_lift64.h`; own tests/fixture. Added the explicitly permitted `tools/bench/` benchmark/docs and
this requested handoff/evidence. **No existing file outside ownership changed; no LANE-F exceptions.**
`x86_sched.c`, `docs/v03-status.md`, `docs/verification.md`, build pipeline, ABI and Win32 profile were not edited.

Open acceptance issue **F-PERF-CRT**: achieve ≥2× whole-module B/insn reduction and ≥2× measured execution speed on
x64-crt versus dfce3a8 without changing fixture/reference semantics. Preserve the green correctness suite and report
host overhead/cache state. All current x64 fixtures are fully lifted; unresolved indirect-edge counts are retained
honestly and resolve through the registry rather than being relabeled as specialized jump-table resolution.
