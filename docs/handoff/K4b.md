# K4b — report and oracle tooling (Q12, Q13, Q14)

Implementation commit: **115f7e7** (`fix(tooling): persist oracle failures and bound report privacy scans`).
This is generic kit tooling, not a game compatibility or playability claim. No `platforms/` changes, game files,
private trial measurements, new dependencies, system installs, web access or pushes.

## Delivered contracts

### Q12 — durable oracle failures

- `tools/report/oracle-report.mjs` shares failure construction/writing between the CLI and oracle. The CLI replaces
  stale success evidence before starting its child, catches setup/runner failures, preserves specific child failure
  reports, and records the actual nonzero child exit status. Build failures identify the lifted/interpreted build stage.
- `tests/oracle/oracle.ts` catches preflight load/first-step errors and both modes' load/startup/execution failures.
  Reports include `failureStage`, `error`, `exitStatus`, `requestedFrames`, and `comparedFrames`.
  **`frames` now means completed compared frame pairs**, not the requested workload; successful reports are unchanged
  numerically. Every completed pair is compared, retaining the first divergence. Failure never becomes an identical
  zero-frame result; no completed hashes are represented by **null**, not fabricated equal hash strings.
- The existing `errors: {lifted, interpreted}` shape remains compatible. Preflight errors populate `errors.lifted`
  as well as the top-level error so existing trial-record extraction retains the error. Available execution-failure
  metrics are retained. A process that never reaches/completes its test leaves a failed runner report, not stale success.
- Original **CC0 AMD64 PE fixture**, `tests/oracle/fixtures/startup-abort.c`, dynamically resolves CRT `abort` and aborts
  before completing the first update. The CLI regression seeds a stale success, builds both modes, and asserts process
  exit 1, `preflight-step`, requested 300 / compared 0, `identical:false`, null hashes, and the actual CRT abort error.
  The PE is only executed by the kit, never on the host. Generated fixture assets are cleaned in `finally`.

### Q13 — bounded privacy scans without opaque-token bypass

- Email scanning consumes each maximal local-part run once and anchors domain matching at its following `@`.
  It no longer retries every suffix of a large no-`@` token. Domain scanning revisits intervening segments only a
  bounded number of times. Both `findSensitive` and `redact` share this matcher.
- **No blobs are skipped or removed before secret checks.** All existing secret, email, home/user path, blob and
  hex-dump detection rules remain. Existing detection/redaction allowlists deliberately retain their distinct behavior.
  Leakcheck uses the unchanged shared secret patterns and retains embedded-secret detection.
- Regressions cover 100k and 500k tokens (scan + redact each <750 ms), long invalid domains, email overlap/allowlists,
  every existing secret kind embedded in large data, embedded paths/emails, leakcheck, and canonical Playwright JSON
  with 81 inline attachments and a 500k-character body. JSON outcomes/stats survive redaction.
- Local post-suite samples, **not a universal benchmark**: 100k scan+redact **2.46 ms**, 500k **6.31 ms**;
  actual unmodified Playwright `e2e-results.json` **3,935,651 chars / 204 findings / 580.55 ms**, including redaction and
  reparsing. Raw reports remain private; no measurement input or report content is published here.

### Q14 — truthful test-tooling iteration queues

- `layer:"test"` is accepted for `status:"iteration-request"`. Game-layer iteration requests remain invalid;
  `authentic` still requires game layer. Evidence must contain nonblank strings, and `next` must be a nonblank action.
- Synthetic three-item queue exercises oracle/privacy/schema tooling gaps without copying the private input queue.
  Regressions also reject game requests, missing/blank evidence, blank action and non-game authenticity.
- Reviewer explicitly approved two minimal ownership exceptions: correcting the old contradictory negative assertion
  in `tests/unit/kit-tools.test.ts` (now uses invalid `bogus` layer and explicitly accepts `test`), and adding the two
  new owned suites to default Vitest includes with a LANE-K4b marker. CLI selects only its oracle entry test so new
  CLI regressions cannot recurse through its config. No existing assertions were removed or weakened.

## Verification on implementation 115f7e7

All checks below exited **0**, inside the sandbox; browser server owned **BGT_E2E_PORT=5204**, never `:5173`.
Logs and raw reports are ignored under `reports/k4b/` and `reports/`.

| Gate | Result |
| --- | --- |
| `npm run doctor` | ready |
| `npm run lint` | ESLint, real GCC host check, **22/22 example check-builds** pass |
| `npm run typecheck` | pass |
| `npm test` | **522/522 tests, 45/45 files**, zero failed/skipped; baseline 504 + **18 new regressions** |
| `BGT_REQUIRE_WEBGPU=1 npm run test:e2e` | **196 passed / 51 unchanged intentional skips / 0 failures**; both backends available |
| `npm run leakcheck` | pass; **432 committable files** before this handoff |
| `git diff --check` | pass |
| All pipeline oracle CLIs, explicitly 300 frames | **18/18 pass, 5,400 identical frame pairs**, requested=compared=frames=300, exitStatus=0, stage/error null, both mode errors null, lifted interp_insns=0 and empty stub lists |

Exact pipeline inventory: **win32-conformance, win32-hello, x64-audio, x64-basics, x64-contracts, x64-cpp,
x64-cpprt, x64-crt, x64-gl, x64-gui, x64-input, x64-memory, x64-scale, x64-smoke, x64-sysdlls, x64-threads,
x64-tls, x86-threads**. Each ran `npm run oracle -- examples/<id> 300` after the full suites so shorter unit
oracles cannot overwrite final evidence. Four native BGT examples (**bench, gpu-readback, gpu-scenes, sample2d**)
have no interpreter oracle; covered by builds/browser tests. Existing smoke unit workload still runs 600 measured
frames plus startup comparison; it was not reduced.

## Fresh independent validation

A separate fresh pi session through `tools/harness/pi/run-pi.sh`, `PI_BRIDGE=0`, reviewed the delta and ran
**18/18 new tests** plus the existing startup-only GPU divergence regression (**1/1**). It also checked 10,000
email cases against the former regex/allowlists, and additional long-input timings. **PASS / no concrete blocker**.
No implementation edits by the validator. Its verdict and command evidence are private in the assigned scratch
`validation.md` / `validation-result.txt.d/`, not attributed as broad gate evidence. Developer separately checked
100,000 deterministic short email cases against the old matcher. Broad gates above are developer-run evidence.

## Open items and limits

- No open Q12/Q13/Q14 tooling item. Porter must rerun its actual startup after integration; no original game was
  available to this lane, so only the synthetic abort fixture is claimed here. Q10/Q11 and engine-scale runtime
  compatibility are other lanes' responsibilities.
- Report writes can only succeed when the filesystem is writable and has space. No ENOSPC occurred; free space
  stayed above 20 GiB. Fixture test temporaries are cleaned; reusable kit caches and private verification evidence remain.
- Browser evidence is local Chromium, not physical-device/Safari/Firefox verification. No new skip policy.
