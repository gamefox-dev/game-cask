# Lane S1 — ABI v0.3 GPU interface

## Delivered

Interface/validation complete; GPU execution intentionally remains unsupported in current browser backends.
No original game files, downloads, installs, dependencies or engine-specific handling. Existing request/readback/
streamed-range code and frozen v0.2 layouts remain intact. No status/verification document was edited.

- `bgt/abi/ABI.md` §13 is the normative contract: all 25 op layouts, errors, ordering, GLSL/WGSL binding/reflection,
  clip-space/ID conventions, shader log results, budgets, recovery and explicit exclusions.
- `bgt/include/bgt_gpu.h` (included by `bgt.h`): enums, portable limits, fixed-width structs and static assertions.
  `bgt_gpu_cmd.h` (included by `bgt_cmd.h`): every encoder, including variable inline pipeline/pass tails.
- `bgt/runtime/abi.ts`: GPU_OP 0x40..0x58, GPU enums, GPU_LAYOUT sizes, pipeline header field order, limits/offsets.
- `bgt/runtime/commands-gpu.ts`: persistent per-host GpuState and complete semantic validation, CPU index shadows,
  source/upload snapshots, safe ranges/base vertex/instance fetch, attachment/pass/binding validation.
  `commands.ts` integrates ordered GpuItems into the existing two-pass decoder and frame budgets.
- `bgt/renderers/types.ts`: GpuBackend (`languages`, `execute(item)`), owned GpuItem, and UNSUPPORTED_GPU.
  Both current renderers explicitly return UNSUPPORTED_GPU; no browser GPU implementation was added.
- Extended `gpu_limits` is opt-in at cap >=80; cap 16..79 retains the frozen 16-byte prefix and writes no tail.

## For WebGL 2 / WebGPU implementers

1. Implement `Renderer.gpu`, wire it through `HostConfig.gpuBackend` and CAP_GPU selection in runtime startup.
   Missing/zero-language implementation clears the bit. Native browser GPU availability alone is not CAP_GPU.
2. Consume GpuItems at their position in Frame.items, not during decoding. Flush 2D batches before GPU items;
   preserve the shared screen and legacy 2D state across passes. Honor resource generations in stream order.
3. Payload `words` include float bit patterns and ignored guest upload pointers. Use owned `data`/`source` instead.
   Shader compilation must eventually invoke complete(code, log), including device-loss/error paths. The decoder
   packages i32 compile status + UTF-8 log as an existing deferred request result. Failure still has readable text.
4. All specified formats and state are mandatory to advertise CAP_GPU. Driver extensions, emulation strategy,
   caches, reflection/parser/translation implementation and native resource allocation remain backend choices.
   Shader language bits are independent: advertise only languages actually supported. No implicit translator.
5. Native API errors after decode go to renderer diagnostics; compile errors always go through the request log.
   Retain descriptors/upload shadows for restoration. Stop rather than silently dropping unsupported live resources.

## For OpenGL 3.3 profile implementer

- Five GPU handle namespaces are separate from legacy TEX_* and from one another. GPU textures are 2D only.
- Rewrite legacy uniforms into std140 `bgt_uS` blocks, texture units into `bgt_tS` slots; pipeline masks declare
  required slots. GLSL330/ES300 and WGSL conventions are fully specified in §13.5.
- Translate GL depth [-w,w] to BGT [0,w], preserve BGT top-left sampling/fragment positions, and use portable ID
  expressions for base vertex / first instance. Do not rely directly on GL's native instance-ID semantics.
- End passes within each submit. No resource operations or legacy commands inside a pass. Incomplete passes close
  implicitly with E_STATE. Deleted shaders may not be referenced by a live pipeline.
- Wait/read/close shader requests before pipeline creation; errors include log text. Combined modules are WGSL only.
- Arrays/cubes, multisampling, depth uploads, arbitrary readback of GPU-namespace textures, geometry/compute shaders,
  primitive restart and packed/double vertex formats are explicitly excluded; do not silently reinterpret them.
  GPU screen output is compatible with the existing ordered screen READBACK command outside a GPU pass.

## Tests and evidence

Entry points:

- `npx vitest run tests/unit/abi-layout.test.ts tests/unit/gpu-commands.test.ts tests/unit/gpu-limits.test.ts`
- `tests/fixtures/c/gpu_probe.c`: every C struct member offset, enum/opcode/limit and all 25 C encoders versus TS.
- `gpu-commands.test.ts`: every valid opcode, malformed payloads, missing/duplicate handles, resource regions,
  state errors, indexed/base-vertex/instanced fetch, MRT/depth/mips/formats, copies/budgets, deferred shader logs.
- `gpu-limits.test.ts`: prefix negotiation, untouched tails, invalid pointers, unsupported capability and language mask.
- Unchanged `requests.test.ts`: explicitly v0.2 module still boots/updates/renders with no errors.

Final sequential run: all six required gates passed (`doctor`, `lint`, `typecheck`, `test`, `test:e2e`,
`leakcheck`). Unit suite: **164 passed / 19 files**. Browser suite: **81 passed, 4 existing skips** across
WebGL 2, WebGPU and auto selection, on lane port 5181. All eight required differential oracles passed at 300
frames each (2,400 compared frames): x64-basics, x64-cpp, x64-cpprt, x64-crt, x64-gui, x64-memory, x64-tls,
win32-hello. `git diff --check` also passed. Gates/oracles were run sequentially to avoid their shared fixture
build outputs racing. Logs are in the lane-local scratch directory `/Users/dev/projects/pi-work/scratch-S1/`
(`final2-*.log`, `final2-checks.exit`), not committed artifacts.

## Ownership / integration notes

Only exception outside the lane's interface/runtime/headers/tests ownership: `bgt/runtime/host.ts`, marked
`/* LANE-S1 */`. It negotiates the extended limits, gates per-host GPU state/capabilities, connects the existing
request allocator, and retains GPU frame budgets for queued init/update work. These hooks are necessary for the
interface to be observable/testable. Backend implementation-file edits are only the permitted unsupported return.
`docs/v03-status.md` and `docs/verification.md` are left for the reviewer, as required by lane rules.

Work stayed on the provided isolated `lane/S1` branch; no push. No independent validator session was available or
claimed; fresh-session review remains a reviewer gate. Browser evidence here proves unchanged existing rendering,
not GPU-layer pixels. No open wire-format choices; backend execution and the GL profile remain the parallel lanes'
work, not an incomplete interface deliverable.
