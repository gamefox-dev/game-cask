# K49 checkpoint — reviewer #470 (stop, no compaction)

Read this FIRST on continuation, then K49.md and the delta from 9d3e3d7.
Branch **lane/K49**. Source/test candidate **6fc9cde**, Q85 commit dd27379.
This checkpoint is documentation/evidence only. No game files/web/installs/push by
this agent, no test weakening, no compaction. Reviewer requested stop past150k.

## Done

- Read operating rules, relevant pipeline/runtime/lifter, K29/K31/K36 and reviewer-
  supplied unmerged K38/K39 evidence in inputs/k38-k39 (read-only).
- Q85 default-OFF compile-time exact native dispatch counters; u64 decimal strings;
  native-present64 snapshot ring with drops; OFF unavailable/null. See K49.md event
  definitions and docs/pipeline.md. BGT_DISPATCH_COUNTERS=1 rebuild enables them.
- Known-count registry/driver tests, ON/OFF full architectural state comparisons,
  generated return/quantum/guard-to-checked-fault events, exact serializer precision.
- Source-built Win64 dense16-call chain, four-target indirect, owner-region, mixed
  leaf/nonleaf Win32 imports + generic CPUID fixtures. Both-mode300-update oracles,
  counter-OFF/ON identical API/state traces. Existing real callback/suspension/SEH,
  checked-memory/full-width/quantum safety fixtures remain unchanged in strength.
- Q85 evidence justified positive exact-PC/expected-pointer/registry-generation
  certificates for generated direct enter and known return resume. No guest pointer,
  table value, permission, strict policy or stop state cached. All publication and
  dynamic guards retained. Additive INTERNAL C APIs approved by reviewer bridge.
- Rechain single-slot cache prototype rejected (299978 misses,0hits). Final emitter
  keeps original rechain. No spill/flag ABI, guard-hoisting or direct-memory changes.
- Nine alternating pairs + warmup and separate CDP self profiles, both modes.
  dense helper samples -27.3% Asyncify/-17.3% JSPI; native lookups3200001 ->47.
  four-target100009 ->10; mixed200009 ->100010; driver steps unchanged.
  Full tables and caveats K49.md; committed K49-measurements.json retains all timing
  samples/load, build identities/hashes, count totals, oracle digests and CDP split.
- Separate instrumentation-overhead round final-overhead/: JSPI medians OFF ->ON
  direct25.650 ->27.623ms, indirect1.922 ->2.044, regions3.497 ->3.650,
  mixed31.544 ->32.654. Asyncify ON appears faster (code-shape/JIT), **not** a claim
  counters are free. Owner-region large Asyncify gains occur even on instrumentation
  alone and are not causally attributable to admission caching. Retirement uniformly
  ON for measurement; production accounting-OFF timing remains a useful follow-up.

## Gates already observed

- doctor exit0 (logs/doctor.log).
- final focused **50/50,4 files, no skips**, actual JSPI + Asyncify, real production
  dispatcher, callback/SEH/quantum/fault and CPU/RAM/interpreter checks:
  logs/final-focused.log, exit0 (146.33s). Earlier matching50/50 also passed.
- typecheck exit0. **No full Tier1 certificate yet.**
- final fixture preparation all4 workloads ×OFF/ON ×both modes ×300 green;
  final-pair and separate overhead green. Raw before/,after/ (rechain prototype),
  final/,final-pair/,final-overhead/ retained outside repo.
- full lint currently RUNNING; ESLint stage already passed, actual GCC stage ran,
  wasm example checks progressing (normal --check excludes x64-scale by inherited
  policy). Explicit clang+gcc checks queued after it. No lint exit file yet.
- full npm test is QUEUED after lint/frontends/cleanup (not started at checkpoint).
- Full browser matrix, every pipeline oracle300, final leakcheck/diffcheck,
  sensitivity mutations and acceptance review still OPEN.
- Initial focused failures were missing BGT_JSPI build artifact invocation (fixed)
  and a new test expecting the wrong cold path (whole-block guard actually routes to
  shared checked semantics). No assertion/deadline removed; final tests assert exact
  guard count and full ON/OFF fault CPU/RAM.

## Live processes / logs (18:19 local Nov14)

Scratch root **/Users/dev/projects/pi-work/scratch-K49**, NEVER delete it.
BGT_E2E_PORT=5302; ZIG_GLOBAL_CACHE_DIR=scratch-K49/zig-cache;
ZIG_LOCAL_CACHE_DIR=scratch-K49/zig-cache/local. Last free **~4.9GiB**;
owned Zig cache~766MiB, repo node_modules/.cache/bgt~565MiB. Keep >3GiB free,
leave1GiB swap reserve. Delete owned build outputs only BETWEEN active suites.
No shared/foreign cache/lock/ticket deletion.

- **PID56705**: sh scratch-K49/final-prepare.sh, now executing full npm run lint.
  Prior prep/pair/overhead/focused/types stages done. Logs/logname.exit distinguish
  completed from running. lint.log currently around x64-cpp compilation (615 owners/30873 insns).
  Checkpoint leakcheck exit0 (1072 files); git diff--check clean.
- **PID89221**: sh scratch-K49/gates-next.sh, WAITING for logs/lint.exit.
  It will run explicit real GCC14 + clang host checks (frontends.log/.exit), remove
  OWNED disposable pipeline/objects/asyncify and Zig local/o/z outputs after lint
  exits, then run **full** npm test serially with BGT_JSPI=1,BGT_TEST_JSPI=1,
  BGT_BUILD_JOBS=2,BGT_CACHE_MAX_MB=128,--maxWorkers=1.
  logs/units.log/.exit and disk-before/after-units.txt. No weakened/light exclusions.
- No browser or oracle job has been launched. scratch-K49/gates-oracles.mjs is an
  UNRUN draft serial every-pipeline oracle driver. It checks both modes300, saves
  reports/index under scratch/oracles/, deletes each fixture's outputs between
  cases and prunes owned Zig cache between fixtures. Review before use: its
  before-case4GiB reserve may stop safely; current node CLI oracle timeout600s may
  need prebuilding scale normally (do NOT weaken test deadline). It currently
  rebuilds for each mode; optimize reuse if helpful without changing assertions.
- Sandbox ps is forbidden. Use kill -0 PID only for liveness, log tails/exit files
  for stage. Do not start another heavy suite while these chains are active.

## External reviewer/CI

Reviewer bridge approved additive internal cache API after evidence; no BGT ABI or
new guest semantics. Request at6fc9cde: reviewer (not this agent) launched remote
**ci/k49**, tier2 Linux/gcc/noGPU/nooracles only, and fresh **vK49** independent
static+focused review (small fixture, no heavy suite). Results will be relayed.
Do NOT count remote CI as local Tier1 or claim independent PASS before result.

## Exact next steps

1. Check live chains/log exit files FIRST and free disk. Let lint and queued full
   units finish. Investigate any failure, no deadline/assertion/skip weakening.
2. Await reviewer/CI findings on6fc9cde, fix real findings with sensitivity tests.
   vK49 is truly external/fresh; no in-lane independent review claim.
3. Run final counter/cache mutation sensitivity serially (e.g. bypass certificate
   hits -> count-regression fails; skip generation/NX/strict checks -> intended
   guard assertion fails), restore production source exactly and record evidence.
4. Full Tier1: explicit clang/GCC (queued), full npm test (queued), then
   npm run test:e2e both backends and both suspension modes. Use BGT_JSPI=1 dual
   artifacts, BGT_E2E_SUSPENSION=jspi for JSPI, BGT_REQUIRE_WEBGPU=1, port5302;
   no BGT_CI_LIGHT. Keep one heavy job, background, outputs cleaned between suites.
   Full examples include large x64-scale: keep >3GiB disk by bounded owned caches,
   inspect scale needs before running; no shared output deletion.
5. EVERY pipeline fixture lifted/interpreted oracle at300 in both modes (enumerate
   examples/*/game.json.pipeline, do not assume historical count34). Save reports
   before removing owned output. Strict expected-error fixture contract stays live.
6. Final doctor/types/leakcheck/diffcheck, archive gate counts/hashes, update K49.md
   from WIP to truthful acceptance boundaries. Add production accounting-OFF paired
   timings if practical; existing timing is explicitly accounting-enabled.
7. Commit on lane/K49, never push. Final response<200 words, distinguish real-game
   remeasurement and any unclosed hardware/gates. Finish without compaction.
