# K33 WIP checkpoint — reviewer #290

Branch lane/K33, base dev.19 958d5f0. **Not green; not ready for CI.** Reviewer requested checkpoint/end at ~150k context. No compaction, web, installs, game files, pushes, deadline changes, assertion weakening or independent review. Many transient API retries preceded actual work; no earlier finished implementation exists.

## Read / diagnosis

Read AGENTS.md/CLAUDE.md, docs/v03-status.md, docs/pipeline.md, workflow and K22/K23/K28 handoffs (large tool output was truncated; consult original files for details). Inputs read-only: /Users/dev/projects/pi-work/inputs/ci/ci-dev18.log and ci-dev15-failed.log.

- **E2BIG confirmed:** build.mjs puts native Asyncify removelist in one argument; old ceiling180000 > Linux131072. compile.py spawns Node with it; asyncify.mjs repeats it for whole-module/partition Binaryen runs; exec.mjs also repeated whole child argv in writer.py argv. Chunk/monolithic override skip sets were comma-separated argv; selected owner lists already files. Chunk task arrays/compiler plans already finite stdin via K23 transport. Link object lists can exceed total argv too. No build-owned large env payload found; ambient environment still needs bounded diagnostics/coverage.
- **Lint:** package script is eslint + check-host-gcc + serial build.mjs --examples --check. Log elapsed ~30 minutes is full wasm generation, compile/link and Asyncify of ~37 examples, not ESLint, nor serial clang+gcc syntax checks. Cold GCC host helper covers only x86tool, heap widths and GLSL frontend; it **misses actual GL profile native driver**. CI sample builds repeat work (objects/Asyncify caches help). Need cheap bounded example parallelism or prepare better cache reuse, preserving every build.
- **GCC:** /usr/bin/gcc is Apple clang21; real /opt/homebrew/bin/gcc-14 is GCC14.2.0 and available. Actual GL native test flags (-std=c11 -O1 -Wall -Wextra -Werror, include bgt/x86/win32, native driver) expose ~40 distinct misleading-indentation locations across GL sources/headers/native driver plus macro repeated225 times; two signedness warnings. Historical ci-dev15 exhibits same class. Existing check-host-gcc passes but insufficient.
- **Coverage convergence:** partitioned case211949ms exceeds its180000ms deadline. Logs show repeated16-shard transforms at65536-byte test partition size. No root-cause timing repair yet. Keep >65k workload/all variants/real recordings/assertions/deadline unchanged. Heap OOM tests repeatedly build lifted/interpreted tiny variants; log examples30–45s each, historical180–380s. No optimization yet.

## Approval #289 (ask_reviewer)

Reviewer approved parallel required lint, unit (2 deterministic shards), e2e, existing scale unchanged; required aggregate test gate depends on all and rejects **any failure or skip**. All coverage/deadlines/assertions unchanged; retain leakcheck negative check, doctor and typecheck. Safe shared object-cache reuse desirable. Still fix cheap root cause of serial lint. **Workflow has NOT been edited.** Do not ask routine approval again; ask before other deadline/gate/structure changes.

## Partial implementation in this checkpoint

- exec.mjs supplies command vector via anonymous regular-file fd3 to writer.py, independent of existing finite stdin. Writer retains process-group/token/deadline protocol.
- New command.py shared by writer.py and compile.py: large Node script arguments via private JSON file and node-args.mjs reconstruction after OS spawn; large GCC/Clang/Zig args via properly quoted response file; rejects OS argv/env above131072/string or1MiB total. Small commands unchanged. Threshold64KiB/string or256KiB total. Covers Asyncify whole + canonical partition lists and linker object lists. Needs careful regression/mutation review, response-file quoting tests, environment/cleanup tests. Temp files are context-managed but supervisor SIGKILL can leave named temporary dirs (known WIP concern; finite anonymous fds preferable if practical). Every command currently allocates a temp directory even small commands: optimize this avoidable cost.
- build.mjs removed old180k truncation/fallback; now keeps full exact removelist (no unsafe partial list).
- chunks.mjs and pipeline.mjs write override sets as --skip-file; x86tool.c accepts this additive option. Existing --skip kept. Selected owner lists already files; JSON task batches stdin unchanged. Need regression proving huge skip list equality/cache semantics.
- GL indentation edits separate unguarded statements without changing control flow; macro API return separated on continued line. One integer texel branch explicitly unsigned, preserving existing promotions. **GCC portability edits incomplete**: latest gcc-gl-after.log still reports w32_gl_shader.h216 second release and w32_gl_draw.h497 ternary signedness (check remaining log). Avoid warning suppression or broad formatting; run exact GCC tests and compare token semantics. An automated first edit accidentally added blank lines to225 w32_gl_api.h invocations; it was fully restored from HEAD, no delta retained there.

## Running / completed local evidence

Ignored local directory **reports/k33/**; preserve logs (not committed). BGT_E2E_PORT=5278 from environment; :5173 untouched. Sandbox forbids ps. Background command launched with nohup root PID **94132**:

    npm run doctor > reports/k33/doctor.log
    npm test -- tests/unit/build-transport.test.ts tests/unit/build-lock-transport.test.ts tests/unit/suspension-scale.test.ts tests/unit/coverage.test.ts --maxWorkers=1 > reports/k33/focused.log

Writes *.exit after each. Doctor exit0. **focused.exit absent at checkpoint**, last log successive coverage lifted70005 instructions; may still be building. It began before later GL edits and lacks any new regression test (none written yet). Do not duplicate it; inspect marker/tail first. No build/e2e suite deadline altered. New files only got node --check / Python py_compile (pass); own __pycache__ removed. git diff --check passed.

Background root98574 completed GCC probes: gcc-host.exit0, gcc-gl.exit1 (before edits). GCC host helper uses real GCC discovery independent of CC. Syntax-only actual GL flags after edits: gcc-gl-after.exit1. Detailed logs gcc-gl.log (large, compact filter!), gcc-gl.json, gcc-gl-after.log. These are failures, not successful validation. No full build proof for partial edits yet.

## Exact next steps / unrun gates

1. Read this checkpoint, inspect git status/log, focused.exit/tail. Finish GL warning-only edits; compile both driver variants with real GCC flags and full existing native tests (CC=gcc-14), then clang. Extend lint coverage to actual GL native adapter so future CI catches these before unit runtime. Existing tests/unit/host-gcc.test.ts asserts exact four helper calls; update truthfully if extending. Check **every kit C source applicable flags**, not just current helper.
2. Add portable before/after regressions enforcing Linux argv bounds at actual spawn boundaries, including compile.py→Node and nested Asyncify, >128KiB removelist, total-large link/source/chunk plans, Unicode/quotes, skip sets, stdin preservation, locks/deadlines/failure cleanup. Fix new transport defects; test both small path and file path. Existing transport tests verify nested group ownership/guardian lifetime/timeout diagnostics and must stay green. Need include new transport implementations in asyncify cache key if semantics require it (current key hashes asyncify/runner/sections/names but not new node-args/command helper).
3. Measure partition test setup/transform work and OOM cases. Optimize redundant build/discovery/transform overhead, never deadlines/assertions. Current coverage build() does ordinary Asyncify then overwrites with forced partition transform every build, including rejected/strict stages; investigate safe reuse without dropping partition coverage. Target unchanged180s.
4. Implement approved CI structure#289, exact coverage audit + deterministic Vitest shards, aggregate failure/skip protection, safe shared cache and bounded parallel lint if cheap. Scale job unchanged, including native checksum/browser/oracle300.
5. Commit implementation/test chunks. Reviewer alone pushes ci/k33*; request CI with ask_reviewer (45-minute default for please run CI), iterate to all required jobs green. No pushes here.
6. Full local Tier1 **not run**: doctor final, ESLint + clang/GCC lint all check builds, typecheck, uninterrupted npm test with real JSPI, npm run test:e2e both backends+auto in both suspension modes (BGT_REQUIRE_WEBGPU as required), leakcheck including negative control, every pipeline fixture×both suspension modes×300 oracle frames with requested/compared/hash/error audit. Run suites in background, compact logs. Need fresh independent validation (none run).
7. Final docs/handoff/K33.md plus compact evidence and commit list; final <200words. This is only a WIP checkpoint, not completion.
