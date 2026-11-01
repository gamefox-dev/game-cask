# Integration I6a — K8b GLSL selectors and K8c WASAPI/path contracts

## Delivery

`integration/p1` started at `3241d24` (K7i). In the requested order, this session merged:

1. `lane/K8b` at `94b4bb0`, implementation `5924d60`, with `--no-ff` as merge `f8a43ba`.
2. `lane/K8c` at `5bc88fe`, implementation `67ce229` plus fixture correction `82cfceb`, with `--no-ff` as merge `4aa8313`.

No merge conflicts occurred. Meaning is preserved from all three lanes: K7i's separate object compilation/lazy
selection/shared CAS and sandbox-safe heavy gate, K8b's typed boolean GLSL `mix` lowering and backend regressions,
and K8c's endpoint-notification ownership and shared DOS path normalization.

The requested `docs/handoff/K8b.md` and `K8c.md` were read from their lane refs before merging. The K7i branch in
this checkout contains the implementation commits but no `docs/handoff/K7i.md` path; no unavailable handoff content
is claimed here.

## K7i lazy-selection/cache integration

The first full unit run exposed the expected integration issue: `testExamples()` omitted `x64-glsl`, because the new
`tests/unit/glsl-regressions.test.ts` had no declaration. It was corrected with:

```ts
// @bgt-examples: x64-glsl
```

The focused declaration/GLSL suite then passed **125/125**, and the full suite rebuilt all 27 declared example
fixtures through K7i's object cache. The K8b WebGPU shader unit test and K8c CRT filesystem test own generated
fixtures and correctly declare no prebuilt example. The existing K8c audio unit declaration continues to select
`x64-audio` and `x64-input`.

## Verification

All required gates were run in the sandbox on the final tree, serially where they build or publish shared fixtures:

| Gate | Result |
|---|---|
| `npm run doctor` | ready |
| `npm run lint` | pass: ESLint, clang, real GCC host check, 27/27 example check-builds |
| `npm run typecheck` | pass |
| `npm test` | **765 passed / 63 files / 0 failed** |
| `npm run test:e2e` | **210 passed / 51 existing intentional skips / 0 failed / 0 flaky** |
| `npm run leakcheck` | pass, 520 committable files |
| pipeline oracles | **23/23 at 300 frames**, 6,900 identical frame pairs, null errors |

Browser breakdown: WebGL 2 **95 passed / 24 skipped**, WebGPU **107 / 26**, auto **8 / 1**. The K8b GLSL probe ran on
both actual backends and the K8c audio test passed on both; no new skip, tolerance or assertion weakening was added.
The five prior sandbox-only `pi-harness` failures are gone inside the sandbox under K7i.

The oracle inventory was derived from every example `game.json` with `pipeline`:
`win32-conformance`, `win32-hello`, `x64-audio`, `x64-audio-init`, `x64-basics`, `x64-contracts`, `x64-cpp`,
`x64-cpprt`, `x64-crt`, `x64-gl`, `x64-gl-fbo`, `x64-glsl`, `x64-gui`, `x64-handles`, `x64-input`, `x64-memory`,
`x64-scale`, `x64-smoke`, `x64-sysdlls`, `x64-threads`, `x64-tls`, `x86-handles`, and `x86-threads`.
Every result was `identical: true`, with no lifted interpretation and no lifted stubs. Four native BGT examples have
no differential oracle and retain their build/browser coverage.

## Boundaries

K8b remains a bounded GLSL frontend lowering, not unrestricted GLSL or a new shader language claim. K8c remains
process-local fixed-topology endpoint ownership and bounded DOS namespace normalization; it does not claim native
Windows parity, hotplug delivery, capture/exclusive audio, UNC transport or full NT verbatim/long-path/device
semantics. K8c's `_open`/`_wopen` descriptor-family follow-up remains documented in `docs/handoff/K8c.md`.
No remote CI, mobile/browser certification, physical audio claim, or general game compatibility claim was made.

## Final status

`docs/v03-status.md` now records I6a as the current merged status. The only post-merge code change was the required
lazy-selection declaration in `tests/unit/glsl-regressions.test.ts`; it is covered by the focused and full unit runs.
