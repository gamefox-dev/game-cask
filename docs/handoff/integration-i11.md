# Integration I11 — K18 over K17a/K17b/K16a + K19

## Delivery and merge resolution

Branch `integration/p1`. **c59d4ab** is the requested `--no-ff` merge, parents **ef8ab6b** and
**f1c36f3** (`lane/K18`). Final tested implementation/test tree is **8fa70b9**; subsequent changes
only finalize documentation/evidence. Only `docs/v03-status.md` conflicted; retained both histories.
All implementation files auto-merged and **no integration production repair was needed**.

Semantic audit:

- K18's loader selects/verifies the requested artifact and awaits JSPI update boundaries before render;
  K19's recorder still installs before startup and snapshots before native draw/consume, with deferred resize
  and rejection/readback cleanup intact. Disabled recording retains its synchronous dispatch path.
- `package.json` retains both `probe:replay` and `bench:incremental`. K19's probe/driver/recorder/replay and
  renderer files are unchanged from ef8ab6b; no older lane copy replaced them.
- K18's compiler-discovered dependency keys include merged runtime/ABI/profile inputs, including
  `w32_gl_buffer.h`, `w32_gl_shader.h`, `x86_guest.h`, `x86_profile.h`, `x86_host.h` and `bgt_gpu.h` where
  actually included. The external dependency audit verifies every recorded dependency hash against disk.
  K19's TypeScript is consumed by Vite, not a C-object input: no wasm cache may substitute for renderer loading.
  The full browser runs exercise those actual merged TS files. Runtime-only edits retain lifted-object caches.
- K17a's builtin/offset/overload/WGSL const repairs, K17b's counted element-storage/map/flush/unmap behavior
  and strict VAO0 attribute/draw errors, and K16a's bounded shared host allocator remain unchanged.

New original CC0 `tests/e2e/recording-variants.spec.ts` records a yielding win32-hello guest from startup
under both actual artifacts on each native backend. It asserts selection (not silent fallback when built),
updates0..5, yields, zero errors, exact recorded commands/uploads/metadata, state hash and pixels across modes.
This is integration coverage, not a claimed failing-before production fix. Existing resize atomicity,
public CLI complete-footer, disabled-path and sink-rejection regressions also remain in the suites.

## Final merged-source gates

One serialized background sweep completed **46/46 steps exit0**, source **8fa70b9**, initial diff empty.
Evidence root: **/Users/dev/projects/pi-work/scratch-I11/**; `run-gates.py`, `driver.log` and
`gates/{commit,diff,plan.json,status.json,done}` pin actual commands and results; `done=PASS`.
No exclusions, retries, assertion/tolerance/skip/dependency/admission changes. CLI unit budget is K18's
existing long-run recipe, not a committed deadline change. No failed gate occurred in this sweep.

| Gate | Command / observed result |
|---|---|
| Doctor | `npm run doctor` — ready, Node24.19.0 / Zig0.13.0 / Chromium installed |
| Lint | `npm run lint` — ESLint, real GCC14 host checks, **34 example check-builds**, exit0 |
| Explicit clang companion | `npm exec -- node ../scratch-I11/check-clang.mjs` — same host checks with clang, exit0 |
| Typecheck | `npm run typecheck` — exit0 |
| Full units | `BGT_JSPI=1 BGT_TEST_JSPI=1 BGT_BUILD_JOBS=2 npm test -- --maxWorkers=1 --testTimeout=600000` — **1,976 passed /98 files /no skips** |
| Focused native browser | jspi + runtime-recording + recording-variants specs — **10/10**, both backends, no skips |
| Full default browser | `BGT_JSPI=1 BGT_REQUIRE_WEBGPU=1 BGT_E2E_PORT=5261 npm run test:e2e` — **285 passed /51 existing skips /0 failures /0 flaky** |
| Full JSPI browser | same with `BGT_E2E_SUSPENSION=jspi` — **285 passed /same exact 51-skip inventory /0 failures /0 flaky** |
| Per-mode projects | WebGL2 **128 pass /24 skip**, required WebGPU **149/26**, auto **8/1** |
| Leakcheck | `npm run leakcheck` — **713 committable files**, exit0, before final documentation |
| Every pipeline oracle | **31 examples ×300 =9,300 identical pairs**, Asyncify runtime |
| Additional JSPI oracles | x64-crt + win32-hello ×300 =**600 identical pairs**; full trace digests equal across variants |

All33 oracle JSONs were audited: requested/frames/compared300, identical=true, exitStatus0,
error/failureStage/firstDivergence null, both execution errors null, equal final hashes and full trace digests;
lifted interp_insns0, stubs[] and gl_stubs[]. Four native BGT examples do not acquire fictitious interpreter oracles.
The two explicit `BGT_JSPI=0` builds prove default manifests contain only Asyncify; later opt-in builds for
both fixtures produce hash/size-verified JSPI artifacts and byte-identical default Asyncify artifacts.

`verify-results.py` checks gate/report/variant invariants and writes `gates/verified-summary.json`.
This is an audit script, **not an independent agent review**. Browser result JSONs were copied immediately
before the next run; no overwritten report is substituted. Main browser port5261, native audit5262, probe
owns its free port; developer5173 untouched. Background jobs completed normally.

## Incremental benchmark — merged runtime stays fast

Reproduction:

```sh
BGT_JSPI=1 BGT_BUILD_JOBS=2 BGT_BENCH_FUNCTIONS=15000 \
BGT_BENCH_ID=i11-scale-15000 BGT_BENCH_REPORT=reports/i11-benchmark.json \
npm run bench:incremental
```

Original CC0 fixture: **2,011,529 instructions /62 chunks /93 objects**, no overrides; same clone,
shared Mac arm64 host, 16GiB, jobs2. New fixture (not an empty object/toolchain/OS cache).

| Scenario | Outer wall | Compiled /cached /uncacheable |
|---|---:|---:|
| New fixture, reused runtime objects | **611.116s** | **64 /29 /0** |
| Unchanged | **6.633s** | **0 /93 /0** |
| Unique fresh runtime-header comment | **14.849s** | **23 /70 /0** |

Both warm phases reuse analysis and **all62 lifted chunks**; no lifting/C-generation work is redone.
The header is restored byte-exactly, confirmed by clean final tracked status. All three Asyncify hashes
match; all three JSPI hashes match. Runtime-only remains bounded/fast versus K18's historical dev.11
**321.965s** baseline and near its final14.525s observation; these are shared-machine observations, not
normalized idle/cold comparisons or guest-speed claims. Raw `gates/benchmark.json` retains phase timings,
physical headroom, load, disk, RSS, timestamps and hashes; compact results are in
[integration-i11-evidence.json](integration-i11-evidence.json).

## Native shader audit and review attribution

Fresh author-run audit on the merged tree rebuilds the actual C frontend, canonicalizes16 raw fragments,
and compiles **120 unique stages (53 vertex /67 fragment) on each of WebGL2 and WebGPU:120/120, zero errors**.
Inventory includes543 captured submissions and exported rejection controls. Inputs/emissions/results remain
external in scratch-I11; no captured source was patched or committed. This proves native stage compilation,
not captured-program linking/pixels, a new title replay or playability.

External lane reviews are supplied by the coordinator: **vK18 FAIL → vK18b FAIL → vK18c PASS** at the
merged f1c36f3 delivery; **vK17a FAIL → vK17a2 PASS on49dec3b**, with aaf2473 annotation-only;
K17b's bounded independent PASS retains its original scope. No new independent integration review was
launched or claimed. K17a decisions **#135/#139/#142** remain: existing storage boundary, counted/explicit
compatibility choices (including desktop noise-zero convention), and coordinator-owned external validation.
See [K18](K18.md), [K19](K19.md), [K17a](K17a.md), [K17b](K17b.md), [K16a](K16a.md).

## Boundaries retained

JSPI remains experimental/opt-in; unsupported API/artifact selection falls back to Asyncify, while integrity
and compile failures fail visibly. No universal size/speed improvement, unrestricted Windows/GL/GLSL,
F-PERF-CRT closure, physical iPhone/Safari/Firefox/Windows certification, game/title or first-draw claim.
K19's measured native numerical/nearest boundaries are not bitwise full-frame equality; its separate legacy2D
control replay remains **606 differing pixels /1,818 bytes /maxdelta246**, **not repaired or accepted as exact
parity here**. K16a's deferred GDI lifetime work and K17b's unrelated audit recommendations remain deferred.
No private game input, dependency install, original host execution or push occurred.

Finalization updates documentation/evidence only. Post-doc full leakcheck: **715 committable files PASS**,
exit0, external `leakcheck-docs.log` / `leakcheck-docs.exit`; repeated after staging/final wording.
