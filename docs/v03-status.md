# v0.3 implementation work record

**Task 2a (real-program Win64 CRT + demand-grown memory): COMPLETE at the fixture finish line.**
Shared table-driven CRT: **396 function names**, normal -O2 C/STL fixtures matching the same source compiled natively,
**300-frame identical oracles**, zero interpretation/stubs. The 2048 MiB window fixture touches **600 MiB** and checks
153600 pages plus the upper window edge. Import census and untruncated missing-import regression pass. Evidence and
explicit compatibility limits: [verification.md](verification.md) and [pipeline.md](pipeline.md#task-2a--shared-win64-crt-and-demand-grown-memory).
These console conformance fixtures do not make a game-playability or arbitrary Windows-compatibility claim.

**Task 1 (AMD64 execution core): COMPLETE at the fixture finish line.** The overall v0.3 branch is still a development
build (`0.3.0-dev.1`): general GPU/GL, scheduling and other previously listed tasks were outside this one-task follow-up.

## Task 1 finish-line evidence

- Four original CC0 `x86_64-windows-gnu` fixtures: `x64-basics`, `x64-cpp`, `x64-tls`, `x64-gui`.
- `tests/unit/x64.test.ts`: each prints its known PASS result, has **interp_insns=0 through CRT startup and 300 frames**,
  and compares an independently built interpreter-only module for **300 frames: identical, no errors**.
- `tests/e2e/x64.spec.ts`: all four pass on **WebGL 2 and WebGPU** (8 cases); GDI window/key/pointer changes are asserted
  by pixels and logs. C++ explicitly asserts caught=38/destructors=3/order=321, plus rethrow=6/destructors=3/order=345.
- `tests/unit/x64-semantics.test.ts`: eight independent encoding/result tests cover GPR/address/flag/LOCK/string and
  SSE/SSE2 families, full-width values, scalar lanes, saturation/shuffle/conversion/NaN comparison and CPUID masks.
  The TLS fixture additionally calls RtlVirtualUnwind on hand-checked prolog/allocation/save/epilog records.
- Pipeline metrics and command reproduction: Stage 2 section below; `node tools/bench/x64-metrics.mjs` writes private
  reports/x64-fixtures.json. No additional dependency or ABI revision, no game input/source/engine path.
- Final required gates: **90 unit tests/16 files; 75 browser passes/4 existing skips** (WebGL2 35 pass/2 skip, WebGPU
  35 pass/2 skip, auto 5 pass); doctor ready, lint/typecheck clean, 600-frame i386 hello oracle identical/no errors,
  leakcheck **198 committable files**. Four explicit `npm run oracle -- examples/x64-* 300` commands also passed.
  CI code remains Linux-compatible (POSIX compiler/Python, WebGPU optional); actual Ubuntu/remote CI not run here.

The older Stage 4/5 commit caveat below describes prior history only. This Task 1 change is committed atomically with
all modified sources and tests after the gates; no prior history was rewritten. Screenshot x64-gui-input.png was
visually reviewed: legible text, dark background, green square moved by two inputs, no clipping/artifact observed.

## Commit/gate caveat

The Stage 4 and Stage 5 gate commands passed against a working tree containing the new Win32 file API implementation,
but `platforms/win32/w32_kernel.c` was inadvertently omitted from those commits. Those historical commits are **not**
independently green/self-contained; the finishing follow-up includes that implementation and reruns every gate.
History was not rewritten. Review the final HEAD, not Stage 4/5 in isolation. This is a deviation from the requested
per-stage-commit gate discipline, not an external/environmental block.

The previous iteration left x64 execution, the general GPU/GL layer, scheduler/COM/audio/input profile
growth and minimum-image packaging unfinished. Task 1 now delivers the x64 core at its fixture finish line;
the remaining unrelated tasks are not claimed complete. They are recorded as missing below, not claimed blocked by
unavailable game files or a missing dependency. No per-engine workaround was introduced.

This is a kit-development record, not a game-port claim. No game inputs were accessed or fetched. All executable
fixtures are original CC0 C compiled by the installed Zig; nothing was executed as a native Windows executable.
The supplied queue/feasibility JSON was read as evidence only. Product/engine information does not select code paths.

## Previous iteration verification (historical; before Task 1)

Required final run: doctor ready; lint 0 errors; typecheck 0 errors; **78 unit tests / 14 files passed**;
**67 browser tests passed, 4 existing skips** (WebGL2 31+2 skips; WebGPU 31+2 skips; auto 5);
600-frame hello oracle identical, no errors; leakcheck 178 committable files. No remote/Ubuntu run was possible here;
CI remains POSIX host compiler/Python/Chromium, with WebGPU optional and no macOS harness dependency. Physical iPhone,
Safari/Firefox and independent-agent validation were not performed.

Largest generated scale fixture: 1024 generated functions + entry, 34,841 instructions, 529,243 B source. Final
same-toolchain flag-liveness off→on: wasm 795,401→803,613 B; interpreter 249,442 B; **marginal 15.6700→15.9057 B/insn**
(a regression, so optimization is opt-in). Warm times 5.640→5.133 s, repeat 5.173 s; 0 compiled/12 cached objects.
Earlier cold-ish Stage 2 measurement compiled two objects in 28.837 s, largest child RSS 303,136,768 B; not the same
cache state or final runtime, so do not call the time difference a codegen speedup. Peak child != aggregate/wasm-opt.
The small hello reference's marginal 66.36→65.86 B/insn is not evidence of 7.2M-instruction feasibility.

Final sliced hello package: 327,687 raw / 84,925 per-file-gzip payload B; wasm 294,963 B; no original file chunks;
two covered functions. Its **2,010-step idle fixture run**, before intentionally opening an omitted dialog, has zero
errors/outside events. WebGL2 load→first frame 31.115 ms, render avg/p95 0.04686/0.060 ms; WebGPU 39.445 ms,
0.05115/0.140 ms (2012 render samples each, including extra renders). These are render-completion wall times, not
GPU timestamps or vsync intervals, and are not a real-game L3 or device performance claim.

No new dependencies. Existing boot assertion changed only the exact ABI string 0.2→0.3; ABI-layout assertions were
extended, never weakened. The implementation is not release-complete; use this file's missing-work list first.

## Stage 1 — harness and Phase 0

Implemented:
- AGENTS entry point, shared skills symlink, portable trial setup and launcher-selected L3 slice contract.
- pi print/TUI driver and parameterized optional macOS sandbox wrapper; stdlib-only session/PTY helpers.
- Q8 prefixes (escaped ampersands, mnemonic underline, SS_NOPREFIX/DT_NOPREFIX), Q9 round radios, N4 tick marks,
  Q10 template separators, Q11 disjoint window-DC visible regions (fills, blits, text, pens, DIBs, GetPixel).
- Q16 original CC0 substitute bitmap family with descenders, scaled height/regular-bold metrics shared by text APIs,
  DLU from dialog font. Provenance: `platforms/common/FONT-PROVENANCE.md`.
- Q17 modal ShellAboutW/A; Q18 virtual-clock subframe Sleep/MsgWait timeouts; Q25 program-only gdi_ops + chrome_ops.
- N1 modal MessageBox icon glyphs/default button; N2 child WS_BORDER/client inset; N3 styled dialog close/help buttons.
- exstyle alongside class/style/rect in debug UI/tour/probe; visual checklist updated.
- Streaming inventory SHA-256, whole-file printable runs, explicit entropy sample scope, random-access PE32+ imports
  with virtual-span mapping, bounded directories and parse errors. Section container signatures are inspection facts.
- Analyzer's arbitrary 64 MiB input cap removed (PE file offsets still u32); extraction fixes virtual-span mapping and
  reports malformed/unsupported input without traceback. Leakcheck ignores low-entropy sample windows but still checks
  whole-file equality, and safely handles internal skill symlinks.

Verification: `phase0-tools.test.ts` (7 tests incl. real x64 inspection fixture, 257 MiB streaming input, actual
remote-free setup/npm ci, local fake pi session); `phase0.spec.ts` (two tests on each renderer); `chrome-styles.spec.ts`
(separator layout and close/help caption pixels/input on each renderer). Existing assertions unchanged. At this
checkpoint: 63 unit passes, 59 e2e passes/4 existing skips. All required gates are run before the stage commit.

Remaining Stage 1 qualifications (not silently counted as exact Windows fidelity):
- The substitute font is not pixel-identical to Windows; no arbitrary installed faces/kerning/italic/non-ASCII.
- ShellAbout does not draw a supplied HICON. MessageBox icons are substitute artwork; no system sound.
- Caption buttons are implemented for dialogs; the existing full-surface main-window model has no non-client frame.
- Cooperative object waits are not yet implemented: MsgWait with nCount>0 returns WAIT_FAILED with a log.
- Visible-region complexity has an explicit 1024-rectangle guard; arbitrary GDI region algebra is not implemented.
- Seatbelt is not a read allowlist/network sandbox; no real provider-driven unattended trial or nested sandbox test.
- Inventory entropy is explicitly a head sample, not per-section sampling. `--strings` still reads a complete file.

## Stage 2 — execution core complete (Task 1); large-target optimization remains separate

The shared decoder handles REX/16 GPRs/32–64-bit address sizes/RIP-relative/GS and baseline SSE/SSE2. Integer and SIMD
semantics are shared by the interpreter and predecoded labelled-C lifter. LOCK operations are single-threaded. CPUID
reports only baseline implemented features; no AVX/AES/BMI/XSAVE dispatch. CRT FNINIT is supported; general x87
arithmetic remains outside Task 1's finish line. The i386 CPU word width and classic tests are retained.

PE32+ images are rebased to a checked **1024 MiB default / 2048 MiB configurable flat guest window**, with on-demand
wasm memory growth, DIR64 relocations/eight-byte imports and
16–64 MiB image space. GS TEB/PEB, static TLS templates/zero fill/callbacks and pointer-width dynamic TLS work for the
fixture. Win64 home/register/stack arguments, callbacks and native USER structure/message/window-long-pointer
layouts share the Win32 GDI/USER APIs. Pointers remain u64; unsupported high virtual addresses fault, not truncate.
AMD64 defaults to compact loader + streamed original-module view; large overlays are not eagerly mapped.

RtlLookupFunctionEntry/RtlVirtualUnwind/RtlUnwindEx/RaiseException walk .pdata/.xdata and call compiled guest
`__gxx_personality_seh0`/libunwind/libc++abi handlers and compiler landing pads. C++ exception/destructor/rethrow logic
is not replaced by the profile. setjmp/longjmp restore nonvolatile GPR/XMM/IP/stack state through a guest transfer
boundary. MinGW CRT and C++ static constructor execute in guest code. Unknown APIs/instructions fail explicitly.

Task 1 metrics (macOS Apple M4, installed Zig 0.13.0, total final wasm including profile/Asyncify):

| fixture | functions | instructions | wasm bytes | wasm B/insn | warm build ms |
|---|---:|---:|---:|---:|---:|
| x64-basics | 7 | 164 | 301573 | 1838.86 | 216.018 |
| x64-cpp | 615 | 31488 | 3119752 | 99.08 | 409.557 |
| x64-tls | 81 | 1933 | 462671 | 239.35 | 247.383 |
| x64-gui | 77 | 1667 | 438472 | 263.03 | 244.854 |

All four measurements used **0 compiled/15 cached objects and an Asyncify cache hit**. They are not cold build times.
The largest fixture is the genuinely linked C++ runtime (~31k decoded instructions), not a 7.2M-instruction feasibility
claim. Instruction count includes cold code; generic_insn_execs counts shared-semantic execution within lifted C,
while interp_insns is zero. Indirect targets still unresolved statically are reported honestly (including the assembly
jump table); they resolve to lifted range labels at runtime, not an interpreter loop. Profile fixed cost dominates
small-fixture byte/insn values.

Builds remain parallel/incremental per object. A postprocess cache now hashes linked wasm, wasm-opt and pass/feature
identity, and publishes atomically; `asyncify_cached` records hits. This fixes the slice tests spending their existing
timeout rebuilding identical postprocessed modules, without weakening assertions or increasing timeouts. Conservative
flag-liveness remains opt-in because the prior scale fixture regressed. No register-local/7.2M-scale speedup claimed.

Remaining real-world compatibility: AVX/newer extensions, x87 arithmetic, precise FP trap/FTZ/DAZ/nondefault arithmetic
rounding, wider flat memory, multiple threads, dynamic unwind table registration, MSVC C++ personalities/foreign
exception edge cases, and the rest of the Win32/CRT API surface. MinGW-target here means the installed Zig target and
its linked compiler runtime, not proof across every GCC/MSVC release. See docs/pipeline.md for the exact contract.

## Stage 3 — partial (additive ABI requests and readback, NOT the general GPU/GL layer)

ABI version 0x000300, frozen old IO/commands retained; gpu_limits reports backend limits; v0.3 textures may use those
limits within the old byte budget. CAP_READBACK + batched READBACK op captures target/screen bytes in command order.
Bounded request_status/read/close exposes results only across update/yield boundaries. WebGPU stages/maps; WebGL 2
uses glReadPixels internally (synchronous implementation, deferred ABI result). Original CC0 gpu-readback fixture
asserts before/after capture ordering, top/bottom colours, screen sample and completion after yield on both backends.
A deliberately v0.2-exporting fixture verifies backward loading. ABI.md §12 specifies every implemented addition.

Missing: general GPU buffers/layouts/shader modules, GLSL/WGSL translation/fallback, pipeline depth/stencil/cull,
multiple attachments, instancing/index/base vertex, mipmaps/formats/sampling and query results; WGL/OpenGL state tracker
and entry points, GL metrics and GL 3.3 fixture. This cannot be called the brief's GPU layer. No new dependencies.
The existing boot test's exact ABI string changes 0.2 → 0.3 solely for this additive version bump, not weaker coverage.

## Stage 4 — partial (streaming files and Win32 self-open; no scheduler/audio/COM growth)

Implemented: bounded-build file chunking, hash-verified lazy reads, 16 MiB LRU/in-flight coalescing, 64-bit asset size
and split-offset range request imports, delayed request completion across yield. Original module self-open is separate
from the compact loader image. Win32 read-only CreateFileA/W, ReadFile, GetFileSize(Ex), SetFilePointer(Ex), CloseHandle,
EOF/error paths are fixture-tested. The 8 MiB CC0 patterned data fixture reads across the 4 MiB boundary using just
two 64 KiB chunks (pattern varies per chunk to catch wrong seeks), not full-file preload. The same fixture self-opens
its executable and reads the original MZ/header and tail. Browser and oracle hold external I/O until the next virtual
frame, with a headless asynchronous stepping helper. Secure-context SHA-256 is required for streamed bytes.

Missing: CreateThread and a deterministic cooperative scheduler, WaitFor*/events/mutexes/semaphores/CS/SRW/conditions,
per-thread TLS, WASAPI/WinMM/DirectSound expansion, COM class registry, Raw Input/XInput/DirectInput, offline sockets
and CRT FILE streaming on i386. Task 2a adds Win64 CRT FILE streaming and a deterministic instruction-quantum yield,
not multiple guest threads. Existing TLS/interlocked/QPC remain the single-thread model. Supporting multiple
suspended guest stacks safely requires scheduler/CPU/callback work; the single Asyncify stack cannot simply be reused
as multiple threads. These are unfinished kit subsystems, not game-side override opportunities.

## Stage 5 — partial (functional coverage-guided selection and strict boundaries)

Implemented: function-entry instrumentation (lifted/interpreted kind bits), file-chunk coverage (eager and streamed),
probe/test snapshot persistence, hash/base-checked coverage merge and static call closure. `pipeline.coverage` selects
lifted functions with recorded interpreter fallback. Strict `--slice` / game.json slice adds an entry allowlist and
omits uncovered original/data chunks. Code/data misses pause with accessible 'outside this slice' state, not a trap or
404; the dependency is recorded. Tests prove boot→uncovered-dialog and boot→missing-self-read pause on both backends;
unit tests prove fallback interpretation, static closure, omitted files and identity rejection.

Build packaging measures raw/gzip payload, wasm and emitted unique file chunks; snapshots measure load→first frame,
render completion avg/p95, frames and errors/outside events. trial:record includes these when an identity-matching
reports/slice-runtime.json is supplied; absent runtime evidence remains null. Docs/skills state the exact workflow.

Not done: truly minimum loader-image data (virtual sections retained conservatively), basic-block/instruction
coverage, automatic union of multiple page reloads within one tour/probe (save/merge each instance's snapshot),
lazy wasm code chunks, performance at 7.2M insns, a long representative real-game stability run, hardware
mobile verification. A strict boundary requires reload with a broader build; guest stack is not resumed after the
missing-entry exception. Snapshot collection caps at 65,536 code addresses. No claim of a complete v0.3 slice system.
