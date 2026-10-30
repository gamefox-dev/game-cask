# v0.3 implementation work record

This is a kit-development record, not a game-port claim. No game inputs were accessed or fetched. All executable
fixtures are original CC0 C compiled by the installed Zig; nothing was executed as a native Windows executable.
The supplied queue/feasibility JSON was read as evidence only. Product/engine information does not select code paths.

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

## Stage 3 — pending

GPU buffer/shader/pipeline commands and WGL/OpenGL are not implemented at this checkpoint.

## Stage 4 — pending

Cooperative threads, streaming file imports, WASAPI/COM and expanded device APIs are not implemented at this checkpoint.

## Stage 5 — pending

The launcher's slice definition exists. Runtime coverage-based code/data packaging does not yet exist.
