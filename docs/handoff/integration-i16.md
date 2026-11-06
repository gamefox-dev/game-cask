# Integration I16 — K33 over dev.21 (checkpoint, NOT complete)

Branch **integration/p1**, original no-ff merge **5cc812c** = **fab7257** (dev.21/K31/K34) +
**a11349c** (K33). Current production/test/CI source **0727828**; documentation may advance HEAD.
Accounting remains default OFF. No runtime, compiler, emitter, ABI, guest scheduling or helper change.

## Repairs committed

- **3541c17**: consume complete Vitest JSON file discovery, not a filtered directory/extension subset.
  Old filtering could omit the same newly configured file from both full and light inventories and
  falsely pass their union. Before regression **3 PASS /1 FAIL**; after **4/4 PASS**. Full configured
  inventory141; original two shards68+72 plus scale1. All K31/K34 unit files present.
- Coordinator clarified the brief's tools/bench example was mistaken: **tools/bench/accounting.test.ts
  is opt-in**, outside vitest.config.ts by design. Its own overhead config is not enrolled in default
  CI; future deliberately configured files outside tests/ must not be filtered out.
- **0727828**, reviewer **#345**: three required CI unit jobs, strict UNIT3 aggregate; maximum measured
  test/example costs refreshed from Linux run42141326145. New three-shard union51+46+43 plus scale1
  equals141, no overlap. Predicted test+cold-example cost **41.11min each**, not actual job duration;
  reviewer requires actual >=15% headroom (<=51min of60), still pending CI.
- JSPI availability: guest-accounting previously requested JSPI unconditionally on default CI Node.
  accounting-startup had the same latent problem (cancelled shard had not reached it). Shared
  **tests/support/suspension-modes.ts** always runs Asyncify, includes available JSPI, throws when
  BGT_TEST_JSPI=1 demands unavailable JSPI. Four branch regressions; third-shard union and actual
  aggregate success/failure/cancelled/skipped regressions. Existing semantic assertions unchanged.

## CI (reviewer-owned; never relabel failures)

- **ci/i16**,5cc812c,run**42141326145**: FINAL FAIL. Three lints, e2e, scale PASS; unit_1
  **1436/1438** (two unavailable-JSPI failures), unit_2 cancelled60min, aggregate FAIL.
  Raw logs **/Users/dev/projects/pi-work/inputs/ci/i16-unit_*.log**.
- **ci/i16b**,3541c17,run**42143062584**: result not yet returned at checkpoint; expected same issues.
- **ci/i16c**,0727828,run**42150746419**: reviewer launched; result pending. Reviewer sends results.
  Do not call gh in this sandbox (operation denied). No lane push.

## Local completed vs pending

Raw root **/Users/dev/projects/pi-work/scratch-I16/i16/**. Main queue **serial.sh**,
checker **check.py**, oracle sweep **oracles.mjs**, prepared end audit **audit.py**.
All suites serial in background, own port5286, never5173; build jobs2, dual variants,
required WebGPU, actual JSPI V8 flag, full default inventory, no CI_LIGHT/exclusions.

Completed exits0: doctor; compiler-transport + original shard regression **19/19**, including
K33's **every kit example option inventory +4096-object compiler-plan allowlist** test; full
CC=clang lint **38 checks**; full realGCC14 lint **38 checks**; explicit Clang host gate;
typecheck. Final repair typecheck additionally passed twice. Inventory before/after logs retained.

**Runner mistake, NOT kit breakage:** initial full-unit queue explicitly exported
BGT_CPU_ACCOUNTING=0. Several accounting tests intentionally compile ON via fixture cflags; the
extra OFF environment definition conflicts under -Werror. This full run has real macro-redefinition
failures; it is NOT green and will not be reused as a full PASS. A complete clean-default rerun
(with BGT_CPU_ACCOUNTING unset) is queued in **repairs.sh**, plus both plain optional-Node and
required-JSPI focused runs. Never weaken the compiler warning, delete fixture ON coverage or claim
these tests should run OFF internally. Baseline product default is OFF; explicit accounting test
fixtures still exercise ON as always.

### Active runner protocol — important

- Main **serial.pid =74058** is intentionally **SIGSTOPped**, not dead. Its current full-unit child
  **Vitest47219** continues normally to completion. Original npm wrapper47174 is not the poll target.
- **repairs.pid** currently points to43167 (check file, not this historical number). It polls47219,
  then runs optional-Node focused tests, required-JSPI focused tests, **complete default-OFF unit
  rerun**, typecheck, ESLint, all serially. It then SIGCONTs main74058 and removes **paused**.
  Do not launch another suite or manually resume main while repairs is active.
- Main then records the original full unit failure honestly and continues full Asyncify/browser,
  JSPI/browser, leakcheck, all34 pipeline fixtures x2 modes x300 OFF; then68 ON oracle reports;
  then sustained K34 preparation/pairing versus a temporary **fab7257** dev.21 worktree.
- Benchmark worktree **/Users/dev/projects/pi-work/scratch-I16/dev21**, node_modules symlink to kit.
  Never delete its symlink target. Nine alternating paired samples plus discarded warmup,
 30 untimed +300 timed updates, both real modes. Oracle/hash evidence prepared for both versions.
- Main still exports explicit0 for remaining OFF browser/oracle/benchmark builds (no fixture ON
  conflicts there), then1 only for ON oracles. No ON full units/browser required by this brief.
- Use **python3 -I /Users/dev/projects/pi-work/scratch-I16/i16/check.py** and inspect markers/logs.
  Checker currently lists initial unit failure separately; final audit must select the actual
  **repairs/unit-default-off.exit +repairs/unit-results.json**, not relabel original unit.exit.
  **audit.py** was adapted from I15 but has NOT run and still needs that final-unit selection and
  final repair/inventory/CI/benchmark evidence integrated. It already checks all136 oracle reports,
  accounting availability/strings/owner+present totals, ON/OFF/cross-mode hashes, exact inherited
  browser skips, strict unchanged GL-scale-only expected errors and K34 paired spread.

## Independent scope / remaining work

Fresh independent pi review at3541c17 **PASS bounded source/discovery scope**:
**independent-review.md**. It checked both auto-merges retain skip-file transport +accounting,
K34 helpers/I15 high-CALL accounting unchanged, compiler allowlist compatibility, exact141 union.
No tests/builds/gates/benchmark/CI ran independently; not final0727828 review.
A fresh repair-delta review attempt failed before starting: **repair-review.exit1**, auth error
**CLIPROXYAPI_API_KEY unavailable**; no report, NOT PASS. Do not inspect/log credentials.

Remaining: finish serial queue; resolve any real failures with regressions; actual ci/i16c jobs
<=51min and required gate green (reviewer result); independent repair review/explicit coordinator
boundary; audit exact unit/browser/oracle/paired evidence; finalize docs/v03-status.md and this
handoff with honest failures/recoveries and compact durable JSON evidence. Delete owned benchmark
wasm copies (main does after successful pairing), temporary dev21 worktree and owned Zig cache only
AFTER every suite finishes. No shared locks/caches or foreign outputs. Free space last checked~10GiB
(coordinator cleanup apparently freed space; this lane did not delete foreign files).

No full Tier1/CI completion, final benchmark, game performance, physical-device,60fps or universal
GCC/guest architecture claim at this checkpoint.
