# Verification record — Game Cask

This records observed evidence, not unrestricted compatibility. The current merged capability/limits ledger is
[v03-status.md](v03-status.md). Lane handoffs retain their narrower measurements and review histories; their earlier
suite totals are not added together or presented as merged-tree results. Prior versions of this file remain in Git.

## FIX3 — usable-device startup and CI separation

### Supported environments

- **WebGPU on a real GPU:** primary target.
- **WebGL 2 on a real GPU:** supported fallback.
- **No GPU / software rasterizers (SwiftShader, VMs, CI):** untested, not blocked; best effort,
  software-specific quirks ignored. Passing software tests do not certify hardware or performance.

Default Linux CI retains typecheck, units, wasm example builds, lint/leak checks, WebGL 2 functional
execution and user-default auto boot/fallback. Every cross-backend comparison (including the smoke's
second renderer) is tagged `@webgpu` and excluded from the WebGL project; the opt-in GPU job runs the
WebGPU project with `BGT_REQUIRE_WEBGPU=1`. Existing WebGPU-specific suites remain backend-gated.
Only default software CI explicitly sets `BGT_SOFTWARE_RENDERER=1`: strict pixel/color equality,
GPU-vs-CPU raster comparisons and narrow raster tolerances are omitted with the annotation
`pixel-assertions-skipped: software renderer: untested environment`. Boot, backend selection,
compilation/readback completion, opcode coverage, lifting, loader/input/thread/audio/file logic,
error assertions and the full **600-frame / 6,000-draw** smoke remain active. Broad visible-change
checks still run as best-effort smoke, with no realtime threshold. Real-hardware runs leave the flag
unset and preserve the original pixel assertions/tolerances. This policy supersedes FIX2's decision
to attempt cross-backend comparisons from default Linux CI.

### Artifact root cause and regression provenance

Inspected all failures in supplied run **41158704599**, and extracted all 13 trace ZIPs into private
`/Users/dev/projects/pi-work/scratch-FIX3/traces/`. Chromium exposes an adapter/device but its Dawn
Instance dies on use; successful adapter discovery was incorrectly treated as usability. Boot trace
`836fdc2d2d4ff500dc5550bf5019cf2e2c7ce1ab` records guest title/ready logs, then an external-Instance
warning and `webgpu device lost (unknown): A valid external Instance reference no longer exists.`,
then the failed `step`, another destroyed-device loss and fallback. The four `runtime not ready`
failures occur on secondary WebGPU launches immediately after preflight/openGame, not on primary
WebGL execution. Those secondary launches lack detailed browser snapshots/logs in the supplied
traces, so their exact internal fatal reason is not directly recorded; startup/device-loss racing is
the supported inference, not a proven guest trap or a separately diagnosed lifting fault. The two `toEqual([])` failures
are **runtime error arrays containing frame-0 `device-lost (destroyed)`**, not different image/hash
values. The primary WebGL smoke completed all 600 frames with its PASS log. Error assertions were
not removed or filtered to hide these losses.

**FIX2 (`cca40eb`) introduced the auto-boot regression**, not K1 or FIX1. It removed the unconditional
`--use-angle=metal` on Linux while retaining unsafe-WebGPU/Vulkan flags; previously unsupported Metal
caused early unavailability/fallback, whereas FIX2 exposed the broken Dawn path. Auto now uses the
normal user-default Chromium launch instead of hardware-job unsafe flags. Runtime protection is
independent of flags and applies to users too.

### Repair and local reproduction

Shared `bgt/renderers/webgpu/probe.ts` checks adapter → device → tiny buffer submission → exact
readback → queue completion, repeats with a different sentinel after a task turn, and races loss
and a bounded timeout. Runtime retains the same GPU/adapter/device instead of throwing away the
successful probe and assuming another device works. It checks again after renderer initialization,
before publishing/wiring recovery; rejected startup destroys resources and auto falls back to WebGL 2
with a diagnostic reason, without guest device-reset/error pollution. Explicit `backend=webgpu` still
fails closed. Post-success guest/render/context failures and later availability loss remain failures,
not hardware skips; test preflight imports the same module on its actual browser launch.

Reproduced **present-but-broken** locally with browser init-script adapters: device acquisition throws
Dawn's OperationError, submission throws it, or the acquired device is already destroyed. Each auto
case boots and renders on WebGL 2 with a stage-specific reason, no runtime errors and no reset. Actual
Chromium preflight gives three reasoned skips; the same cases with `BGT_REQUIRE_WEBGPU=1` give three
expected failures and zero skips. Unit tests also cover corrupt readback, mapping/completion failure,
loss on a later task, timeout/late-device cleanup and preserving failure after prior successful work.
No claim of reproducing Ubuntu's native driver failure on this macOS/Apple M4 host, and no attempt to
make SwiftShader WebGPU a supported target.

### Local gates (macOS / Apple M4, Node 24.19.0, installed Chromium/Playwright 1.64.1)

| Check | Result |
|---|---|
| `npm run doctor`, `npm run typecheck`, `npm run lint`, `npm run leakcheck`, `git diff --check` | pass |
| `npm test` | **417 passed / 35 files** |
| CI-mode WebGL 2 + auto, `BGT_SOFTWARE_RENDERER=1` | **95 passed / 25 intentional skips / 0 failures** |
| All projects, `BGT_REQUIRE_WEBGPU=1`, strict pixels enabled | **192 passed / 51 intentional skips / 0 failures** |
| Injected broken-adapter policy, `BGT_TEST_BROKEN_WEBGPU=1` | **3 reasoned skips**, then **3 expected required-device failures** |

Commands use owned test port 5297 and `BGT_RESULTS_PREFIX=fix3-{final-ci,final-real,policy,policy-required}`.
Private logs/results and fresh independent review are in `scratch-FIX3/`; no original/game input,
web source, system install, dependency change or push. An initial command hit global heavy-build
slot contention and its timeout left port 5296 occupied; it was not reused. One early injected-loss
fixture incorrectly also threw submission failure, so it was repaired to isolate actual loss; all
final suites above include the corrected fixture.

Fresh independent review found an additional initialization-error delivery window: while the final
probe yielded native tasks, uncaptured pipeline validation errors could be forwarded to an empty
callback list before runtime wiring. Initialization now accumulates those original messages and
rejects/cleans up before publication; auto retains the reason in `backendNotes`, required WebGPU
fails closed, and later errors still reach consumers. Three maintained actual-renderer/runtime-selection
regressions cover that case even though all four probe submissions succeed. A second fresh independent
session **approved**, personally passing **40 focused tests / 4 files**, then repeating the three startup
regressions. Reports: private `review-result.md` and `recheck-result.md`; no independent broad-browser
certification is implied. All broad local gates above were rerun after this repair.

CI request round 1 for `350fe42` timed out after 900 seconds without a result. Round 2/final for
**`d3c22f8` is GREEN on Ubuntu**, reviewer-reported run **41164491670**. The reviewer performed the
push/remote execution; this developer did not push. This validates the default Linux functional job,
not the opt-in real-GPU job or general software-rasterizer conformance.

## FIX2 — cross-backend tests without a WebGPU adapter

The three new cross-backend specs now report **separate backend-only and comparison tests**. WebGL 2
execution/readback, all eight x64-gl pixel probes across seven scenes, and x64-smoke's complete **600 frames / 6,000 draws**
still assert without WebGPU. Only WebGPU/comparison tests skip, with an adapter-acquisition reason;
`BGT_REQUIRE_WEBGPU=1` turns that absence into failure. Shared `openGame` and visual conformance preflight
the actual browser launch before starting a guest. Missing API, null adapter, or Dawn adapter-acquisition
`OperationError` may skip; errors after a successful adapter probe (including unavailable canvas/device
initialization) fail. Successful acquisition is retained across pages/contexts in the same test/browser;
subsequent adapter loss cannot skip already completed GPU work. Independent tests or browser launches
retain their own first-probe availability decision. Secondary launches share project flags; Metal is
selected only on macOS.

### Smoke failure and budget

Reviewer-supplied Ubuntu CI run **41144543509** was inspected locally, not rerun remotely. Its
`e2e-results.json` records x64-smoke as **timedOut**, 65,461 ms total, with a **60,000 ms test timeout**,
not a primary WebGL runtime failure. The attached primary browser log contains
`x64-smoke PASS frames=600 worker=8599ce32 files=2 pad=100 buttons=100 audio=joined`, with no console/page/
request errors. Trace `68b2edbe5d0887115771a6a03d4894c83ccc4b17.zip` shows primary WebGL diagnostics
`ready=true`, `failed=false`, `frame=617`, `gl_draws=6000`, no runtime errors, after roughly **44 seconds**.
The secondary WebGPU launch then reports destroyed-device loss, unavailable external Instance, no adapter
on recovery, and switches to WebGL 2; the original combined test runs beyond its remaining budget.
Primary coverage reports average frame render cost **57.19 ms**, p95 **119.29 ms**, plus trace/readback cost.
This establishes software-rendering/combined-test budget cost in that artifact. The brief's separate
`runtime not ready` wording is **not reproduced in that result**; no unobserved trap is attributed to timeout.

The smoke explicitly allows **120 seconds per backend-only test / 240 seconds per cross-backend test**
for cold startup and software rasterization. It is a functional gate, not a 60 Hz/realtime benchmark.
No short CI loop is substituted: exact completion/checksum/files/gamepad/audio logs, 6,000 draws, zero
stubs/interpreted instructions/errors, all images and every cross-backend API hash remain asserted.
Startup readiness and stepping failures now include runtime diagnostics rather than just `runtime not ready`.

### Reproduction and local gates

macOS Apple M4, Node 24.19.0, installed Chromium/Playwright 1.64.1; no install or web fetch.
`BGT_E2E_NO_WEBGPU=1` applies SwiftShader, unsafe-SwiftShader permission, `--disable-webgpu` and
`--disable-features=WebGPU` to **both project and secondary launches**, without unsafe-WebGPU enabling.
An opt-in fallback test verifies requestAdapter really returns no adapter, auto selects WebGL 2 with
reported notes, and expected pixels render. It fails rather than silently claiming a no-adapter reproduction
if Chromium changes the flag behavior. Normal runs intentionally skip this reproduction-only test.

```sh
npm run build:examples
BGT_E2E_PORT=5295 BGT_E2E_NO_WEBGPU=1 BGT_RESULTS_PREFIX=fix2-resume-ci \
  npx playwright test --project=chromium-webgl2 --project=chromium-auto
# Includes the three affected specs: 12 backend-only passes and 12 reasoned comparison skips.
BGT_E2E_PORT=5295 BGT_E2E_NO_WEBGPU=1 BGT_RESULTS_PREFIX=fix2-resume-noadapter-all npx playwright test
BGT_E2E_PORT=5295 BGT_REQUIRE_WEBGPU=1 BGT_RESULTS_PREFIX=fix2-resume-normal npx playwright test
```

| Local gate | Result |
|---|---|
| Forced no-adapter, CI's WebGL 2 + auto projects | **90 passed / 32 skipped / 0 failed** |
| Forced no-adapter, all three projects | **95 passed / 143 skipped / 0 failed** |
| Normal full browser suite, WebGPU required | **193 passed / 45 intentional skips / 0 failed** |
| Required-WebGPU negative check, forced absence, x64-gl comparison | **expected failure**, `WebGPU required but WebGPU unavailable: requestAdapter returned null` |
| Smoke, SwiftShader plus 8× CDP CPU throttling | all 600 frames pass, **29.6 s**; not Ubuntu performance certification |
| `npm test` | **262 passed / 31 files** |
| `npm run typecheck`, `npm run lint`, `npm run leakcheck`, `git diff --check` | pass |

After resuming the interrupted session, reviewed every recovered diff/new file; no truncated source was
found. Repeated the build, CI-project no-adapter reproduction, full no-adapter and required-WebGPU browser
suites, required-hardware negative check, units and static gates. Final full no-adapter/normal runs include
the cross-page-loss repair. Evidence: private `.scratch-FIX2/resume-*.log`,
`reports/fix2-resume-*-results.json`, decoded supplied CI smoke attachments/trace in scratch. The earlier
software/CPU-throttled smoke run is `.scratch-FIX2/slow.log`, not a new performance measurement.
An earlier intermediate normal rerun had a win32-hello startup failure: its trace showed
`net::ERR_NETWORK_CHANGED` loading four Vite modules before any runtime/test API existed. No retry or
allowance was added. Resume runs passed normally. Port 5195 was already occupied; it was left alone and
resume runs owned port 5295 instead. The developer server was untouched.

Fresh independent sessions found post-probe conformance skips, repeated same-page loss skips, and finally
fresh-page loss skipping within one visual comparison/browser. All are repaired with maintained behavioral
regressions. The final separate recheck independently passed **20 availability tests**, and an in-memory
old-behavior negative control made all three new cross-page callback regressions fail with `test skipped`.
Scope/details are in `.scratch-FIX2/resume-recheck/result.md`; broad-suite numbers above are the developer's
runs. Temporary duplicate decoded traces and test caches were removed after review; compact logs,
results and review reports remain. This is a local no-adapter reproduction plus inspection of a supplied
remote failure, **not a passing remote Ubuntu rerun**. No runtime, web source or game fixture was changed.

## Integration I1 — merged tree

Branch `integration/p1` already contained S1/E/G/WG/F; I1 merged **GL → W2 → C** using `git merge --no-ff`:

| Merge | Commit | Semantic decision |
|---|---|---|
| GL | `1b4b05e` | No textual conflicts; retain E registries/DLLs, add GL registry/build/presentation/metrics/oracle |
| W2 | `ac0ac4f` | Deduplicate shared GPU startup negotiation; retain restoration events and fail-closed loss behavior |
| C | `353eb7d` | Keep all profile registries/sources with thread-aware duplicate APIs; per-thread errors, scheduler continuations, audio-event adapter; keep F optimized emitter with cold quantum transfer propagation |

Follow-up integration repairs preserve the legacy 2D fallback while rejecting live/pending GPU migration, add
thread-local COM apartment state and worker-audio assertions, isolate bridge provider environment, and disallow
reuse of an unrelated browser server. See [handoff/integration-i1.md](handoff/integration-i1.md) for commits and review.

### Environment and exact commands

macOS / Apple M4, installed Node **24.19.0**, Zig **0.13.0**, Playwright **1.64.1**, Chromium. Tests run against the
kit's source-built CC0 fixtures, never `port/` or original game inputs. Windows executables are lifted, not executed
on the host. Native reference programs are built from the same original fixture C/C++/pthread-adapter source.
No new dependency, web fetch, system install, push or test weakening.

| Command | Merged result |
|---|---|
| `npm run doctor` | ready |
| `npm run lint` | pass, including all example check-builds; existing compiler/linker warnings are not suppressed |
| `npm run typecheck` | pass |
| `env -u PI_PROVIDER_EXTENSION npm test` | **231 passed / 25 files**, no skips/failures |
| `npm test` with inherited provider | **231 passed / 25 files**; bridge tests internally clear/restore the provider hook, not extension assertions |
| `BGT_E2E_PORT=5292 BGT_REQUIRE_WEBGPU=1 npm run test:e2e` | **135 passed / 50 intentional skips / 0 failures** |
| `npm run leakcheck` | clean; **317 committable files** including I1 handoff |
| `git diff --check` | clean |

Browser breakdown: **WebGL 2 70 pass / 20 skip; WebGPU 60 pass / 30 skip; auto 5 pass**.
The 50 skips are four existing backend/tour exclusions, 28 W2-specific tests excluded in WebGPU and 18 WG-specific
cases excluded in WebGL 2. Both actual backends execute; WebGPU is required, not skipped for missing hardware.
W2's 28 GPU cases and WG's 18 GPU cases (including I1's new pre-draw-loss test) all pass on their intended backend.

Every required oracle was invoked separately with `npm run oracle -- examples/<id> 300`:

| ID | Compared frames | Result |
|---|---:|---|
| `x64-audio` | 300 | identical; both errors null; lifted interp_insns 0 |
| `x64-basics` | 300 | identical; both errors null; lifted interp_insns 0 |
| `x64-cpp` | 300 | identical; both errors null; lifted interp_insns 0 |
| `x64-cpprt` | 300 | identical; both errors null; lifted interp_insns 0 |
| `x64-crt` | 300 | identical; both errors null; lifted interp_insns 0 |
| `x64-gl` | 300 | identical API + semantic GPU stream; recorder, not rasterization |
| `x64-gui` | 300 | identical; both errors null; lifted interp_insns 0 |
| `x64-input` | 300 | identical; both errors null; lifted interp_insns 0 |
| `x64-memory` | 300 | identical; both errors null; lifted interp_insns 0 |
| `x64-threads` | 300 | identical; both errors null; lifted interp_insns 0 |
| `x64-tls` | 300 | identical; both errors null; lifted interp_insns 0 |
| `x86-threads` | 300 | identical; both errors null; lifted interp_insns 0 |
| `win32-hello` | 300 | identical; both errors null; lifted interp_insns 0 |

**13 oracles / 3,900 frame pairs**, no oracle skips/divergences/errors; `x64-gl` also has zero interpreted
instructions. A shared-semantics differential oracle is not an independent proof of CPU semantics or GPU pixels;
known-result/native-reference, full CPU/RAM comparisons and browser pixel assertions provide additional evidence.

Evidence: private `.scratch-I1/{doctor,lint,typecheck,unit,unit-inherited,e2e,leakcheck}.log`,
`.scratch-I1/oracle-<id>.log`, `reports/oracle-<id>.json`, `reports/e2e-results.json` and browser artifacts.
Build-heavy gates were sequential to avoid shared fixture/cache races. Scratch is local/excluded, not a published
artifact. Own disposable outputs were cleaned; no ENOSPC occurred.

### Integration regressions and independent review

- **E/C events:** CreateEvent/WaitForSingleObject now resolve to the scheduler. The audio native pump signals those
  same objects. `examples/x64-audio/audio.c` starts and joins a worker receiving an auto-event audio notification,
  checks a sentinel last error, thread exit code and two worker completion logs. The original exact 48,000 stereo
  output frames, amplitudes ±16384/±8192, opposite polarity, ~1 kHz and 58–62 virtual-frame span remain asserted.
- **E/C COM:** worker CoCreateInstance before initialization returns CO_E_NOTINITIALIZED; a fresh worker initializes
  and nests STA independently of primary MTA, rejects a mode change, then uninitializes independently. Storage uses
  the fixed guest thread index rather than a process-global apartment counter.
- **WG/W2 fallback:** existing GPU live-resource stop and legacy 2D keep-playing assertions both pass. Loss guards
  consult host logical resources, pending GPU items and renderer resources. New browser regression submits an
  unrendered buffer create, then separately create/delete (empty maps but queued work); both must stop before any
  migration. Unit regression checks decoded handles, post-consumption live handles, pending deletion, safe empty
  renegotiation, language mask changes and preservation of unrelated capabilities.
- **F/C quantum:** retain F's optimized register-local code. The cold shared-semantic block path checks transfer
  before invoking a CALL that the scheduler suspended before execution. Existing full CPU/RAM quantum tests and
  both thread fixtures' spin/continuation/oracle cases remain green.
- **Bridge:** each fake-pi test clears only inherited PI_PROVIDER_EXTENSION, restoring it afterward; exact workspace
  extension assertions are unchanged. Own temporary test directories are removed even on failure.
- **Browser harness:** the first I1 attempt used inherited port 5191, occupied by an unrelated SPA returning 200 at
  the readiness URL. That run timed out and is not counted as kit evidence. `reuseExistingServer:false` now fails
  closed on an occupied port. All successful merged runs own port 5292; the developer server was untouched.

A genuinely fresh pi reviewer independently executed the bridge-only suite with the provider inherited:
**24 tests / 1 file passed**, and inspected the integration read-only. It found the decoded-but-not-rendered GPU
fallback hole; I1 fixed it and added the regressions above. Fresh recheck details and exact final verdict are recorded
in the integration handoff; broad unit/browser/oracle results are the integrator's runs, not delegated execution.
A second fresh independent session rechecked the repair and independently ran **34 tests / 2 files** (10 GPU-limits
and 24 bridge), with the provider inherited and no global setup: **previous blocker fixed; no further concrete scoped
issue**. It inspected rather than executed browser and COM/audio regressions. Both real session reports remain in
`.scratch-I1/{review,recheck}/result.txt`; no independent broad-suite certification is implied.
The reviewer bridge separately **timed out** on the WG/W2 policy choice; the stated safe default was resource-free
legacy fallback plus fail-closed live/pending GPU handling. No reviewer approval of relaxed acceptance is implied.

## What the merged tests establish

### AMD64 / CRT / demand-grown memory

Task 1's original fixtures include integer/SSE results, C++ constructors/vtables and caught=38/destructors=3/order=321,
rethrow=6/destructors=3/order=345, TLS/static callbacks/full-width dynamic values, setjmp/longjmp and synthetic unwind
records, and visible GDI input changes. Task 2a's normal **-O2 / standard MinGW CRT** fixtures compare C/STL checksums
against host-native builds. Shared `crt.def` has **396 functions** (aliases included, ten data names separate);
`x64-crt` hits 180 distinct names. Libm raw-bit checks allow at most 4 ULP for sampled inputs, not all rounding modes.

The memory fixture touches **629145600 bytes**, verifies **153600 pages**, checksum **70272000**, and tests the
upper edge of the configured **2048 MiB** guest window. The default is 1024 MiB; images occupy 16–64 MiB. Wasm memory
grows on demand; this is not resident-RSS or arbitrary high-address support. Thread fixtures retain native checksum
`d494e6e3159c5fea`, processed=96, exits=406, errors=0, plus i386 stdcall/full-width Interlocked64 contracts.

Evidence: `tests/unit/{x64,x64-semantics,crt,codegen,threads,audio-input}.test.ts`, corresponding browser specs and
[THREADS.md](../platforms/win32/THREADS.md). No arbitrary MSVC/AVX/x87/multi-process compatibility claim.

### GPU ABI / renderers / GL

S1 layout/encoder/validation tests cover all 25 opcodes, negotiated prefix/tail limits, bounds/handles/budgets,
shader-request logs, resource generations and owned upload/source bytes. Frozen v0.2 modules still load.
WG/W2 native C scenes exercise indexed color triangles, alpha/mips, MRT sampling, depth/stencil, 1000 instanced
sprites, uniform animation, shader language handling and ordered legacy-2D/GPU screen/readback interleaving.
Browser probes assert actual pixels/formats/reflection failures/base vertex/first instance/full-width IDs, context
or device restoration, and reset/attachment-loss events. The maintained WG frontend's integer/ternary evaluation
review defects have lane regressions. WGSL is **WebGPU-only**; W2 advertises GLSL330/ES300 only.

GL's `x64-gl` is normally compiled/lifted and records seven scenes through the actual §13 validator. Its oracle
compares API hashes plus normalized GPU words, upload bytes and shader sources, ignoring only transport addresses.
The recording backend does not compile/rasterize. GL-native-driver end-to-end scene goldens/readback remain deferred,
not covered by separately passing backend-native pixel scenes. See [GL handoff](handoff/gl-profile.md) for bounded
formats/reflection/context/cache exclusions. No general OpenGL conformance claim.

### Codegen performance — measured lane evidence, unmet gate retained

[Lane F](handoff/codegen.md), [before JSON](handoff/codegen-before.json), [after JSON](handoff/codegen-after.json):

| Program | Whole wasm before→after | Median execution before→after | Acceptance |
|---|---|---|---|
| codegen-cpu | 4,268,957→880,331 B; 128.14→26.43 B/insn (**4.85× smaller**) | 19.559→5.357 ms (**3.65× faster**) | CPU-heavy thresholds met |
| x64-crt | 1,142,858→735,581 B; 213.82→137.62 B/insn (**1.55× smaller**) | 2.198→2.003 ms (**1.10× faster**) | **F-PERF-CRT open**, literal ≥2× size/speed not met |

Five fresh-instance 300-frame samples after a discarded warmup, excluding compile/instantiate/init, same installed
Node/Zig host toolchain. These measurements predate the full merged profile and were **not rerun by I1**. Whole-module
values include profile/Asyncify; no marginal-size substitution. Before/after compilation cache states differ, so no
build-speed claim. `x64-cpp` and hello did not improve execution in the saved sample. No 7M-instruction scalability,
real-game timing or mobile performance claim.

### Bridge and earlier UI/files/slice work

G's lane handoff records a real installed-pi **5/5** bridge e2e and a fresh read-only review; I1 reruns the no-model
suite, not that optional real-model e2e. The loopback bridge persists questions/status/cursors and supports live
boundary delivery/no-tools forks. It is same-user coordination, not isolation or a durable multi-writer database.

Earlier UI/GDI tests retain captions, mnemonic prefixes, radio/tick/separator/font fixes, multi-rect clipping and
CPU replay versus GPU pixels. Existing streamed-file and strict-slice tests retain ordered reads, omitted-data/code
outside-slice stops, and prebuilt global setup so compilation does not consume test deadlines. A prior cold-cache,
forced-SwiftShader, jobs=1 local reproduction passed the slice failure three times after moving builds into setup;
that was not remote Linux CI. Historical stage 4/5 commits omitted a needed kernel-file change; the finishing
follow-up supplied it. Those historical commits are not individually self-contained; I1 does not rewrite history.

## Unverified / deferred gates

- **F-PERF-CRT** ≥2× whole-module size and speed remains red as an acceptance target, not a failing functional test.
- End-to-end GL-native scene pixel goldens and consolidation of the separate backend-native scene fixtures.
- General GLSL/GL/Windows/CRT APIs, general native fibers/cyclic callback waits, full COM marshaling/audio/input
  devices, minimum-image/lazy-wasm packaging and multi-million-instruction scale: exact bounds in v03-status.md.
- Physical iPhone, Safari/WebKit/Firefox, physical rumble/listening and device performance, remote Ubuntu/GitHub CI,
  nested sandbox/container provisioning: **not performed by I1**.
- No real-game port was attempted or graded; fixture completion does not establish L1/L2/L3 for a game.
