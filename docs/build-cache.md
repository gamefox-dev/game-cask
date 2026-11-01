# Incremental builds and focused unit tests (K7i)

## Objects and lifting

Pipeline games compile each lifted translation unit, generated registry/driver, override and profile/runtime
translation unit separately. Object keys contain the compiler executable SHA-256 and version, compiler-affecting
include environment, ordered flags, logical source path, and **the source and exact transitive compiler dependency
bytes**. `zig cc -M` determines dependencies, including conditional/macro includes; the kit does not guess C includes.
Dependency manifests are local, disposable accelerators. Changed dependencies/source/flags rescan the compiler.
Include-directory name inventories also detect newly added/deleted shadow headers. An unrelated profile header can
cause a cheap dependency rescan, but cannot invalidate a lifted object that does not include it. A changed shared
x86 semantic header correctly invalidates every lifted object that actually includes it.

Repository-relative logical paths plus compiler file/macro prefix maps remove clone-specific `__FILE__` paths from
pipeline objects. Explicit macro values remain semantic bytes; arbitrary `-D` strings are not path-normalized.
Compiler flags, target/guest width, memory configuration and toolchain headers remain part of identity. Native BGT
examples retain their existing compilation path. No lifter instruction emission or platform behavior changes.
Analysis and both chunked/monolithic lifts are reused independently of profile contents. PE/base, lifter identity,
function selection, override addresses and codegen options still invalidate lifting. Changing the profile's DLL
inventory may change the generated driver, but not lifted functions.

## Optional shared cache

```sh
# Use the SAME absolute, same-user local filesystem directory in every clone.
export BGT_SHARED_CACHE=/path/to/shared-build-cache
export BGT_CACHE_MAX_MB=512           # per payload class; default 512 MiB
export BGT_BUILD_JOBS=2              # default 2; maximum 8
npm test -- tests/unit/commands.test.ts
```

Only immutable object and whole-module Asyncify payloads are shared, under `bgt-v2/objects` and `bgt-v2/asyncify`.
Omit `BGT_SHARED_CACHE` for clone-local caches under `node_modules/.cache/bgt`. The canonical real path is used for
leases even when clones spell the shared directory through different symlinks. Analysis, lifted C, Windows fixture
products, dependency manifests, packages and reports remain local: this is **not** deduplication of entire clones.
Do not share between untrusted users or publish this directory: compiled objects can contain private program data.
Network filesystems without reliable POSIX locking/atomic rename are not supported.

Each shared payload class is mtime-LRU bounded to its budget after collection (up to 1 GiB combined by default).
The CC0 scale fixture's clone-local native reference has an additional 64 MiB object budget. Reads refresh LRU.
Live leases pin all inputs through linking/copying; concurrent builds' active working sets can temporarily exceed
budgets. The existing generation guardian drains orphaned subprocess writers before expiring leases. Unique temp
files and atomic rename publish only completed payloads. A bounded 256 kernel-lock stripes per class coordinate
writers; waiters recheck after acquiring the lock and reuse the winner instead of recompiling. Failed publications
are removed and retried. Abandoned temporary payloads participate in collection, and same-key retries clean them.
Lock files have permanent inodes and must not be deleted while builds run. Removing an idle cache is always safe.
Zig's own caches, local intermediates and packages are **not** included in this payload bound.

## Asyncify boundary

The postprocess key includes linked wasm bytes, wasm-opt implementation, enabled features and exact pass/import
options. Asyncify runs on the **linked module**. Binaryen's normal reachability analysis already scopes instrumentation
to paths that may reach `bgt.yield`; indirect calls are conservative. Lifted functions, Win32 callbacks and scheduler
continuations use indirect tables, so declaring indirect calls harmless or maintaining an ad hoc only/remove list is
not sound. A profile change that changes the linked wasm can require another whole-module pass. There is no supported
relocatable per-object Asyncify artifact here. Identical linked bytes reuse the entire result, including across clones.
Measurements and remaining whole-module cost are in [K7i handoff](handoff/K7i.md).

## Lazy unit-test builds

A test using prebuilt examples declares a whitespace-separated list in one static comment:

```ts
// @bgt-examples: win32-hello x64-basics
```

No declaration (or `// @bgt-examples: none`) means no prebuilt example. Tests constructing their own isolated fixture
still build it explicitly. IDs must name kit examples; `port/`, traversal and unknown IDs are rejected. These comments
are read without importing test modules or executing their hooks.

Vitest global setup reads the **actual scheduled paths** already recorded by pinned Vitest 4.1.11, before test
timers. Its `onTestsRerun` hook receives the precise specifications for watch reruns. The setup builds their deduplicated
declaration union, independently of reporters. This handles file filters, exclusions, custom configs, API selections
and watch reruns without parsing CLI arguments. A subprocess regression first builds a stale native fixture, changes
its source, then runs a selected test with `--reporter=dot`: it must observe the new value and no unrelated example. A permanent inventory assertion checks that the complete
suite's declarations cover every kit example, including native package/ABI tests. Thus the full suite builds every
example once without any special build-all fallback; focused runs never silently fall back to `--examples`. The existing browser npm scripts still
build every example and their slice setup is unchanged (except the explicit CI partition below). All assertions/timeouts/backend policies remain unchanged.

## CI cost partition (LANE-K7i)

Plain `npm test` and `npm run build:examples` remain complete. `npm run lint` check-builds the 25 non-scale examples;
`BGT_INCLUDE_SCALE=1 npm run lint` also check-builds `x64-scale`. Direct `build.mjs examples/x64-scale --check`
always honors the explicit target. Both paths use the exact same object and Asyncify caches as package builds.

The normal required CI job sets `BGT_CI_LIGHT=1`: it omits only `tests/unit/build-chunks.test.ts`, the scale browser
spec and the scale example from bulk builds. A second unconditional required `scale` job runs the original scale
unit file (including native checksum/chunk/cache tests), original WebGL2 browser spec and 300-frame differential
oracle, and explicitly check-builds the scale fixture. No assertions are removed in aggregate. The functional job has a
60-minute ceiling (margin over the measured 38m32s), and scale has 45 minutes. Two bounded file workers overlap pure
unit files. Check-builds and packages already share objects: the measured CI bulk package build after lint was only
18 seconds; per-example stdout now reports compile/cache/link/Asyncify phases explicitly. The scale native reference
uses per-TU compiler dependency caching and bounded jobs. Setup prebuilds it outside the test timer; all checksum
assertions and the original 120-second deadline remain. Timings and actual CI evidence are recorded in the handoff. The optional
WebGPU hardware job remains a full run, not a substitute for either required job.
