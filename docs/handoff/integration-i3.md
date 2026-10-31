# Integration I3 — K1/K2/K3, harness and scale

## Scope / merge decisions

Kit development on `integration/p1`, starting with K1 and FIX1–FIX3 already present. No web, original/game inputs,
host Windows execution, installs, pushes, test weakening or context compaction. All new probes are original synthetic
fixtures. The operating sandbox and inherited machine-wide heavy-command gate remain in force.

Requested `--no-ff` merge order:

1. **4409379** — `lane/K2`. Resolved both known conflicts by meaning. Core keeps all K1/E/GL/kernel/USER/GDI/etc.
   registrations, both FindFirstFile invalid handles and full-width INVALID_SOCKET results. Census uses K2's complete
   ordered preprocessed registry, preserving thread/CRT/data/Win64 precedence, width and failure-only annotations;
   its table discovery also accepts K1's compact one-line/no-space declarations and unsized table array. It does not
   fall back to a second, incomplete regex inventory. Current inventories: **1,063 i386 / 1,526 AMD64 entries**.
2. **992ca15** — `lane/K3`. Automatic merge retains shared ext80 state/semantics, conservative retained-function
   analysis/metadata handling and the WASI libc selection for both widths, together with K2's memory enforcement.
3. **705405b** — `lane/LBR`. Process-owned lifecycle, queued supervision, retry/cleanup safety and heavy gate retained.
4. **1c86a9f** — `lane/LSC`. Chunk/cache/writer lifetime and verified streaming loading retained, including K2/K3 build
   hooks. No lane feature was removed to simplify integration.

Cross-lane implementation: **56bf35d**; full-suite x87 harness linkage repair **83b3608**; raw-empty-path
regression repair **d5f836c** (final implementation checked below).

## Cross-lane contracts and regressions

- **VFS:** K1 `w32_path_exists` delegates to K2's shared metadata index. Kernel GetFileAttributes uses the same query
  as PathFileExistsW and enumeration, including directory attributes and the virtual root. Queries do not open files
  or consume kernel/CRT/search slots. Tests check shipped nested assets, mkdir, named temporary file creation and
  write-size enumeration, close/rename/unlink consistency, anonymous tmpfile remaining unnamed, case/separator/root
  normalization, preserved last error and a completely exhausted kernel file table. Mutable CRT operations are
  Win64-only in this probe; i386 checks shipped/created-directory metadata and slot exhaustion without pretending
  its legacy CRT has Win64's full FILE implementation. Both run lifted and interpreted.
- **Priority:** kernel SetThreadPriority validates handles/ranges and drives K1's bounded weight hook, never refilling
  credits. GetThreadPriority preserves the requested Windows value; -15/+15 map to scheduler endpoints -2/+2, not
  host realtime. Three actual guest workers in both widths assert weighted progress, a bounded maximum gap, and
  resistance to repeated high-priority setters. Existing native tests still assert exact 1:5:3 shares and ready/parked
  exclusions. Updated the older normal-only fixture expectation to assert implemented positive priority, invalid
  value failure/unchanged state and reset, rather than retaining an obsolete failure-only contract.
- **Protection/lifter:** preserve per-page access checks and whole-CPU K3 FPU state. Non-default VirtualAlloc or
  VirtualProtect sets a monotonic global flag. Emitted whole-block span guards test it before any local mutation and
  use the checked semantic boundary once set; restoring RWX does not reenable unchecked spans. A generated-code
  regression asserts the emitted condition, an RW→read-only cross-page write fault with identical complete CPU/RAM
  state versus interpretation, and legal read-only reads through the checked boundary. Existing actual VirtualProtect
  probes also cover both widths and both execution modes. Conservative fallback is not a performance claim.
- **Harness:** reviewer questions containing “run CI” default to **2700 seconds**; ordinary decisions retain **900**.
  Explicit timeout values, including zero, win. The agent brief and trials documentation explain **15–45 minutes**.
  Deterministic store tests cover case-insensitive requests, ordinary text and explicit overrides; existing extension,
  answer/deadline race, validation and lifecycle assertions remain unchanged.

## Validation

Final implementation **d5f836c** (documentation updated afterward). All commands used the existing sandbox and
inherited machine-wide npm/npx gate. Queued commands waited for slots; no slot bypass, test timeout increase,
assertion removal or new skip. Raw logs/reviewer sessions stay private under
`/Users/dev/projects/pi-work/scratch-I3/validation/`; reports are ignored.

| Tier 1 gate | Final result / private evidence |
|---|---|
| `npm run doctor` | ready (`doctor-complete.log`) |
| `npm run lint` | ESLint, real GCC, **22/22 example check-builds** (`lint-complete.log`, exit 0) |
| explicit clang + GCC | clang 21 and `/opt/homebrew/bin/gcc-14` 14.2, `-O2 -Wall -Wextra -Werror` pass (`host-compilers.log`) |
| `npm run typecheck` | pass (`typecheck-complete.log`) |
| `npm test` | **504/504 tests, 43/43 files**, zero skipped/failing (`unit-complete.log`, exit 0) |
| `BGT_REQUIRE_WEBGPU=1 BGT_E2E_PORT=5203 npm run test:e2e` | **196 passed / 51 intentional existing skips / 0 failures**, neither backend unavailable (`e2e-complete.log`, exit 0) |
| every pipeline oracle, explicitly 300 frames | **18/18 pass, 5,400 identical frame pairs**, null errors in both modes, zero lifted interpreted instructions / empty stub lists (`oracle-complete-*.log`, `oracles-complete.exit`, `oracle-summary.json`) |
| `npm run leakcheck` / `git diff --check` | clean, **428 committable files** including final handoff/status |

Browser breakdown: WebGL 2 **89 passed / 24 skipped**, WebGPU **99/26**, auto **8/1**. The 51 skipped cases are
unchanged opposite-backend/tour exclusions plus opt-in no-adapter and injected-broken-device policy reproductions.
No GPU availability skip occurred, and the WebGPU requirement was enabled. Developer `:5173` was untouched.
This is local Chromium evidence, not a new remote-CI/physical-device run.

Exact oracle inventory (generated from every `examples/*/game.json` with a pipeline): **win32-conformance,
win32-hello, x64-audio, x64-basics, x64-contracts, x64-cpp, x64-cpprt, x64-crt, x64-gl, x64-gui, x64-input,
x64-memory, x64-scale, x64-smoke, x64-sysdlls, x64-threads, x64-tls, x86-threads**. Each was invoked as
`npm run oracle -- examples/<id> 300`, after the final full unit/browser suites so shorter unit oracles cannot
overwrite the reported evidence. All reports were re-read and checked for frame count, identical=true, null
errors, zero lifted `interp_insns` and empty stub lists. The four native BGT examples **bench, gpu-readback,
gpu-scenes, sample2d** have no guest interpreter: oracle N/A, covered by real builds/browser/known-answer tests.
Existing smoke tests retain their separate 600-loop workload and 20-frame startup comparison.

### Fresh independent validation actually performed

Three genuine fresh sessions through `tools/harness/pi/run-pi.sh`, bridge disabled (not forks/continuations):

1. `review-verdict.md`: inspected four merges + **56bf35d**, independently ran **43/43 focused tests / 4 files**,
   **PASS for bounded integration scope**. Not credited with the later full-suite repair.
2. `recheck-verdict.md`: reviewed **83b3608** and unchanged x87 assertions, independently ran **55/55 / 5 files**,
   **PASS**. This predates the final empty-path delta and is not labeled final-revision evidence.
3. `final-review-verdict.md`: independently reviewed the complete **83b3608..d5f836c** delta and executed
   **55/55 focused tests / 5 files** once (`final-review-tests.log`, exit 0), **PASS / no concrete blocker in scope**.
   Source inspection distinguished root normalization from the new runtime empty-path assertion. It did not run
   broad/browser/oracle gates; those are the integrator's separate runs above.

Focused command (global setup disabled to avoid shared-example rebuilds):
`PI_BRIDGE=0 npx vitest run --config node_modules/.cache/bgt/i3-focused.config.mjs tests/unit/integration-i3.test.ts tests/unit/x87.test.ts tests/unit/codegen.test.ts tests/unit/pi-bridge.test.ts tests/unit/sysdlls-host.test.ts`.
Private config only removes global setup; test assertions/timeouts are not weakened.

During regression development, initial probe versions exposed probe setup errors (normal i386 startup selected an
unimplemented legacy CRT path; ANSI rename was outside K2's delivered `_wrename` contract; duplicate normal-CRT TLS
symbol; and a basic block that was not span-guard eligible). They were corrected to test the actual delivered
contracts, not hidden by skips, looser assertions or increased timeouts. The corrected focused seam tests passed
before the broad gates. The first full unit gate additionally exposed undefined `x86_protection` in K3's
standalone x87 harness (**492 passed, one suite setup failure / 12 not run**). **83b3608** adds only matching
metadata/flag definitions; all x87 assertions remain unchanged and final full runs execute them. Final inspection
also caught raw empty paths being conflated with normalized virtual root; **d5f836c** rejects raw empty input before
normalization and adds an assertion in both guest widths/modes. All broad gates/oracles were rerun after that delta.
No development failure is counted as a passing run.

## Retained boundaries

K1's offline/no-DNS/no-hardware-fabrication contracts and K2's tested failure-only APIs remain explicit, not success
stubs. Mutable files are process-local, directories cannot be deleted, kernel writes are not a persistent backend.
Kernel priorities and AVRT share a bounded last-setter scheduler policy; AVRT revert restores its existing default
weight, while GetThreadPriority reports the kernel-requested value.

K3 retains exact basic ext80 arithmetic/control/storage with binary64-accuracy transcendentals and explicit unmasked
exception faults, not general Windows FP SEH or universally correctly rounded transcendentals. Metadata parsing is
bounded, not recursive UWOP semantic validation. LBR remains same-user coordination, not authentication or a newly
certified nested sandbox/Linux lockf deployment. LSC demonstrates a **1.6M-instruction synthetic fixture**, not the
7.1M target, lazy modules, mobile performance or a complete-workspace disk bound. Prior F-PERF-CRT acceptance remains
open; no integration speedup is claimed. No game startup, level, physical-device or new remote-CI claim.
