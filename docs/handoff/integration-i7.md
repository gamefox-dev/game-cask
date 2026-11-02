# Integration I7 — K9a + K9b merge

## Delivery

Integration branch `integration/p1`, merge commit **`2638514b1c056266ac7c38aad6626b74db808daf`**. This is a
`--no-ff` merge of K9a (`c976636`) and lane K9b/K9c (`4bb0f8a`), preserving both the K9a GLSL lowering contracts
and K9b's framebuffer blit / transform-feedback implementation. No game files, captured shader source, external
dependencies, web access, system installs or pushes were used.

The only source conflict was `bgt/renderers/webgpu/shaders.ts`: K9b's required exported `glslName` was retained,
while K9a's complete reserved-word mapping, including `shared`, was kept. The transform-feedback compute module
continues to consume the canonical translated vertex module, so K9a's ordered expression temporaries, aggregate
equality lowering, lazy branches and copy-in/copy-out storage apply unchanged to capture shaders. K9b's native
WebGL transform feedback and separate WebGPU vertex-to-compute lowering remain engine-agnostic.

## Regression added by I7

`tests/support/glsl-feedback-regression.ts` is an original CC0 fixture. It combines, in one GLSL330 and one
GLSL ES300 vertex shader: hexadecimal/full-width integer literals, vector and struct equality, lazy conditional
and short-circuit expressions, forwarded `inout`, indexed copy-out with evaluation-time index capture, swizzle
copy-out, and the WGSL-reserved varying name `ref`. The new unit coverage checks the canonical body survives the
compute lowering and exact interleaved/separate byte sizes. The new browser test in
`tests/e2e/gpu-feedback.spec.ts` executes both languages on both actual backends, two instances, both capture
layouts, and compares independently calculated little-endian bytes: **320 interleaved bytes**, or **128/64/128
separate bytes**, for each language/backend (**2,560 exact compared bytes / 64 vertex invocations** overall).
It passed **2/2** focused browser tests. The existing K9b feedback
fixture and native capture tests remain in the full run.

A fresh independent read-only source review returned **PASS within bounded scope**. It independently recalculated
seed words, selected-branch effects, signed values, floats, invocation order and byte lengths. It did not run
builds/tests/browser and is not attributed Tier-1 evidence.

## Final checks

All executable code/tests were frozen at `2638514`; the final follow-up changes only this handoff and the status
ledger. All checks were run after the merge, sequentially where build publication could race:

| Gate | Result |
|---|---|
| `npm run doctor` | ready |
| `npm run lint` | pass: ESLint, Clang + real GCC host checks, **30 example check-builds** |
| `npm run typecheck` | pass |
| `env -u PI_PROVIDER_EXTENSION npm test -- --maxWorkers=1` | **965 passed / 71 files / 0 failed** |
| `BGT_E2E_PORT=5228 BGT_REQUIRE_WEBGPU=1 npm run test:e2e` | **228 passed / 51 unchanged intentional skips / 0 failures** |
| Browser backend breakdown | WebGL2 **102/24**, WebGPU **118/26**, auto **8/1** |
| `npm run leakcheck` | pass, **561 committable files** including final documentation |
| Pipeline oracles | **27/27 × 300 = 8,100 identical pairs**, null errors, `interp_insns=0`, `stubs=[]` |
| Independent review | PASS, bounded source review; no Tier-1 attribution |

The full pipeline inventory is win32-conformance, win32-hello, x64-audio, x64-audio-init, x64-basics,
x64-contracts, x64-cpp, x64-cpprt, x64-crt, x64-gl, x64-gl-blit, x64-gl-current, x64-gl-fbo, x64-gl-feedback,
x64-gl-integer, x64-glsl, x64-gui, x64-handles, x64-input, x64-memory, x64-scale, x64-smoke, x64-sysdlls,
x64-threads, x64-tls, x86-handles and x86-threads. All were explicitly invoked at 300 frames after the example
build. Native browser fixtures are pixel/contract evidence, not fabricated differential oracles.

## Honest intermediate results and boundaries

The initial full unit attempt received external **SIGTERM at approximately 11:42 +07 on 2026-11-02** during the
build-discovery/global-setup phase; its last logged operation lifted the 70,005-instruction discovery body
(`discovery_exe_0001`). The reviewer reported the termination as external, cause unknown. The following full-run
log contains two interleaved failure summaries: **956/965** (nine failures) and **960/965** (five failures), involving
missing manifests/chunks and a chunk-test build output disappearing. Those runs are not passing evidence; no
unproven root cause is attributed to shader changes. Focused CRT rerun: **9/9**. Subsequent complete unchanged
runs passed **965/965**, at 11:55:51 (`unit-final2.log`, 232.06 s) and 12:00:59 (`unit-final-rerun.log`, 263.60 s).
A focused browser invocation also encountered an occupied owned test port left by the earlier attempt; after
cleaning that port, the focused native regression passed **2/2**. No test, timeout, tolerance or skip policy changed.

The existing 51 browser skips are unchanged backend/policy skips. This merge does not claim unrestricted OpenGL 3.3,
complete GLSL, native WGSL transform feedback, mobile/browser certification, target-game startup, first draw or
playability. K9b's explicit Q34/Q35 limits remain authoritative, including array/matrix/interface-block varying
rejection, single-sample blits and native-WGSL feedback `E_UNSUPPORTED`. Recovery fails closed for live GPU-generated
buffers without an authoritative checkpoint; full reupload or deletion remains necessary before ordinary restoration.

External scratch evidence under `/tmp/i7/`: final reruns `doctor-final.log`, `lint-final.log`,
`typecheck-final.log`, `unit-final2.log`, `unit-final-rerun.log`, `e2e-final.log`, `leak-final.log`,
`oracle-<id>.log`, `oracles.json`, `oracles-summary.json` and `oracles.log`. The final lint finds real
`/opt/homebrew/bin/gcc-14`, not Apple's clang alias; the scale example is built by the full suite and oracle
rather than duplicated in lint's 30 check-builds. The fresh review used
`review-prompt.md`, `review-result.txt` and `review-findings.md`, with a separate session retained under
`review-result.txt.d/`. Earlier `unit.log`/`unit-final.log` are interrupted/failed attempts, not passing evidence.
Ignored `reports/e2e-results.json` and all `reports/oracle-*.json` retain structured local results. Machine-local
scratch paths are not a durability guarantee. Disk remained about **14 GiB free**; no ENOSPC occurred. No gate or
integration task is deferred.
