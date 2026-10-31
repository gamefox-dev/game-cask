# FIX1 — GCC guard-displacement repair

Kit-development change on `integration/p1`; source-built CC0 fixtures only. No game inputs, web fetches,
system installs, pushes or relaxed tests. Environment: macOS/Apple M4, Node 24.19.0, Zig 0.13.0,
Homebrew GCC 14.2.0, Playwright 1.64.1. Ubuntu CI itself was not run locally.

## Changes and semantic audit

- Both disp32 branches in `l64_span_add` explicitly produce `int64_t`. The normalized no-base uint32
  address branch first casts to `uint32_t`, then to `int64_t`; ordinary negative displacements sign-extend.
  The imm64 branch is unchanged. This fixes wrong guard offsets, not merely a warning.
- The host-tool source inventory is `tools/x86/x86tool.c` plus `platforms/x86/x86_decode.c`.
  The initial exact-flags GCC build failed on the reported conditional-expression signedness error.
  After repair it succeeds, revealing **no additional GCC C warnings**. Existing subprocess clang
  deployment-target and linker duplicate-rpath warnings are toolchain diagnostics, not suppressed here.
- `x86tool()` now hashes `lift64_guard.h` and `platforms/x86/x86.h`, completing its current project-header
  dependency closure; otherwise a cached pre-fix executable could hide this header-only change.
- `npm run lint` also builds host tools using real GCC when found on PATH, including versioned Homebrew
  names. Apple clang's `gcc` alias is rejected. No GCC means a silent skip; a compiler failure propagates.
  Scratch output is removed on success and failure. Unit tests exercise discovery, skip, flags and cleanup.

## Before/after regression

`npx vitest run tests/unit/codegen.test.ts -t 'negative RBP'` before repair:

```text
FAIL negative RBP displacements stay in signed guarded spans without reference fallback
AssertionError: expected 1 to be +0
```

After repair, the same regression passes: **zero fallback blocks**, identical complete CPU/RAM snapshots
against interpretation, and the expected stored uint64 `0x1122334455667789` at address `0x2000`.
The test sets RBP in a preceding block, then stores, loads and increments `[RBP-8]` in a guarded block.
It also asserts emitted offset `0xfffffffffffffff8`, not `0xfffffff8`. Two additional tests distinguish
signed no-base absolute SIB disp32 from zero-extended normalized RIP-relative addressing and compare fault CPU state.

## Final gates

| Command | Result |
|---|---|
| `npm run doctor` | ready |
| `/opt/homebrew/bin/gcc-14 -std=c11 -O2 -Wall -Wextra -Werror -o <scratch>/x86tool tools/x86/x86tool.c platforms/x86/x86_decode.c` | pass |
| `npm run lint` | pass: ESLint, real GCC, every example check-build |
| `npm run typecheck` | pass |
| `npm test` | **242 passed / 29 files**, no skips |
| `npm run test:e2e` | **169 passed / 42 intentional backend/tour skips / 0 failures** |
| `npm run oracle -- examples/<id> 300` for all 15 pipeline examples | **15 identical / 4,500 frame pairs**, no errors/divergences |

Browser breakdown: WebGL 2 **83 passed / 20 skipped**, WebGPU **81 passed / 22 skipped**, auto **5 passed**.
The four native BGT examples have no lifted/interpreted oracle mode; lint/unit/browser suites cover them.
The oracle IDs are win32-conformance, win32-hello, x64-audio, x64-basics, x64-cpp, x64-cpprt, x64-crt,
x64-gl, x64-gui, x64-input, x64-memory, x64-smoke, x64-threads, x64-tls and x86-threads.
Both pre-fix and post-fix 300-frame oracle runs passed. Every final trace hash remains unchanged.
All lifted `interp_insns` remain zero; generic shared-semantics execution is a separate counter below.

One initial browser run failed loading the native gpu-scenes manifest during the independent reviewer's
concurrent example rebuild. After that session finished, the entire browser suite passed serially.
No retry/tolerance/assertion changes were made. Run build-heavy gates serially against these shared outputs.

## Lifted-output and metric changes

Exactly **449 guard lines across 11 AMD64 example modules** change: corrected signed offsets and, where
applicable, merged negative/positive spans. No other generated-C lines change. Function/instruction counts,
flags-elided counts, generated/handwritten LOC, overrides, data seeds and unresolved-jump counts are unchanged.
Whole-wasm sizes decrease by **1,632 bytes total**:

| Example | Changed guard lines | Wasm bytes before → after | Gzip download byte delta |
|---|---:|---:|---:|
| x64-audio | 5 | 709882 → 709815 | -17 |
| x64-cpp | 46 | 2211024 → 2210997 | -46 |
| x64-cpprt | 340 | 6182155 → 6181327 | -337 |
| x64-crt | 18 | 917192 → 917038 | -119 |
| x64-gl | 5 | 723668 → 723597 | -33 |
| x64-gui | 4 | 681520 → 681458 | -20 |
| x64-input | 4 | 689110 → 689048 | -9 |
| x64-memory | 4 | 679441 → 679379 | -6 |
| x64-smoke | 5 | 778840 → 778772 | -12 |
| x64-threads | 14 | 720723 → 720554 | -29 |
| x64-tls | 4 | 692220 → 692158 | -9 |

Raw download byte reductions equal the wasm reductions in each row; gzip downloads shrink **637 bytes total**.
`wasm_bytes_per_insn` correspondingly decreases (unchanged instruction denominators); for example x64-cpprt
59.7419333 → 59.7339318 B/insn. The other four pipeline examples' lifted C and wasm are byte-identical.
Only these deterministic runtime metric fields change in the 300-frame reports:

| Example | `generic_insn_execs` before → after | `lifted_calls` before → after |
|---|---:|---:|
| x64-audio | 156014 → 156012 | 156769 → 156768 |
| x64-cpp | 370 → 229 | 2586 → 2574 |
| x64-cpprt | 8809 → 269 | 9948 → 8147 |
| x64-crt | 368 → 230 | 2025 → 2016 |
| x64-gl | 9 → 2 | unchanged |
| x64-smoke | 1451264 → 1451258 | unchanged |
| x64-threads | 374 → 3 | 3646 → 3582 |

Previously failing guards no longer force those unnecessary shared-semantics blocks and reentries.
No timing/RSS performance claim: build timings and cache residency vary across runs.

## Independent review and local evidence

A fresh pi session reviewed the diff, personally passed typecheck, all **13 focused tests / 2 files**, the
GCC lint step and an instrumented real GCC 14.2.0 compilation. It found no blocking code issue; its comment
clarification was applied. It inspected the author's pre-fix failure evidence, not a personal pre-fix execution.
The broad browser/oracle gates above completed afterward and are the author's runs, not delegated certification.

Private, locally excluded `.scratch-FIX1/` retains regression-before, codegen-after, no-base, gcc-final,
lint-final, typecheck-final, unit-final, e2e-final logs; oracle-before/after JSON and logs for all IDs;
lifted-diff-summary, manifest-changes and oracle-changes JSON; and the independent session/report.
Current oracle and browser artifacts also remain in ignored `reports/`. No private session transcript is committed.
