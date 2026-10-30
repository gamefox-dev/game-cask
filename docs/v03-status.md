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

## Stage 2 — pending

x64 execution (decoder, shared semantics, Win64 thunks, PE rebasing/TLS/unwinding) is not implemented at this checkpoint.
There is no claim of 7.2M-instruction scale or C++ exception support.

## Stage 3 — pending

GPU buffer/shader/pipeline commands and WGL/OpenGL are not implemented at this checkpoint.

## Stage 4 — pending

Cooperative threads, streaming file imports, WASAPI/COM and expanded device APIs are not implemented at this checkpoint.

## Stage 5 — pending

The launcher's slice definition exists. Runtime coverage-based code/data packaging does not yet exist.
