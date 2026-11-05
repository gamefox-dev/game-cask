# K33 WIP checkpoint — reviewer #296

Branch `lane/K33`, based on dev.19 `958d5f0`. This is a checkpoint, not completion or CI-ready. No game files, installs, web access, pushes, deadline changes, assertion weakening, or independent review were used. Prior WIP `9dba9cb` was pushed by the reviewer as `ci/k33a` (run `42039181319`); result is pending for the next session.

## Fixed in the WIP

- Large build child payloads cross the OS spawn boundary through anonymous regular-file descriptors. Node script arguments use `node-args.mjs`; compiler/linker plans use response files; JSON uses finite regular-file stdin. `command.py` enforces a portable Linux budget before every child spawn, including environment accounting. `lift.py` now uses the same transport for x86tool lift tasks.
- Asyncify keeps the complete removelist. Chunk/pipeline owner and override sets use `--select`/`--skip-file`; task plans remain finite stdin. Asyncify cache identity includes the transport helpers.
- Regressions cover oversized Node/compiler/lift argv, Unicode/quotes, finite stdin, lock/deadline/failure cleanup, nested supervision, and cache-key transport identity. The transport-only suite passes 14/14; focused transport/lock/cache/host-GCC tests pass 24/24.
- GCC14 and clang compile the actual GL native adapter with CI-style flags. `check-host-gcc.mjs` covers x86tool, both heap widths, GLSL, and GL adapter. Local GCC14 and clang checks pass; unversioned `gcc` on this macOS host is Apple clang.
- Warning-only portability edits repair GCC misleading-indentation and signedness diagnostics without changing control flow. The unchanged partitioned convergence case previously passed in 173,803 ms under its unchanged 180,000 ms deadline.
- Approved CI fan-out is implemented: lint/doctor/leakcheck/typecheck/ESLint, native lint, example check-builds, two deterministic unit shards, e2e, unchanged scale, and a required aggregate gate rejecting every failure or skip. Lint-js installs Chromium because doctor checks for it.
- `tools/build/ci-unit-shards.mjs` derives files from Vitest list output and verifies the shards plus scale's `build-chunks.test.ts` equal the full `npm test` file set. Local inventory: 66 + 65 = 131 files.

## Local evidence

Ignored logs are under `reports/k33/`; `BGT_E2E_PORT=5278`; port 5173 was not used.
- Doctor, typecheck, ESLint, GCC14 native checks, and clang native checks: exit 0.
- Focused transport/lock/cache/host-GCC: 24/24, exit 0. Transport-only after the lift change: 14/14, exit 0.
- Shard helper syntax, shard union, and full-vs-CI-plus-scale coverage check: pass.
- Full `BGT_TEST_JSPI=1 npm test -- --maxWorkers=1` was still running at checkpoint. No final result is claimed; rerun after resuming because it began before the final lift-test edit.
- Full e2e in both suspension modes, leakcheck final/negative control, every 300-frame oracle in both modes, and final scale evidence remain open. No CI-ready commit is claimed.

## WIP state and next steps

The working tree contains the post-`9dba9cb` fixes and this checkpoint; commit them before ending this session. The reviewer, not this lane, pushes CI branches.
1. Inspect the WIP commit and collect `units-jspi-final.exit` plus CI run `42039181319`; preserve failures as evidence.
2. Rerun focused tests after final edits, then full units in required modes.
3. Run Asyncify and JSPI browser matrices serially on port 5278, with WebGL2, required WebGPU, and auto as prescribed; run leakcheck including its negative canary.
4. Run unchanged scale checks and every pipeline example oracle at exactly 300 frames in both modes; audit counts, hashes, errors, exit status, and stubs.
5. Address Linux CI failures only within ownership, commit each repair, and ask the reviewer before requesting another CI run. Do not push.
6. After all gates pass, write `docs/handoff/K33.md` with evidence and commit list and obtain fresh independent validation if available.
