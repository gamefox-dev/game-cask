# K44 checkpoint — unaligned savestate GPU replay

**Status:** WIP only, not accepted. Branch lane/K44, base 1140235. No push. No game files or installs used. Existing K42/K43 scratch roots were not touched or deleted.

## Root cause

BGTSTATE v2 imports raw Uint8Array blobs by retaining a view into the caller's transport chunk when the blob fits in one chunk. A stream reader may return a body beginning at byte offset 1, 2, or 3. Replay then passes that view to the WebGL2 typed upload view in WebGL2Commands.view(): Float32/Int32/Uint32/Uint16 construction requires the backing offset to meet element alignment. The failure therefore appears at replay (not ordinary command decoding, which owns a byte-copy at offset zero). DataView sites do not have this restriction.

The binary header remains version 2: no record/header layout changed. Existing version/header rejection remains in bgt/runtime/savestate-file.ts; old and unknown versions are still rejected cleanly. A format bump is required if the layout is later changed instead of copying.

## WIP changes

- bgt/runtime/savestate-file.ts: imported blob8 values are copied to an offset-zero buffer when their transport view is not 4-byte aligned; blob32 remains assembled/alignment-checked before its Uint32 view.
- bgt/runtime/savestate-recording.ts: restoreCheckpointItems() normalizes every GPU upload Uint8Array whose offset is not 4-byte aligned. This covers in-memory caller-created unaligned records and imported records before WebGL replay, including Float32/Int32/Uint32/Uint16 consumers.
- tests/unit/savestate-file.test.ts and tests/unit/savestate-recording.test.ts: CC0 regressions for a one-byte transport split and an unaligned replay upload.
- tests/fixtures/c/savestate-gpu.c: adds odd 19-byte vertex, 3-byte index, and 15-byte uniform buffer payloads interleaved with a DEPTH32F float upload, while retaining the existing compaction/dependency fixture.
- tests/e2e/savestate-compaction.spec.ts: imported replay path deliberately splits a blob header/body so the body starts at offset 23, then exercises the existing 300-update compaction and repeated restore loop.

## Typed-view audit (next session should re-check)

Relevant savestate/replay paths:

- savestate-file.ts blob32 Uint32 view: safe only because assembly uses an offset-zero allocation for unaligned/multi-chunk data; verify with the focused codec test.
- savestate-clone.ts Uint8/Uint32 alias-preserving clone: intentionally preserves offsets; imported blob32 must be aligned and replay upload normalization handles Uint8 data.
- savestate-gpu.ts uses DataView for float/half readback checks; arbitrary offsets are legal.
- WebGL2 gpu.ts view() creates Uint16/Float32/Uint32/Int32 views. It is production renderer code and was not changed; all test-only checkpoint/replay item data is normalized before it reaches this site. Other typed arrays in that file are newly allocated or native mapped/readback buffers with aligned offsets.
- WebGPU depth upload uses DataView for incoming bytes; mapped/native buffers are aligned. The remaining Float32/Uint32 constructions are newly allocated/mapped buffers.
- Float64 codec tags use newly allocated 8-byte buffers/DataView. No untrusted Float64 typed view remains in checkpoint import/replay.

## Gate state

- Focused unit command passed: npx vitest run tests/unit/savestate-file.test.ts tests/unit/savestate-recording.test.ts --maxWorkers=1 — 2 files, 7 tests.
- A first browser attempt did not run: used project name webgl2 (actual names are chromium-webgl2, chromium-webgpu, chromium-auto) and reported the shared heavy-slot lock. No browser result is claimed.
- Doctor, lint, typecheck, full units, focused browser matrix, full E2E matrices, leakcheck, and pipeline oracles have not been rerun for this WIP. Existing K43 gates apply only to the parent source, not this delta.

## Exact next steps

1. Read only the changed ranges and this handoff.
2. Compile/run the new fixture via the compaction spec using project names chromium-webgl2 and chromium-webgpu, both suspension modes, with BGT_E2E_PORT set; confirm the pre-fix reproducer would fail on an intentionally unaligned imported body (the focused codec/recording tests encode that pre/post proof).
3. Fix any fixture/API validation issue, then run focused savestate units and the full savestate E2E set. Exercise many restore/compaction cycles and both in-memory and intentionally fragmented import paths.
4. Re-audit all typed-array constructors listed above, typecheck/lint, then run the requested Tier 1 gates serially with generated outputs pruned between suites. Write final docs/handoff/K44.md only after actual evidence and commit the finished change.
