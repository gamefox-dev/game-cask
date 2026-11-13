# K47 checkpoint - item 0 complete, before buffer semantics

Date: 2026-11-13 (fresh K47 session)  Branch: lane/K47  Base: 4951c3b

## Completed and committed in this checkpoint

- Read the K46 handoff, pipeline/profile documentation, WebGL2/WebGPU executors, and Win32 GL profile.
- Corrected the porter-found policy bug in web/src/main.ts: DEV and VITE_BGT_TEST still install the test API, but no longer force BGTRuntime({debug:true}). Strict native-query behavior now requires explicit ?debug=1.
- Added nativeQueryPolicy to diagnostics (production or strict, null for WebGPU) and per-frame WebGL query attribution under lastFrame.nativeSyncQueryOps (opcode plus frameEnd). Existing aggregate nativeSyncQueries remains unchanged.
- Added a unit assertion that the WebGL2 policy is explicit. Focused query unit result: 9/9 passed. Typecheck passed.
- Added CC0-only examples/x64-gl-orphan/ as a game-shaped workload source (40 passes, same-size and varying-size glBufferData, texture updates, framebuffer ping-pong). It is intentionally not yet a valid runtime measurement on this host because the profile's GPU capability gate rejects the current WebGL configuration.

## Measurements so far

The first runtime run used the generated CC0 fixture with Chromium ANGLE Metal. The installed WebGL2 reports MAX_UNIFORM_BLOCK_SIZE=16384, while the existing executable WebGL GPU gate requires 65536. The profile therefore correctly leaves CAP_GPU clear; legacy rendering ran, but the fixture's continuation submissions were rejected. This is a capability gate, not a reason to weaken it.

- WebGL2 runtime fixture, debug=0, same/varying: policy reported production; aggregate per-frame query count was getError=1, framebuffer checks 0, but measurement invalid due to GPU continuation rejection and non-red pixels ([58,79,107,255], 16,340,405 command errors in the long run).
- WebGL2 runtime fixture, debug=1, same/varying: the diagnostic policy unexpectedly still reported production. Cause is NOT localized yet; investigate URL handling/harness navigation before treating this as item-0 end-to-end evidence. The capability failure independently invalidates this GL timing run. Do not use it as a strict-vs-production result.
- WebGPU runtime fixture, debug=0 and debug=1, same/varying: red pixel [255,0,0,255], 40 draws/passes, 603 commands, 243 ABI submits, 18,248 command bytes/frame, zero command errors; native GL query counters are null. Three batches of 20 steps, CDP TaskDuration threadTicks (runtime main-thread CPU, not GPU-process CPU): debug=0 same-size mean 1.714 ms CPU/frame, 2.989 ms wall/frame; debug=0 varying-size mean 1.600 / 2.864 ms; debug=1 same-size 1.600 / 2.953 ms; debug=1 varying-size 1.607 / 3.015 ms. These are preliminary pre-optimization observations, NOT final evidence; F9 varying path still needs explicit size verification. The run's Playwright command exited 1 because it also covered the invalid WebGL cases.
- WebGL capability probe: ANGLE Metal Apple M4, MAX_TEXTURE_SIZE=16384, MAX_UNIFORM_BLOCK_SIZE=16384, required extensions present. Reviewer accepted separately labelled runtime SwiftShader/native renderer evidence and keeping the 65536 gate. Equal-size-only reuse is approved; varying-size polls remain an explicit follow-up boundary.

## Open items

1. Implement Win32 profile glBufferData equal-size live-store reuse: one accepted BUFFER_UPDATE, no delete/create; preserve exact guest size, contents, mapping reset, generated/TF rules, first-error ordering and synchronous submission/error behavior. Growth/shrink remains delete/create for this lane.
2. Add native CC0 conformance coverage for re-specification: same-size contents and size, mapping reset, failed update/error retention, transform-feedback-bound rejection, and counter split for reused versus size-changed live stores. Expose counters in diagnostics/metrics if useful.
3. Run the valid game-shaped fixture on the accepted capable runtime path. Capture per-op query attribution, framebuffer checks, submits, CPU/frame, and pixels for both backends. Report the varying-size boundary honestly.
4. Decide whether submit coalescing is justified by evidence; do not change it before semantic review. Existing send intentionally preserves synchronous profile acceptance and error ordering.
5. Run the full requested Tier 1 matrix, leakcheck, and 300-frame pipeline oracles; delete disposable build outputs between suites while retaining this scratch root.
6. Write final docs/handoff/K47.md with before/after and the capability limitation.

## Exact next commands

- Inspect this commit and run git status --short.
- Add the profile implementation/tests first; ask the reviewer before any ABI or guest-visible semantic change.
- Focused validation: npm run typecheck, npx vitest run tests/unit/gpu-webgl2-queries.test.ts tests/unit/gl-frontend-memory.test.ts.
- Fix/verify the scratch measurement harness first: debug=1 unexpectedly reports production, and F9 needs size verification. Inspect browser location and request URL rather than inferring the cause. Then rebuild only the CC0 fixture and run labelled capable-runtime/standalone renderer measurements with BGT_E2E_PORT.
- Retained scripts and logs: /Users/dev/projects/pi-work/scratch-K47/perf/{playwright.config.ts,measure.spec.ts,cap.config.ts,cap.spec.ts}; baseline/{measure.log,measure2.log,cap.log,build.log,build2.log}. The measurement warmup now steps with setTimeout(20) between iterations so asynchronous WebGPU shader callbacks can finish. First measure.log WebGPU was black because setup had not finished; measure2.log WebGPU is red.
- Preserve reviewer decisions from this checkpoint: first bridge answer requires equal-size reuse only (no high-water capacity retention/doubling), counters reused vs size-changed with grew/shrank split, synchronous submission/error checks retained. Second answer accepts separately labelled runtime SwiftShader census + native Metal standalone CPU, capability gate unchanged, and varying-size queries as explicit remaining boundary.

## Suite state at checkpoint

No suites remain live. Recorded process IDs and outcomes:

- PID 94659: doctor/typecheck driver, finished; doctor/typecheck exit 0.
- PID 94867: CC0 fixture build driver, finished; build exit 0.
- PID 97807: first measurement driver, finished; Playwright exit 1 (invalid WebGL capability path).
- PID 98588: WebGL capability probe, finished; exit 0.
- PID 98774: second measurement driver, finished; Playwright exit 1 (same invalid WebGL path; WebGPU cases themselves rendered red).
- PID 99770: focused typecheck/query driver, finished; typecheck and query exits 0.

Free disk at checkpoint: approximately 13 GiB, above the 3 GiB requirement. Scratch root /Users/dev/projects/pi-work/scratch-K47/ was retained.
