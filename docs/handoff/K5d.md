# K5d — Q19 probe port ownership

## Delivery

- Branch: `lane/K5d`, based on `c403a4c`.
- Implementation: **`cebeb1c` — `fix(probe): require child-owned readiness before navigation`**.
- Scope: `tools/probe/` and its unit/integration regressions only. No Win32, CRT, x86, renderer, ABI, dependency,
  example or game behavior changes. No game files, web access, installs, pushes or test weakening.
- **Q19 fixed within the browser probe ownership contract.** Other iteration requests belong to other lanes.

## Ownership protocol

`probe.mjs` now spawns a dedicated Node/Vite child (`server-child.mjs`), not the Vite CLI followed by speculative
HTTP polling. The child uses loopback and `strictPort: true`, awaits `server.listen()`, then sends readiness over
its own IPC channel with PID, exact URL and a fresh per-launch nonce. The parent validates that message before
making any HTTP request. Consequently an occupied explicit port fails its child bind and cannot trigger even a
readiness fetch against the occupant, much less browser launch/navigation.

The parent next verifies a child-provided nonce endpoint over HTTP, rejects redirects/non-success/non-JSON
responses, validates the games-index shape and requires the requested built game. Only after these checks does
it launch Chromium and call `p.start()`. Automatic port scanning remains a candidate selection, not ownership
proof: a concurrent binder causes a strict startup failure, never endpoint reuse. Port numbers are validated and
`:5173` remains forbidden.

Startup failure cleans up and reaps the child even before `startServer()` returns. Normal CLI finalization also
awaits child shutdown; shutdown has a bounded SIGTERM-to-SIGKILL escalation. The child closes on parent IPC
disconnect or termination signals. Server output retained for startup diagnostics is bounded to 16 KiB.

This is accidental cross-project endpoint protection, not authentication against a hostile same-user process.
Backend fallback semantics are unchanged; the normal regression explicitly requires its intended WebGL 2 backend.

## Regressions and before/after evidence

**15 new cases** in `tests/unit/probe-server.test.ts`:

- Two synthetic occupying servers: arbitrary HTML-200 and plausible games-index JSON-200, both with a minimal
  synthetic browser test API. Each requires CLI exit **1**, bind/readiness error, no script execution,
  **zero HTTP requests**, and the occupying server still listening. No private/other-server content is opened.
- Six negative HTTP-readiness cases: wrong owner, HTML index, invalid JSON, malformed index, missing requested
  game, and redirect.
- Failed-manifest readiness releases its child/port, then a subsequent owned listener starts and shuts down.
- Six invalid/developer-port values fail before spawn.

The existing normal probe test retains stepping, screenshot/crop artifacts, the guest MZ signature and zero
interpreted instructions. It additionally requires exact `win32-hello webgl2 hello.exe` identity, no backend notes,
matching coverage game/module, **nonempty executed-code coverage** and **zero dropped code entries**. Newly created
regression temporary directories are removed in `finally` blocks.

I also ran the **pre-change `c403a4c` probe** against my own synthetic occupant using a scratch copy with only import
paths adjusted for its scratch location. It exited **0**, requested `/games/index.json`, navigated the game query URL
and logged `UNRELATED PAGE EXECUTED`. Evidence: private `baseline-ownership.json`. The fixed occupied-port tests
instead exit 1 with no requests. The scratch executable/script/output were removed afterward.

An initial focused development run had **21 passes / 1 failure** because the new assertion used `coverage.entries`
instead of the existing schema's `coverage.code`. The assertion was corrected to that actual field; no production
coverage format or existing assertion was changed to accommodate it. Final full and independent runs below pass.

## Final checks

All required gates passed on the implementation above; this handoff is documentation-only. Logs and independent
session artifacts remain private under `/Users/dev/projects/pi-work/scratch-K5d/`; nothing from the supplied
measurement bundle was copied into the repository. Commands retained the inherited sandbox/heavy-command gate.

| Gate | Result | Private evidence |
| --- | --- | --- |
| `npm run doctor` | ready | `doctor.log` |
| `npm run lint` | ESLint, real GCC, **24/24** example check-builds | `lint.log` |
| `npm run typecheck` | pass | `typecheck.log` |
| `npm test` | **540/540 tests, 47/47 files**, no skips/failures | `unit.log` |
| `BGT_REQUIRE_WEBGPU=1 npm run test:e2e` | **200 passed / 51 existing skips / 0 failures**, port **5208** | `e2e.log`, ignored `reports/e2e-results.json` |
| Every pipeline oracle, explicit 300 frames | **20/20 pass, 6,000 identical frame pairs**; null errors in both modes, zero lifted `interp_insns`, empty lifted stub lists | `oracle-*.log`, `oracle-summary.json` |
| `npm run leakcheck` / `git diff --check` | pass | `leakcheck.log` |

Browser breakdown: **WebGL 2 91 passed / 24 skipped**, **WebGPU 101/26**, **auto 8/1**. Both actual backends were
available; the 51 skips are existing backend-specific/tour/opt-in policy exclusions, not new skips or hardware
failures hidden by this change. Developer `:5173` was untouched.

Oracle inventory, generated from all example `game.json` files with a pipeline: **win32-conformance, win32-hello,
x64-audio, x64-basics, x64-contracts, x64-cpp, x64-cpprt, x64-crt, x64-gl, x64-gui, x64-handles, x64-input,
x64-memory, x64-scale, x64-smoke, x64-sysdlls, x64-threads, x64-tls, x86-handles, x86-threads**. Each was invoked as
`npm run oracle -- examples/<id> 300`; every report was re-read and checked for the stated frame count/errors/
metrics. Native **bench, gpu-readback, gpu-scenes, sample2d** have no oracle: their builds/browser tests passed.

### Fresh independent validation

A real separate session was launched through `tools/harness/pi/run-pi.sh` with **`PI_BRIDGE=0`**, not a fork or a
claimed delegation. It inspected the complete five-file implementation/test delta and independently executed:

```sh
npm test -- tests/unit/probe-server.test.ts tests/unit/kit-tools.test.ts
```

Result: **22/22 tests, 2/2 files, exit 0; PASS / no concrete blocker**. It also checked the scoped diff for whitespace
errors. Its verdict is private `review-verdict.md`; session ID **`01a191aa-7314-7453-9e4b-3d9c82c68d59`**. Broad gate
results above are developer evidence, not attributed to that independent session.

## Open items / boundaries

No open Q19 acceptance item. Parent-disconnect and forced-SIGKILL fault-injection tests would be additional lifecycle
hardening; those paths were inspected but not separately fault-injected. No real-game replay, physical-device,
remote-CI, universal browser or hostile-process authentication claim is made.
