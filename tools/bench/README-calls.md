# CC0 native-call/dispatch benchmark (K32)

Run serially, in the background, without republishing a fixture concurrently:


tools/bench/calls.config.ts runs five generated, original CC0 assembly workloads: 16 small direct
callees, 96-deep recursion, four-target indirect calls, four-target tail jumps, and conditional/
fallthrough/backedge transitions across 256-instruction regions. No PE is executed on the host.


BGT_SUSPENSION_BUILD=dual BGT_CALLS_REPORT=/absolute/result.json \
  npm exec -- vitest run --config tools/bench/calls.config.ts

Set BGT_ORACLE_SUSPENSION=jspi for actual JSPI; the config enables Node's wasm JSPI support.
BGT_CALLS_REFERENCE compares final state/semantic hashes against an earlier report. BGT_CALLS_COUNT
(default5000) and BGT_CALLS_PATTERNS select diagnostics, not alternate acceptance workloads.
Each case first runs a 300-update lifted/interpreted oracle, then one discarded warmup and five
fresh instances. OutputDebugString markers delimit only the guest loop, excluding initialization,
checks and cleanup. All samples, resources, module sizes, counters and oracle hashes are retained.
ns/call includes Win64 prologues/epilogues, instructions and state synchronization; it is NOT an
isolated wasm call instruction latency. The region case reports ns/iteration, not ns/call.

Internal x86_native_stats work is compiled out by default (X86_NATIVE_STATS=0). Set
BGT_CALLS_STATS=1 for a SEPARATE counted build/run; never use its timings as uninstrumented
production timings. Default/opt-in guard regressions prove respectively untouched/counting
counters. The counters are exported ONLY by this benchmark's extra host fixture source, never
by production game drivers. Slots: driver steps, fast calls (including tail dispatch), locally
resumed continuations, same-owner region chains, indirect site hits/misses; then peak native depth.
Baseline predates these counters: nativeStats is null, not invented zero. Its lifted_calls counts
all native step entries in these simple workloads; it is a useful dispatch proxy, not a new measured
counter. Existing reason5/6 census counts are separately reported; baseline CALL/RET boundaries do
not produce census exits, so zero census does not mean zero driver crossings.

For same-process alternation, prepare both revisions with BGT_CALLS_KEEP=/absolute/revision-dir
and BGT_CALLS_REPORT=/absolute/revision-dir/report.json. Then run paired-calls.config.ts with
BGT_CALLS_BEFORE, BGT_CALLS_AFTER and BGT_CALLS_REPORT. It alternates five A/B fresh-instance
pairs per fixture per mode after one warmup pair, recording every sample, paired differences,
spread and host load averages. Both prepared fixtures must use count100000 and dual artifacts.
This cancels temporal drift better than separate before/after batches but does not isolate other
workloads or certify a quiet machine. Remove retained artifacts after preserving JSON evidence.

Full architectural state is published before a call: every register written by the caller region,
flags, instruction clock and budget. Used/written registers are reloaded after return. Unused
callee-written registers remain authoritative in X, with no stale writeback. Imports retain their
existing all-register envelope. Savings do not eliminate these spills. Forced all16 spill/reload
was tested and rejected: deep recursion regressed; final direct self-recursion and calls to statically self-recursive owners use the flat path.
Single-region owners have no region-loop check. Mutual recursion remains bounded to32 fast frames.

Workload outputs and intermediate pipeline directories are deleted in finally. Build caches and
JSON evidence remain. Shared-machine results are not game speed or quiet-machine guarantees.
