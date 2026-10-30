# v0.3 implementation work record

**Release status: partial development build (`0.3.0-dev.1`), not the complete requested v0.3 kit.**

## Commit/gate caveat

The Stage 4 and Stage 5 gate commands passed against a working tree containing the new Win32 file API implementation,
but `platforms/win32/w32_kernel.c` was inadvertently omitted from those commits. Those historical commits are **not**
independently green/self-contained; the finishing follow-up includes that implementation and reruns every gate.
History was not rewritten. Review the final HEAD, not Stage 4/5 in isolation. This is a deviation from the requested
per-stage-commit gate discipline, not an external/environmental block.

The finished branch remains incomplete: x64 execution, the general GPU/GL layer, scheduler/COM/audio/input profile
growth and minimum-image packaging were not delivered. They are recorded as missing below, not claimed blocked by
unavailable game files or a missing dependency. No per-engine workaround was introduced.

This is a kit-development record, not a game-port claim. No game inputs were accessed or fetched. All executable
fixtures are original CC0 C compiled by the installed Zig; nothing was executed as a native Windows executable.
The supplied queue/feasibility JSON was read as evidence only. Product/engine information does not select code paths.

## Final HEAD verification (macOS Apple M4, Chromium WebGPU/Metal and WebGL 2 software)

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

## Stage 2 — partial (scale infrastructure and static x64 facts, NOT x64 conversion)

Implemented: read-only file-backed native analysis (overlays not copied into the analyzer heap); streamed CLI output;
`analyze --metadata` parses PE32+ full-width base/imports and .pdata/.xdata record headers/codes. An original x64
integer/SSE fixture built by Zig verifies the parser. Fixture builds accept `target: x86_64-windows-gnu`; they use
-fno-lto because Zig 0.13's LTO link dropped the fixture's unwind table (confirmed by inspecting emitted assembly).
The pipeline refuses x64 with a concrete kit-gap error rather than truncating pointers into the i386 profile.

Compilation uses parallel content-addressed objects (`BGT_BUILD_JOBS`, default 2, capped 8), invalidated by source,
all relevant headers, flags, path and compiler version. A conservative local flag-liveness optimization exists behind
`pipeline.flagLiveness: true`. It is **not enabled by default** because the measured fixture got larger, not smaller.
Register locals, flat guest mapping, coverage-guided lifting and lazy wasm chunks are not yet implemented here.

`node tools/bench/lift-scale.mjs 1024`: original CC0 fixture, 1024 generated functions + entry, 34,841 lifted
instructions. Same build toolchain with flag elision off → on: wasm 780,183 → 788,395 B; interpreter 243,264 B;
marginal 15.4106 → 15.6463 B/insn. Build 28.837 s → 9.533 s (shared objects warm, so NOT a pure optimization timing
comparison); warm rebuild 5.154 s, 0 compiled/12 cached objects. Largest child RSS 303,136,768 B. This is NOT aggregate
concurrent memory and excludes wasm-opt. No 7.2M-instruction/iPhone scale claim; no evidence yet that lazy chunks are
necessary or sufficient. Reports are reproducible with the script, saved privately to reports/scale.json.

Missing: REX/16-GPR/RIP-relative decoder and shared 64-bit semantics, SSE/SSE2/x87 execution, CPUID, PE32+ rebased
loader, Win64 thunks/callbacks, TEB/TLS, CRT, SEH/C++ exception/longjmp machinery. The base runtime's uint32 CPU/memory
model cannot safely stand in for these; this stage is incomplete, not an environment-blocked success.

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
and CRT FILE streaming. Existing TLS/interlocked/QPC remain the prior single-thread model. Supporting multiple
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
