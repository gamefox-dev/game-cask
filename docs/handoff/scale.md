# Lane L-SCALE — generated engine-scale pipeline

## Delivery / acceptance

**The 1.6M-instruction fixture builds and runs fully lifted, with native checksum agreement and an identical
300-frame interpreted oracle. This is not a demonstrated 7.1M-instruction game build.** No game code/data or external
measurement files were copied into the repository. Only target instruction/function counts inform extrapolation.
No code generation in `tools/x86/` or runtime semantics in `platforms/x86/` were changed. No success stubs, API
implementations, guest overrides, dependencies, installs, web fetches, pushes or BGT ABI changes were introduced.

Implementation: `386aaed` (scale/streaming), `9fafdcd` (interruption/worker-lifetime hardening); this handoff/metrics
are in the final documentation commit.
Owned areas: `tools/build/`, wasm loading in `bgt/runtime/`, original CC0 `examples/x64-scale`, tests, this handoff.
The added diagnostics are JavaScript-side loading metrics, not a new guest ABI.

## Fixture / coverage

`examples/x64-scale/generate.mjs` deterministically generates **12,000 distinct noinline functions**, in 60 C
translation units, plus a driver. Normal MinGW **-O2**, normal CRT startup, eight-way switches, indirect calls,
unsigned integer mixing, double/SSE arithmetic, malloc/free/snprintf and OutputDebugStringA. Analyzer/lifter census:
**12,078 functions / 1,609,529 instructions**, **1,597,518 specialized / 12,011 generic**, 4 unresolved static indirect
jumps; zero guest overrides. Unresolved edges resolve through the registry, not relabeled as interpreted code.

The same generated C is compiled as a native host program (never a Windows executable) and produces
**`scale checksum 31c9ceb2 functions 12000`**. Unit and both browser backends assert that exact checksum, changing
post-startup tick output through tick 240, **zero interpreted instructions / empty stub list**, and no errors over
300 frames. The differential oracle compares all 300 frame traces against interpretation. This is CPU/build stress,
not a renderer/engine/game compatibility or useful-pixels claim.

## Implementation

- Default AMD64 grouping: **32,768 instructions**, whole guest functions, deterministic address order. This fixture
  uses **50 chunks**, largest C chunk **3,954,702 B**. Oversized functions get their own chunk; the budget is not a
  hard cap for an arbitrarily large single function. i386 keeps the existing orchestration.
- Existing `x86tool --select` emits each chunk without codegen changes. Native lift and compile concurrency both
  use `BGT_BUILD_JOBS` (default 2, maximum 8). The normally compiled Windows fixture also uses bounded object jobs,
  instead of Zig's unbounded multi-input compiler fanout.
- Content-cached analysis and chunk lift products; incremental object cache. Input image/base, native lifter
  identity, function selection, overrides and codegen flags invalidate lifting. Source, **named and hashed headers**,
  compiler path/version and flags invalidate objects. Generated fixture headers invalidate its object cache too.
  Lift payload markers are invalidated before replacement; interrupted products never validate under the old key.
- Merge and validate only generated sorted registry rows. Original function bodies/internal regions stay together;
  no guest address, callback, landing pad or dispatcher contract is rewritten. Duplicate/missing entries fail.
- Existing coverage/static-call-closure selection and strict slices compose with chunks. Full lifting is the
  measured finish line; no coverage reduction was needed. No lazy code modules or shared-memory/table ABI added.
- Object and Asyncify caches each default to **512 MiB** (`BGT_CACHE_MAX_MB`), LRU-collected with active-build leases.
  Active working sets may exceed that ceiling temporarily. Old chunk files, superseded monolithic C and obsolete
  generated-fixture objects are removed. Global Zig caches are measured, **not globally deleted by kit builds**.
- Per-game permanent-inode kernel locks serialize writers. Detached, acknowledged guardians use macOS kqueue
  process-exit / Linux pidfd notifications, including dead-but-unreaped owners. Subprocess writers retain a shared
  generation lease; owner exit drains them before another build is granted the exclusive lock. Late workers check
  token validity under that lease. Object-cache leases also protect surviving writer generations from collection.
  Cancellation can therefore wait for already-started compiler/lift work to finish, rather than corrupt new output.
- Browser `compileStreaming` overlaps download and compilation, with MIME/capability fallback to byte compilation.
  The manifest byte limit runs **before teeing**; oversized responses cancel the source/compiler. Size/hash checks
  finish before a compiled module is handed to `GameHost` for instantiation. SHA-256 still needs a whole-byte buffer;
  this does not eliminate that memory. The existing insecure-context/no-SubtleCrypto integrity limitation remains
  explicitly documented, not silently called cryptographically verified.

## Measurements

macOS arm64, Node 24.19.0, Zig 0.13.0, two jobs; other lanes were active on the machine. Values are wall-clock samples,
not isolated repeated medians unless stated. Exact values/cache state: [scale-metrics.json](scale-metrics.json).

| Metric | Monolithic baseline | Chunked |
|---|---:|---:|
| Independent native analysis | 3.080 s | 3.236 s |
| Cold lift, including its analysis | 4.530 s | 109.496 s (50 repeated analyses) |
| Generated C | 194,606,868 B | 195,353,217 B |
| Generated LOC, including driver | 2,082,280 | 2,106,783 |
| First cold compile + link | 372.279 s | 130.768 s |
| Peak compiler/linker child RSS | 4,887,150,592 B | 404,226,048 B |
| Conservative parallel compiler bound | not measured | 808,452,096 B (jobs × largest child) |
| External whole-command largest-child RSS | 4,887,150,592 B | 1,118,158,848 B (also includes fixture/Asyncify) |
| First whole build | 617.551 s | 419.730 s |
| Final wasm | 50,325,400 B | 38,817,816 B |
| Complete raw payload | 62,933,950 B | 51,426,366 B |
| Complete separately-gzipped payload | 8,296,957 B | 8,269,479 B |
| Browser byte compile, median / 3 fresh processes | 22.880 ms | 23.575 ms |
| Browser instantiate, median / 3 fresh processes | 1.460 ms | 1.830 ms |
| Load → first rendered frame, median / 3 fresh processes | 634.430 ms | 361.850 ms |
| Download + compile + verify, median / 3 runtime samples | 63.590 ms buffered | 92.350 ms streaming |
| Sampled retained-workspace peak disk | 2,710,033,615 B | 2,711,319,450 B |

**Caveats:** the first baseline compiled 31 objects / cached 0; after compiled 51 / cached 30 shared profile objects.
Both Asyncify products were cold. These whole-build times are not a cache-controlled pure compiler speedup.
A second, profile-warm comparison after object-key hardening compiled only the driver + monolith versus the driver
+ 50 chunks: **514.665 → 149.933 s compile**, **0.425 → 0.641 s link**, peak child **5,089,067,008 → 404,275,200 B**,
with cached Asyncify. Its chunk lift was cached. Largest-child RSS is not aggregate concurrent RSS; the parallel
bound is deliberately conservative. External `time -l` includes tool processes not included in compiler metrics.

Final fully warm build: **2.453 s**, all 50 lifts/analysis cached, zero objects compiled, Asyncify cached. Cold lift
regresses substantially because each selected invocation repeats full analysis. No cold-lift speedup is claimed.

Browser phases use fresh Chromium processes, loopback WebGL2/SwiftShader, three samples each. Byte compile excludes
fetch; runtime first-frame includes assets, hashes, graphics and guest startup. The buffered baseline is the current
runtime's MIME fallback on the old wasm, **not an old-runtime checkout**. Changed wasm and loading strategy both
contribute; **streaming alone is not faster in these samples**. Both real backend fixture tests also pass. No
mobile/browser portability or network-throughput claim follows from a sub-second loopback first frame.

Disk is a **250 ms logical-byte sampler** over kit cache/output plus configured Zig caches, with retained unrelated
fixtures and prior comparison products inside those directories. It excludes comparison copies in `/tmp` (about
116 MB extra during benchmarking), lint's external temporary output and filesystem allocation differences. Sub-250ms
scratch peaks may be missed. It is a bounded workspace measurement, not an isolated cold-build disk reduction.
No ENOSPC occurred. Temporary baseline/after/native comparison products are removed after measurement; final cache
collection runs in every build. Shared filesystem free space also changed due to other lanes.

## Extrapolation to the measured target count — NOT execution evidence

Use **7,084,076 / 1,609,529 = 4.4013348** instruction ratio; target ~50k functions is near the fixture's function-density
projection (~53k). This is a homogeneous source/optimization model, not a prediction for different instruction mixes.

- **Time:** naive linear cold-build projection: **30.8 minutes**. This is optimistic: current cold selected-chunk
  lifting repeats O(N) analysis across O(N) chunks. Treating the entire measured 109.496 s lift term as quadratic
  and remaining work as linear gives **58.1 minutes**. Removing repeated analysis requires a future lifter analysis
  snapshot/worker API or a separately validated source-splitting strategy, not a claimed fix in this lane.
- **Compiler memory:** approximately **404 MB per bounded-size chunk**, **809 MB conservative two-job bound**, only
  while maximum function complexity remains similar. Linking and whole-module Asyncify are not chunk-bounded. Linear
  projection of the observed whole-command largest child is about **4.92 GB**; that is a risk envelope, not a bound
  or proof of 7.1M feasibility. The old monolithic compiler's linear envelope exceeds 21 GB.
- **Disk:** generated C projects to **860 MB**, final raw package to **226 MB**; these core retained artifacts total
  about **1.09 GB**. Add up to 1 GiB steady object/Asyncify caches, active publication/scratch, original images,
  generated Windows source/objects and Zig caches. This is **not certification that a complete 7.1M build fits a
  5 GB disk**. Retained unrelated fixtures must be cleaned and the 7.1M build needs an actual peak-disk measurement.
  Multiplying the entire retained-workspace peak by the ratio gives an intentionally overconservative **11.9 GB**
  envelope, since unrelated fixtures/capped caches do not grow with this program.
- **Download:** homogeneous projection **171 MB wasm / 226 MB raw package / 36.4 MB gzip package**. At a real sustained
  10 Mbit/s, gzip transfer alone is ~29 seconds, not sub-second loopback startup. Compression should be served by the
  deployment; the gzip metric does not claim the dev server actually compressed it. Local compile/instantiate
  linear projections (~104 / 8 ms) and first-frame (~1.6 s) are speculative, not mobile results.

Measured instantiation (~2 ms) and first-frame (<0.7 s) do not demand a lazy-module ABI for this fixture. A reviewer
question proposed retaining one wasm below 1 s instantiation / 5 s local first frame; it **timed out to that stated
default**, not reviewer approval. Lazy modules remain deferred, with bandwidth and whole-module Asyncify explicitly
open at 7.1M. The four native-BGT examples have no guest interpreter; their lifting oracle is N/A, not a fabricated
self-comparison. A bridge clarification about that gate also timed out to the already documented kit boundary.

## Verification / independent review

Final source revision **9fafdcd**, with this documentation-only handoff added afterward:

- `npm run doctor`: ready.
- `npm run lint`: ESLint, real host **GCC** compilation, all **21 example check-builds** green.
- `npm run typecheck`: green.
- `npm test`: **418 tests / 36 files passed**.
- `BGT_REQUIRE_WEBGPU=1 npm run test:e2e`: **197 passed / 45 intentional skips / 0 failures**; neither backend
  unavailable. Breakdown: WebGL 2 **97/21 skipped**, WebGPU **95/23 skipped**, auto **5/1 skipped**.
  Dedicated `BGT_E2E_PORT=5200`; developer `:5173` untouched.
- All **17 pipeline examples**, each `npm run oracle -- examples/<id> 300`: **5,100 identical frame pairs**,
  null errors in both modes, zero lifted interpreted instructions and empty stub lists. IDs: win32-conformance,
  win32-hello, x64-audio, x64-basics, x64-cpp, x64-cpprt, x64-crt, x64-gl, x64-gui, x64-input, x64-memory,
  x64-scale, x64-smoke, x64-sysdlls, x64-threads, x64-tls, x86-threads. Four native BGT examples are oracle N/A,
  covered by their known-answer/browser tests instead. Final oracles run **after** the kit suites because shorter
  unit oracles otherwise overwrite the same report paths.
- `npm run leakcheck`: **384 committable files checked**, green. No test assertions, existing timeouts, backend
  requirements or inventories weakened.
- Focused owned regressions: **21 tests / 3 files** with globalSetup disabled, all passed.

Fresh independent sessions actually ran. First review found old-marker publication, stale-directory locking,
crash-before-PID and oversized-stream cancellation bugs. Second review verified marker/size fixes and exposed
process-group, zombie and orphan-writer lifetime issues. They were repaired with acknowledged detached kernel
watchers and writer-generation leases, with persistent regression tests. Third fresh review found **no remaining
writer-overlap defect for ordinary macOS owner crashes**: 8 real-wrapper/real-lift crash scenarios (individual
SIGKILL and owner-group SIGTERM), 12-process contention, 10 lift / 4 analysis interruption points, 6 independent
loader cases, plus the 17-test focused suite passed. It found a low-severity expired zombie cache-lease retention
issue; the final repair makes the guardian's drained `.writers` barrier authoritative. A persistent cache regression
and an implementer rerun of the reviewer's unreaped-owner reproduction prove the six-byte payload is collected
**before reaping**, not merely afterward. This last small cache fix is implementer evidence, not retroactively
attributed to the independent review.

Deliberately killing both additional lease-holding ancestors can still orphan an uninstrumented grandchild. The
reviewer reproduced that **targeted gate-hierarchy destruction**, separately from ordinary owner crashes; no claim
of survival under arbitrary malicious killing of all supervisors is made.

Raw logs stay outside Git under `/tmp/lsc-logs/` (`commit-gates.log`, `commit-oracles.log`, `final-oracle-*.log`,
`focused-final.log`);
independent answers `/tmp/lsc-review.txt`, `/tmp/lsc-recheck.txt`, `/tmp/lsc-review-final.txt`. No delegation is claimed
for checks those sessions did not run.

Remaining boundaries: no real 7.1M build, analysis-snapshot interface, lazy code ABI, hard worst-case single-function
memory bound, global Zig-cache collector, general mobile/physical hardware verification, or independently executed
Linux pidfd path. Unsupported host exit-notification support fails closed rather than granting an unprotected lock.
