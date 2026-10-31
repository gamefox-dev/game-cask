# Integration I1 — remaining lanes merged

## Result

On `integration/p1`, merged the local branches in the requested order with `git merge --no-ff` (using
`--no-commit` for review/resolution). No push, web fetch, game input, dependency/system install or test weakening.
All required functional checks are green. **F-PERF-CRT remains an unmet performance acceptance target**, not silently
promoted to completion. Shared [status](../v03-status.md) and [verification](../verification.md) now describe one
merged tree and its limits rather than obsolete per-stage missing features.

| Commit | Purpose |
|---|---|
| `1b4b05e` | Merge lane GL, bounded OpenGL 3.3 command-stream profile |
| `ac0ac4f` | Merge lane W2, WebGL 2 §13 execution |
| `353eb7d` | Merge lane C, cooperative threads; semantic E/GL/F integration |
| `d0f6854` | Repair merged GPU loss policy, pending-work guard, COM isolation, bridge environment and browser server ownership; regressions |

The final documentation commit contains this handoff and the consolidated status/verification records. Merge and
repair commit messages explain the conflict decisions. Prior S1/E/G/WG/F merges were retained, not rewritten.

## Conflict decisions by meaning

- **GL:** auto-merged without textual conflicts. Kept E's COM/audio/input registry and DLL entries alongside GL
  registry, presentation ownership, GL metrics/stub exposure, build translation unit and semantic GPU recorder/oracle.
- **W2/WG runtime:** one CAP_GPU import/negotiation and gpuBackend assignment; restoration emits DEVICE_RESET and
  TARGETS_LOST based on advertised GPU or legacy target use. Keep executable capability gates/language masks from
  both backends. W2 initially blocked fallback whenever a backend advertised languages, which contradicted WG's
  preserved legacy-2D fallback. A real reviewer question **timed out after 900 s**; used its stated safe default:
  resource-free legacy fallback may renegotiate, but **no live §13 resources, pending GPU work or language-bound
  objects migrate**. Preserve the existing WG diagnostic and both lanes' unchanged loss/fallback assertions.
- **C/E/GL `w32_core.c`:** keep all seven kernel/USER/GDI/COM/audio/input/GL tables and prioritize thread-aware
  duplicate APIs. Retain scheduler handoff, native callback parking, per-thread error/TEB/PEB, actual deferred-result
  tracing, input/audio frame pumps, GL presentation ownership and metrics. DLL JSON retains the union of lanes.
- **C/E `w32_kernel.c`:** retain thread-local error cells and synchronization/file CloseHandle paths. Replace E's
  explicitly temporary main-thread event namespace with scheduler-owned events. Audio event validation/signaling
  now uses the real shared objects and wake arbitration; it does not clobber guest arguments/last error.
- **Build pipeline:** compile E audio/COM/input, GL and C thread/scheduler sources for both widths; preserve C's
  continuation registry counts separate from source function counts and all earlier build behavior.
- **C/F `lift64.h`:** keep F's register-local optimized emitter rather than restoring C's old generic emitter.
  The existing F native boundaries return to runtime before suspending; in the cold block path check X.transfer
  immediately after shared instruction execution, before invoking a CALL suspended before execution. Keep C's i386
  exact continuation entries, quantum handling and scheduler-aware shared runtime.
- **COM state:** E's apartment mode/nesting was process-global. Move it to fixed guest-thread slots; this preserves
  single-thread behavior while permitting independent worker STA/MTA initialization. No general marshaling claim.

## Regression evidence

- Audio fixture joins a worker woken by WASAPI's scheduler-owned auto-event; two passes require worker exit sentinel,
  isolated STA initialization/nesting while primary uses MTA, mode-change rejection, uninitialized CoCreateInstance
  failures and preserved last error. Existing exact samples/amplitude/frequency/duration assertions are retained.
- Host `hasGpuWork` includes logical handles, open passes and unconsumed GPU items. Runtime guards it plus renderer
  objects; `setBackend` defensively rejects migration before mutating state. Unit checks cover logical handles after
  consumption, pending deletion with empty maps, language renegotiation and unrelated caps. Browser checks loss after
  decoded create and create/delete **before the first GPU draw**, alongside existing post-draw failure and legacy
  fallback keep-playing tests.
- Fake-pi unit fixtures clear `PI_PROVIDER_EXTENSION` inside each test and restore inherited environment afterward;
  exact workspace extension assertions are unchanged. Temporary directories are removed on success/failure.
  Both unsetting-provider and ordinary inherited-provider full unit invocations pass.
- Playwright now always owns its server (`reuseExistingServer:false`); catch-all HTTP 200 from another SPA cannot
  masquerade as kit readiness. No assertion or timeout was relaxed.

## Final required gates

Commands ran sequentially for build-heavy work, against final implementation `d0f6854`'s tree (documentation was
then consolidated). Existing compiler/linker warnings remain visible; this is not a warning-free-build claim.

| Gate | Result |
|---|---|
| `npm run doctor` | ready |
| `npm run lint` | pass: ESLint and all example check-builds |
| `npm run typecheck` | pass |
| `env -u PI_PROVIDER_EXTENSION npm test` | **231 tests / 25 files passed** |
| `npm test` with inherited PI_PROVIDER_EXTENSION | **231 tests / 25 files passed** |
| `BGT_E2E_PORT=5292 BGT_REQUIRE_WEBGPU=1 npm run test:e2e` | **135 passed / 50 intentional skips / 0 failed** |
| `npm run leakcheck` | **317 committable files clean** |
| `git diff --check` | clean |

Browser breakdown: WebGL 2 **70 pass / 20 skip**, WebGPU **60 pass / 30 skip**, auto **5 pass**.
Skips: four pre-existing backend/tour exclusions, 28 W2-only cases in WebGPU, 18 WG-only cases in WebGL 2 (one is
I1's new loss-before-draw case). All intended GPU backend cases execute; WebGPU availability was required.

### Explicit CLI oracles

Each command was `npm run oracle -- examples/<id> 300`, rerun after final repairs:

`x64-audio`, `x64-basics`, `x64-cpp`, `x64-cpprt`, `x64-crt`, `x64-gl`, `x64-gui`, `x64-input`, `x64-memory`,
`x64-threads`, `x64-tls`, `x86-threads`, `win32-hello`.

**13/13 identical, 300 frames each = 3,900 frame pairs**, both errors null, lifted interpreted instructions zero.
GL additionally compares normalized semantic GPU commands/upload bytes/source via its recording backend; that
recorder does not rasterize or compile on a native driver. No real-game L1/L2/L3 claim.

Private evidence: `.scratch-I1/{doctor,lint,typecheck,unit,unit-inherited,e2e,leakcheck}.log`,
`.scratch-I1/oracles.tsv`, `.scratch-I1/oracle-*.log`, `reports/oracle-*.json`, `reports/e2e-results.json` and artifacts.
Scratch is excluded locally, not committed. All test commands used the installed toolchain/dependencies.

## Independent validation (actually executed)

Two separate fresh pi sessions launched through the existing workspace driver, with bridge disabled for the
reviewers and no reused conversation. They did not modify tracked source or git state.

1. `.scratch-I1/review/result.txt`: independently ran **24 bridge tests / 1 file** with provider inherited and
   inspected integration. Found a concrete fallback bug: host-decoded-but-not-rendered objects could bypass the
   renderer-only guard. Also identified process-global COM apartments; the integration fixed that during review.
   First verdict was **changes required**; retained, not presented as a pass.
2. `.scratch-I1/recheck/result.txt`: rechecked host pending-work protection and COM/audio assertions, independently
   ran **34 tests / 2 files** (10 GPU-limits + 24 bridge), no global setup, provider inherited. Verdict:
   **previous blocker fixed; no further concrete issue found in the requested scope**. Temporary config/caches
   deleted. Browser/COM/audio regressions were inspected, not independently executed; broad counts are integrator
   evidence. No performance acceptance or whole-kit certification was delegated or inferred.

## Failures encountered / resource hygiene

- Initial lint invocation exceeded the tool's 120 s command limit; rerun with adequate command budget passed,
  without changing test timeouts.
- Initial browser attempt inherited **5191**, already occupied by an unrelated SPA. Its readiness HTTP 200 fooled
  server reuse and tests waited for an absent kit API. This is invalid kit evidence, not 77 product regressions.
  Localized via the failed-page snapshot; changed ownership to fail closed and reran on free **5292**. Did not touch
  the unrelated server or developer `:5173`.
- First valid browser run had **132 passes / 2 failures**: W2 strict language guard blocked legacy fallback and
  hid WG's live-resource diagnostic. Both fixed by the policy above; no assertion was changed to accept failure.
- Removed **138 integration-created transient fixture directories**, smoke report artifacts and reviewers' own
  temporary caches/configs. Retained compact logs/final reports and reusable build caches. No ENOSPC; final free
  space approximately **4.6 GiB**. No files outside own temporary outputs were deleted.

## Honest remaining limits

- **F-PERF-CRT open:** saved lane benchmark is **1.55× smaller / 1.10× faster**, below ≥2× whole-module size/speed.
  CPU-heavy fixture's 4.85×/3.65× success does not waive it. No merged-tree rebenchmark or universal speed claim.
- **WGSL is WebGPU-only** (W2 mask 6, WG mask 7); practical GLSL frontend, not unrestricted shader compatibility.
- GL command-stream/oracle completeness is distinct from end-to-end driver-compiled GL scene pixel goldens; those
  goldens and consolidation of separate native backend scenes are deferred. GL explicit stubs/context/resource/
  reflection/readback bounds remain as its handoff describes.
- Threads retain 64 lifetime slots, 1023 non-reused handles, 512 live locks, retained stacks/TEBs and LIFO native
  continuation limits; no general fibers/APCs/priority/asynchronous termination, full CRT locale/errno/x87 thread
  state or full COM marshaling. Audio/input device/format/queue/resampling limits remain.
- Physical iPhone/Safari/Firefox, rumble/listening, remote Ubuntu/CI, nested sandbox and real-game stability or
  multi-million-instruction performance were not verified. Optional real-model bridge e2e was lane evidence,
  not rerun by I1. No installs, original-game access or push needed/deferred.
