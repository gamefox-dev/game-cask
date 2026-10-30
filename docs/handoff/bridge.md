# Lane G — pi reviewer bridge

## Result / finish line

Complete, engine-agnostic; no ABI/runtime changes or new dependencies. Commit subject:
`feat(harness): bridge reviewer signals and questions to pi lanes` (the containing commit is the handoff).

- `tools/harness/pi/bridge/server.mjs`: Node loopback-only service, private atomic-renamed JSON state per run,
  per-lane status, two-direction question queues, idempotent first-answer-wins answer log, persisted event cursor.
- Workspace `extension.js` + `extension-core.mjs`: turn/agent status, actual host context and session cost/model,
  last tools/HEAD/errors, boundary steering and NEXT-text answer capture, cancellable `ask_reviewer` with explicit
  default/timeout. Uses `agent_settled`, not premature `agent_end`, for finished signals.
- `cli.mjs` / `client.mjs`: compact status, live/fork questions, logs/answers, blocking one-line event wait with
  lane filtering, context thresholds, stalled-turn detection, timeouts and cursor support.
- Fork mode snapshots only complete records on the last published active branch; invokes pi `--fork COPY
  --no-tools`, disables discovered resources and deletes temporary copy. Original session is never opened to write.
- Driver loads bridge exclusively via workspace `-e`; copied trial/lane briefs automatically include the new
  shared `bridge/agent-brief.md` template (real decisions only, never routine confirmations).
- Sandbox still allows localhost and now explicitly denies global pi-agent writes even if caller mis-scopes
  the isolated agent directory. No global pi installs/settings/extensions/npm changes were made.
- Bash 3.2 launcher: independent remote-free clones/branches, copied installed dependencies without shared caches,
  distinct decimal ports, per-lane scratch/credential directories, file-composed briefs, one persistent bridge.
- `docs/trials.md`: reviewer/agent operations, lifecycle/privacy/restart semantics, launcher and test instructions.

## Validation evidence

Logs are private in `/Users/dev/projects/pi-work/scratch-G/`, not committed:

| Gate | Result | Evidence |
|---|---|---|
| `npm run doctor` | ready | `doctor-final.log` |
| `npm run lint` | clean, all example checks pass | `lint-final.log` |
| `npm run typecheck` | clean | `typecheck-final.log` |
| `npm test` | **120 passed / 18 files** | `unit-final.log` |
| bridge-only unit suite | **24 passed** | `bridge-unit-final.log`; also included in npm test |
| `npm run test:e2e` | **81 passed, 4 existing skips**, WebGPU/WebGL2/auto | `kit-e2e-final.log` |
| eight explicit 300-frame oracles | **8 identical; lifted/interpreted errors null** | `oracles-final.log` |
| `npm run test:bridge-e2e` | **5/5 passed**, real installed pi, thinking low | `bridge-e2e-final.log` |
| `npm run leakcheck` | **233 committable files, clean** | `leakcheck-final.log` |
| `git diff --check`, Bash syntax | clean | final shell checks |

Oracles: `x64-basics`, `x64-cpp`, `x64-cpprt`, `x64-crt`, `x64-gui`, `x64-memory`, `x64-tls`, `win32-hello`,
via `npm run oracle -- examples/<id> 300` for each.

Real-model output summary (`cpa/gpt-6.1-sol`, 2 assistant steps):

```text
PASS status updates arrived
PASS fork question answered from no-tools session copy (original unchanged)
PASS live question answered
PASS ask_reviewer received reviewer answer
PASS wait --for finished exited
bridge e2e: 5/5 passed model=cpa/gpt-6.1-sol steps=2
```

Artifacts: `scratch-G/e2e/run-YWhpym/`. Explicit existing provider loaded with `PI_PROVIDER_EXTENSION`; the bridge
loaded from the workspace via driver `-e`. Isolated HOME/auth/models/session state, no global installs or changes.
The initial attempt without the cpa provider failed model lookup; explicitly loading the already-installed provider
resolved it. An initial concurrent build/oracle attempt hit a Zig frontend crash; serialized final oracles all pass.
Do not overlap build-heavy checks against the same clone's generated files/caches.

Fresh independent pi validation ran as session `01a18d85-e1cb-739b-8829-3fcb7972fa65` (`scratch-G/review.txt`).
It inspected all requested bridge paths read-only, did not claim to run tests, found **no blocker**, and reported
one low-severity decimal-port alias issue. Fixed by rejecting leading zeros for bridge/lane ports, with a regression
in the 24-test bridge suite. No remaining reviewer findings. This was a real separate model session, not self-review.

## Ownership exception

Only `package.json` is outside lane ownership: two required npm scripts (`bridge`, `test:bridge-e2e`) and a JSON
annotation containing `/* LANE-G */`. No dependency/lockfile changes. Tests/fixtures and this requested handoff are
lane-owned additions. Did not edit `docs/v03-status.md` or `docs/verification.md`.

## Operational limits / next lane

No open finish-line issue. Same-user localhost service, not authentication/isolation; never expose it remotely or
run untrusted local workloads beside it. Exactly one server per state directory; atomic rename survives process
restart, not a promised power-loss/multi-writer database. Live delivery can repeat after a crash; answer IDs are
idempotent. Fork observes the last published boundary, not an in-flight response. Finished means settled, not that
acceptance checks passed. Normal browser skips remain unchanged. Actual nested macOS seatbelt execution and Linux
container provisioning were not exercised; launcher/driver/isolation contracts have no-model regression coverage.

For review wakeups use `npm run --silent bridge -- wait --for question,finished,error,stalled,context:60` to suppress
npm's header. Existing finished/context conditions are level-triggered; filter to active lanes when resubscribing.
The launcher leaves the bridge alive for final status/fork review; stop the PID in `<run>/bridge.pid` afterward.
