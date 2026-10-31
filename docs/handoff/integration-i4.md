# Integration I4 — K5c merged, tier 1 green

## Commits and scope

- Branch **`integration/p1`**, no push.
- **`86f6c30`**: `--no-ff` merge of `lane/K5c` (`ef6924b`) onto `0063f43`, which already contains K5a/K5b/K5d.
- **`e7f9eca`**: integration regressions/repairs described below. Final broad gates ran on this implementation;
  this handoff is a documentation-only follow-up.
- Sandbox retained; no web, game inputs, dependency/system installs, original-binary execution, test weakening,
  or use of the developer's `:5173`. Browser gates owned **port 5209**. No context compaction.

## Meaning-based conflict resolution

The only textual conflict was `bgt/runtime/runtime.ts:coverageSnapshot`. Both contracts remain:

- K5b: consumed/observed packaging `files`; separate speculative `readAhead`; exact `crtConsumedBytes`,
  `crtObservedBytes`, `crtReadAheadBytes`, and `crtReadAheadRequests`. Fetch/download bytes remain a different counter.
- K5c: actual entry addresses/kind union, explicit dropped events, and `metrics.execution` from the host (null when
  unavailable), alongside existing frame/error/outside-slice/render-completion evidence.
- Auto-merged host/headless plumbing preserves deferred read-ahead, manifest chunk metadata, observed dependencies,
  the 1,048,576-address bounded recorder, and half-open strict code ranges.

Added `tests/unit/coverage-snapshot.test.ts`: real VFS consumed/observed/speculative ranges plus deliberately labeled
execution sentinels verify serialization retains both contracts without promoting speculation into packaging.
Updated the stale ABI coverage prose to match implemented entry granularity, cap/drop handling and owning ranges;
no import/layout/signature change.

## Semantic integration findings, both fixed

1. **String quantum census.** Independent source review found K5a's inner string quantum check can suspend before
   its first iteration at initial budget 1,999,999; K5c nevertheless counted interpreted execution. A new real-dispatch
   regression reproduced `interp_insns=1` when zero was required (`boundary-before.log`). The shared runtime now saves
   per-dispatch evidence locally, excludes same-IP string transfers without iteration progress, and still counts
   partial REP and completed zero-count REP dispatches. Both widths test REP/non-REP at budgets 1,999,999/2,000,000,
   resumption, partial execution at 1,999,998, exact counters, indices and destination bytes. Ordinary accounting,
   reentrant AMD64 ownership and strict unowned-gap checks remain green. Fixture addresses are stable because the
   runtime intentionally caches decoded code.
2. **Outgoing AMD64 dispatch coverage.** The first focused integration run stopped the existing CRT strict replay at
   **0x00b00130**, an import thunk. K5c recorded every indirect region lookup before checking membership, including
   destinations the region did not execute. The lifter now records successful block cases and recognized interior
   landings only; outgoing targets are left to their actual guest handler (profile thunks are not guest code entries).
   Added a CRT assertion rejecting pseudo-thunk addresses from guest coverage; the original strict replay assertions
   remain intact and pass. Actual interior/region entries and selective convergence still pass.

`tools/x86/x86tool.c` retains **all seven** K5a string-helper arguments and immediate transfer return, together with
K5c's actual `X.eip` continuation recording and owning-range analysis metadata. The generated-lift known-answer
string tests, not merely a textual inspection, passed on both widths and execution modes.

## Focused and final evidence

Final focused run: **33 tests / 5 files passed**, no skips/failures: `strings`, `coverage`, `coverage-snapshot`,
`crt-read-ahead`, `crt-buffer`. This focused config omits only global example rebuilding; the final default suite
below ran unmodified. Earlier red diagnostic runs are retained, not counted as green gates.

All final broad commands ran **serially** through the installed machine-wide FIFO npm/npx gate; no implementation
edits occurred during them. Compiler evidence: **Apple clang 21.0.0**, real **GCC 14.2.0**. No ENOSPC.

| Gate | Result |
|---|---|
| `npm run doctor` | ready |
| `CC=clang npm run lint` | ESLint, real host GCC check, all **24** clang/Zig example check-builds pass |
| `npm run typecheck` | pass |
| `npm test` | **573 passed / 52 files**, zero failures/skips |
| `BGT_REQUIRE_WEBGPU=1 npm run test:e2e` | **200 passed / 51 existing intentional skips**, zero failures/flaky |
| WebGL 2 / WebGPU / auto | **91/24 skipped**, **101/26 skipped**, **8/1 skipped**; both GPU backends ran |
| `npm run leakcheck` | clean; rerun including this handoff |
| Every pipeline CLI oracle at 300 frames | **20/20**, **6,000 identical frame pairs** |
| `git diff --check` | clean |

The browser exclusions retain the existing backend/tour/opt-in policy; no unavailable-backend skip substitutes for
WebGPU execution. Oracle reports were generated **after** unit/browser suites so their 300-frame evidence remains
current. Every report has both errors null, lifted `interp_insns=0`, empty profile/GL stub lists, and success status.
Inventory: win32-conformance, win32-hello; x64-audio, basics, contracts, cpp, cpprt, crt, gl, gui, handles, input,
memory, scale, smoke, sysdlls, threads, tls; x86-handles, threads. Native bench/gpu-readback/gpu-scenes/sample2d have
no interpreted counterpart: their build/browser coverage is not labeled a differential oracle.

Current regenerated synthetic measurements:

- CRT mixed fixture: **49 updates**, **39 read-ahead requests**, **262276 consumed**, **2 observed**, **327899
  read-ahead bytes**; 300-frame oracle identical; CR/non-LF cross-chunk strict replay and I/O-error checks pass.
- Discovery's same eight-frame 70,000-NOP workload: interpreted instructions **70032 → 70003 → 0**; distinct
  interpreted owners **2 → 1 → 0**; recorded unique entries **9 / 7 / 280**; **zero drops** throughout. Trace hashes
  match; selective and strict replay pass. These are synthetic fixtures, not private-game convergence claims.

Ignored evidence: `reports/e2e-results.json`, `reports/crt-buffer.json`, `reports/coverage-discovery.json`, individual
`reports/oracle-*.json`, and validated `reports/integration-i4-oracles.json`. External scratch is
`/Users/dev/projects/pi-work/scratch-I4/`: `tier1-progress.log`, `doctor.log`, `lint.log`, `compiler-versions.log`,
`typecheck.log`, `test.log`, `e2e.log`, `leakcheck.log`, `oracle-*.log`, `oracle-summary.log`, focused/boundary logs.
The obsolete initial focused run overlapped development; only final focused/default-suite results certify the repair.

## Independent review and boundaries

Two **actual fresh independent pi sessions** ran with the bridge disabled, not a claimed delegation:

1. Read-only semantic review found the string/census defect; snapshot, FILE plumbing and emitter-call arguments
   were otherwise accepted by source inspection (`review.md`). It ran no tests.
2. Fresh recheck independently ran **four real-dispatch tests** (both-width quantum/accounting, gap/strict-stop and
   reentrant-owner coverage), all passed, and reported **PASS within focused scope** (`recheck.md`). It also inspected
   the outgoing-dispatch fix but did not execute that generated emitter/CRT workload. The developer's 33 focused
   tests and full tier-1 gates supply that execution evidence, not invented independent broad-suite approval.

No remaining I4 integration blocker. K5b's same-FILE concurrent-access/scheduler boundary, C/ASCII locale, bounded
FILE resources, K5c's finite recorder/function-range packaging, and other lane limits remain unchanged. No real-game,
Windows-native universal parity, physical mobile, Safari or Firefox certification is claimed.
