# 12,000 GL buffer/VAO pairs — CC0-1.0

Original synthetic Win64 CRT PE; no game bytes, overrides or BGT imports. Tests the engine-independent
GL3.3 profile under object-count pressure, not a native driver performance benchmark.

- 12,000 buffers with actual 32-byte vertex stores and 12,000 VAOs, all fetched by native draws.
- A new ordinary-uniform program links after the historical shared wire pool is full.
- Late red geometry, retained/deleted-name green geometry and orphaned/mapped blue geometry.
- High-handle transform-feedback capture/readback with range sentinels, and aligned uniform-block ranges.
- Three complete delete/re-gen/reupload cycles, maintaining exact final late-object pixels.
- 16MiB GPU reservation: first8MiB additional store fits, second fails with GL_OUT_OF_MEMORY;
  deleting the first allows recovery. Exactly one BUFFER_CREATE E_LIMIT is expected in transport
  diagnostics and one gl_objects buffer failure, not a native backend allocation or command-shape error.

Final screen: red left half, green next quarter, blue right quarter (opaque), black letterbox margins.
The browser test checks exact RGBA pixels and metrics on both actual native backends. The recording
unit expects ten GPU-dependent failures (eight pixels, two feedback readbacks) because its
adapter deliberately never rasterizes or executes shaders.

The differential oracle also uses this recorder and asserts the exact ten-failure census, counted
byte-OOM and recovery. Its reviewer-approved expected-error contract is restricted to this fixture:
exactly one BUFFER_CREATE E_LIMIT is required; zero, two or any other command error fails. Every
other pipeline fixture retains the global zero-command-error rule. Native recovery pixels remain
mandatory browser checks, never inferred from the recording oracle.

Demand-first recording probe: tests/native/gl_demand_cases.h originally ran at frozen1,023 and
raised16,383 test limits before architecture selection. The production test now measures24,000 live
buffers/stores and VAOs with no count override. gl_scale_cases.h checks churn, full GLuint names,
retained generations and real shared-host-arena exhaustion with atomic Gen output/recovery.

No claim of unrestricted GL3.3 conformance, physical hardware validation, title rendering or playability.
