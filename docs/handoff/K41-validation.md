# K41 fresh independent validation

## Verdict

**ACCEPT narrow IMUL at 91d4f22, within the local fixture/Tier-1 acceptance limits below. No blocking production defect found.** This is an independent kit review, not a game-port grade, a CI pass, or a universal speedup claim. Narrow ALU and shift-liveness are correctly absent. The reviewer-approved **split unit acceptance is justified; the original full unit invocation FAILED and remains failed**.

Reviewed HEAD **91d4f2219a19e87798b005680e451f40d29ef739**, whose immediate parent is base **457372649991982043c240c7473ee6be6d9c8f8f**. Initial and post-test/post-cleanup Git status are empty. The Tier-1 recorded commit matches HEAD and its recorded status is empty. I read CLAUDE.md, the independent-validator brief, checkpoint, forms, measurements, pending draft, relevant production/test/bench sources, and actual reports/logs/exits. I did not implement or repair repository code.

## Claims and correctness audit

| Claim | Assessment / evidence |
|---|---|
| Only narrow IMUL ships | **Confirmed.** The only production diff is platforms/x86/x86_lift64.h: old noinline helper renamed xl_imul_wide; inline dispatch uses signed i64 for n=1/2/4 and old signed i128 for n=8. tools/x86/lift64.h is byte-identical to base. Remaining changed files are diagnostics, tests and handoff evidence. |
| Exact flags and result, no new overflow | **Confirmed for valid widths.** Sign-extended signed32 products range within signed64 (largest positive product 2^62); narrower products also fit. Unsigned truncation/masking followed by comparison to the sign-extended truncated result is equivalent to the former i128 overflow test. Only CF/OF are replaced. Width8 preserves the old recipe; its signed64 product fits signed128. Existing two's-complement conversion conventions in x64_sext are unchanged, not a new UB assumption introduced by this patch. |
| Observable boundaries unchanged | **Confirmed by diff and differential coverage.** Operand reads, checked pointers, publication/fault paths, partial-register and 32-bit zero-extending writes, retirement, clocks, calls/callbacks, admission/resume and suspension sites are not edited. The helper has no new externally observable effects. |
| Per-width randomized/edge proof | **Confirmed.** IMUL helper matrix is 4 widths x4292 pairs, including 14x14 edges and deterministic random operands, compared against signed i128 product and all 32 flag bits. Instruction tests cover legal two-/three-operand register/immediate/memory forms at 16/32/64 bits, upper bits, pre-operation memory faults and post-operation checked faults, complete CPU bytes/RAM, fault address/diagnostic, both size/fast policies. Byte width is helper-level coverage: these multi-operand IMUL encodings have no byte destination. |
| ALU regression tests retained without shipping rejected ALU | **Confirmed.** 4x9x2409x2x64 helper matrix plus AL/AH/BH and 16/32/64 instruction/state/fault tests remain useful baseline regressions. Buffer.equals compares every captured byte, not a checksum or reduced sample. |
| Cache/header invalidation unchanged | **Confirmed by source mechanism and aggregate suite scope.** Existing content-hashed compiler dependencies include transitive headers. tests/unit/lifted-header-cache.test.ts checks dependent objects, linked/JSPI and Asyncify bytes using a private header copy. No cache key or dependency shortcut is added. I did not separately rerun that test. |
| Leaner actual WAT | **Confirmed at measured sites.** base/vm/debug/attributed.wat:10309 calls xl_imul; imul/vm/debug/attributed.wat:10300 onward instead contains i64.mul and i64.and 4294967295 with folded neighboring XOR/byte extraction. This dead-CF/OF site does not prove that flag-live IMUL needs no flag recipe. |

Test limits: API trace hashes are not complete CPU-state hashes; the instruction-level tests supply CPU/RAM evidence separately. Normal instruction sequences later overwrite EAX/flags, so the deliberately inserted post-operation fault is important for exposing the IMUL result and flags before that overwrite. Tests are deterministic finite matrices, not an exhaustive proof over all operand pairs or all programs.

## Actual parent Tier-1 evidence (audited, not rerun here)

Paths below are relative to **/Users/dev/projects/pi-work/scratch-K41/**. Checked individual exit contents and log/report outcomes, not merely file existence.

| Gate | Actual result |
|---|---|
| tier1-final/doctor | exit0; Node24.19.0, Zig0.13.0, dependencies and Chromium ready; original/ empty |
| lint | exit0; npm run lint includes ESLint, host checks and all example check-builds |
| gcc-explicit / clang | both exit0; explicit GCC discovery selected /opt/homebrew/bin/gcc-14; Clang checked separately. GCC log retains deployment/rpath warnings, not failures. |
| typecheck | exit0, tsc --noEmit |
| **units** | **exit1**, **141 passed /1 failed files (142); 2413 passed /2 failed tests (2415); 5667.40s** |
| units-native-seh-dual | exit0, **2/2 pass**, **95.38s**, corrected BGT_JSPI=1 |
| e2e-asyncify | exit0, **300 passed /51 skipped**, 0 unexpected/flaky, 552369.25ms browser report duration |
| e2e-jspi | exit0, **300 passed /51 skipped**, 0 unexpected/flaky, 432780.492ms browser report duration |
| oracles | exit0, **68/68 unique successful reports**, 34 pipeline fixtures x2 actual modes |
| leakcheck / diffcheck | both exit0; leakcheck reports974 committable files checked |
| all | exit0 **aggregate marker only**; it does not turn units.exit=1 green |

All 19 top-level Tier-1 exit markers were inspected: units alone is1; the other18 are0 (including pruning markers). Both runner scripts were read. Original units ran with BGT_TEST_JSPI=1 but omitted BGT_JSPI=1. That enabled Node's JSPI API while buildGame's temporary native-SEH manifests emitted only Asyncify artifacts. Both failures are precisely native-seh.test.ts at loadHeadless's explicit “JSPI oracle requires JSPI support and artifact” check. The unchanged test loops through actual Asyncify and JSPI, checks real SEH state and exact retirement; BGT_JSPI=1 builds the missing artifacts. The corrected rerun passed both tests without source, deadline or skip changes. **Aggregate acceptance uses the explicitly reviewer-approved original full run plus that targeted rerun; there was no second full green npm test.**

### Inventory, actual modes and fixed skips

- Default unit source inventory is142 files (140 under tests/unit plus the two default oracle-tooling files), matching the full run's142. No full-suite file exclusion was added. The original runner did not explicitly unset inherited BGT_CI_LIGHT, but full142 inventory and scale evidence are consistent with the complete suite, not the CI-light subset.
- Both E2E reports contain all **63/63 current spec files**, all three configured Chromium projects, one result per test, no retries/flakes/errors. Per mode: **WebGL2 135 pass/24 skip; WebGPU157 pass/26 skip; auto8 pass/1 skip**. Scale's1.6M-instruction/300-frame native-checksum test passed on both explicit renderers in both invocations.
- Both parent runners export **BGT_REQUIRE_WEBGPU=1**, and source availability probes fail rather than skip when required. There are no adapter-unavailable or software-pixel-waiver skips/annotations in these reports. Both modes include real required WebGPU and WebGL2 testing.
- Coverage attachments corroborate actual suspension selection: Asyncify invocation282 Asyncify/2 JSPI snapshots (explicit dual-mode recorder); JSPI invocation272 JSPI/12 Asyncify snapshots. The latter exceptions are deliberate loader/fallback tests and unavailable-startup diagnostics, not silent fixture fallback. Thus “both suite modes” must not mean every test executes exclusively one mode.
- The same **51 fixed skips** occur in each report:20 WebGL2-only contracts in the other project;18 WebGPU-only fixture/loss tests in the other project (10 annotations omit reason text but source guards are backend-specific);6 opt-in broken-WebGPU policy cases;3 opt-in no-adapter reproduction cases; and4 backend/start-context/tour/cross-backend deduplications. They are not51 hardware failures or newly waived assertions. Opt-in negative availability reproductions were not exercised.
- Oracle inventory exactly matches all34 current examples/*/game.json with pipeline configured; no fixture omission/duplicate. Every saved individual JSON matches all.json and its log completes one passing oracle. All68 have requested/completed/comparedFrames300, identical=true, null divergence/failure/error, matching final hashes and full trace digests, enabled accounting, **equal final total and stable-thread-id retirement totals**, lifted interp_insns0 and stubs[]. Both lifted/interpreted execution_summary.suspension match each report's mode. x64-smoke intentionally has20 pre-roll updates plus300 compared frames; its320 update counter is not reduced coverage.

Oracle inventory: win32-conformance, win32-hello, x64-audio, x64-audio-init, x64-basics, x64-contracts, x64-cpp, x64-cpprt, x64-crt, x64-gl, x64-gl-blit, x64-gl-capacity, x64-gl-current, x64-gl-default-vao, x64-gl-fbo, x64-gl-feedback, x64-gl-integer, x64-gl-ranges, x64-gl-scale, x64-glsl, x64-gui, x64-handles, x64-heap, x64-imports, x64-input, x64-memory, x64-scale, x64-smoke, x64-sysdlls, x64-threads, x64-tls, x86-handles, x86-heap, x86-threads.

### Checkpoint and debug identity

All seven logs/checkpoint-*.exit markers are0; focused log actually reports10 pass/179 selection skips,97.23s. Three debug-identity JSON files contain **six comparison rows**, not six separate JSON files. Each fixture's checkpoint identity log ends in1/1 pass with exit0; the test asserts byte equality of every non-custom wasm section against ordinary -g0 builds before writing rows.

| Fixture | Asyncify / JSPI compared non-custom bytes |
|---|---:|
| VM | 1,356,293 /1,481,547 |
| flags | 1,317,026 /1,441,024 |
| memory | 1,317,022 /1,441,023 |

The reports contain mode/length, not standalone equality hashes: acceptance combines their rows with the actual assertion source, successful logs and exit markers. Earlier12-test IMUL+shift pass and stopped codegen attempt are historical, not final-source broad passes.

## Measurement attribution and retention

Checked all12 records' rank ordering/operator sums and owner groups against retained forms-summary.json; all9 pair records exactly match scratch paired samples, and recalculated all18 mode medians, paired differences, min/max ranges and percentages. Rehashed all retained base/imul debug wasm inputs and Asyncify/JSPI manifest artifacts successfully. Retained base/imul evidence has330 matching lifted/interpreted API hashes per mode, exact final retirement totals/thread ids and enabled accounting. Counted summaries' asserted core accounting/coverage metrics match uninstrumented JSPI evidence. The12 preparation,12 counted-run and9 pair logs have actual1/1 pass summaries and exit0.

The instrumentation visits original WAT nodes and never walks its added diagnostics. Reporting excludes block/loop entry markers, entries/exits and overlapping EA slices. DWARF line/inline-caller attribution and dynamic IMUL helper context are diagnostic compiler-source labels, not disjoint causal costs. Form, boundary and owner/runtime views overlap and must not be summed. Census is JSPI; preparation and timing exercise both actual artifacts. CPU sampling is off; accounting stays on. Instrumented artifacts are not timed. Counter analytical tests corroborate control-flow, memory/EA, conversion and source-parent attribution handling, not arbitrary compiler/fixture correctness.

Retained VM values are supported: IMUL11,430,597→1,608,792 attributed original operators; lifted-owner427,098,436→411,719,551; runtime55,421,220→46,627,446. Flags/memory JSPI artifacts are byte-identical base versus IMUL, not merely equal attributed counts. VM JSPI bytes shrink1,525,622→1,525,277.

Timing method really is30 warm +300 timed host updates, one discarded then9 alternating-order fresh-instance pairs; initialization excluded. Retained IMUL paired median deltas (ms):

| Fixture | Asyncify (range) | JSPI (range) |
|---|---:|---:|
| VM | -0.219 (-2.322..+2.091) | -0.717 (-1.455..-0.643) |
| flags | -0.001 (-0.211..+0.101) | +0.015 (-0.175..+0.850) |
| memory | -0.062 (-2.206..+4.687) | -0.137 (-0.685..+1.049) |

VM-JSPI's normalized paired median is-5.480%, all9 deltas negative. Other retained cases are neutral within paired spread, including the small positive flags-JSPI median; this meets the stated retention criterion, not a statistical guarantee of no regression. Rejected ALU's VM-JSPI and flags-Asyncify deltas are consistently positive; rejected shift lowers attributed SHL but raises owner work30,524 with neutral timing. Their rejection is supported. **Shared-host wall time is not isolated CPU latency, guest frames, game gains, or a portable performance promise.**

Evidence limit: narrow/shift/count intermediate trees were already pruned before this session. Their measurements/hashes and historical successful/failed/aborted logs remain, but I cannot independently rehash removed counts.json or rejected wasm bytes. Retained base/IMUL artifacts and WAT do remain and were audited. This does not block narrow-IMUL retention, but “all original intermediate artifacts remain” would be unsupported.

## Independent commands actually rerun

Heavy test commands were run **serially in background** through scratch scripts, with start/end/log/exit files. Environment exported BGT_CPU_ACCOUNTING=1 BGT_REQUIRE_WEBGPU=1 BGT_TEST_JSPI=1 BGT_E2E_PORT=5293 BGT_BUILD_JOBS=2 BGT_TRIAL_SCRATCH=/Users/dev/projects/pi-work/scratch-K41; BGT_CPU_PROFILE/BGT_PROFILE_NAMES unset (also BGT_CI_LIGHT unset). No deadline/coverage changes.

1. **npm test -- --maxWorkers=1 tests/unit/codegen.test.ts -t 'IMUL|eager ALU'** — validation-focused.exit0, **8 passed/181 selection skips (189),93.43s**. Eight means the four selected tests under both size/fast policies, not the historical checkpoint's broader10-test selection.
2. **npm exec -- node --test tools/bench/k41-count-unit.test.mjs tools/bench/k39-count-unit.test.mjs** — validation-counters.exit0, **9 passed,0 failed/skipped,3198.40ms** (5 K41 +4 K39 analytical tests).
3. **python3 /Users/dev/projects/pi-work/scratch-K41/validation-audit.py** — corrected audit exit0; details in validation-audit-corrected.log. Initial audit exit1 is preserved: my audit initially expected300 updates for smoke and was corrected to account for the unchanged20-update pre-roll; all oracle compared-frame assertions stayed300. This was an audit-script assumption, not a kit/test fix.
4. Read-only Git identity/status/diff checks, including **git diff --check 4573726 91d4f22** (exit0), and source/report parsing/hash checks described above. **python3 .../validation-cleanup.py** exited0 and removed458 newly generated cache/web files using the saved pre-run inventory; preexisting file payloads, scratch root, immutable measurements and historical logs were preserved. Final tracked source status remains clean at91d4f22.

I did **not** rerun the full unit suite, browser suites, all oracles, timing experiments or six identity builds; those are audited parent evidence, not delegated or independently rerun claims. No installs/network/original binaries/push/CI requests were used.

## Pending handoff audit and acceptance boundary

Audited **K41-draft.md**, SHA256 **31abbf78d4f6202db54c5dec23556731b5f06e459f6b618e8a4129fd065c1cd4**. Its quantitative claims, narrow retention decision, overlap/timing disclaimers and honest unit split are supported. No blocking unsupported production/performance claim was found. Its **Final gates and independent validation section is explicitly PENDING**: it is not yet a completed final handoff.

Before final publication, populate that section with the actual counts/split above; preserve units.exit=1 and the corrected rerun separately; report fixed51 skips and local required-WebGPU scope; describe six comparisons in three identity files accurately; do not claim all pruned intermediate artifacts survive or a broad independent rerun. These are completion/reporting requirements, not repairs made by this validator.

**No source fix is required by this review.** Acceptance is bounded to this commit, these CC0 controls, finite differential tests, the audited local Tier-1 evidence and the reviewer-approved unit split. This is not CI, opt-in negative hardware-policy coverage, Firefox/WebKit/iPhone/device validation, arbitrary-game correctness, or universal game performance. No port L1/L2/L3 level is applicable.
