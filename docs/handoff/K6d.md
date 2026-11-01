# Lane K6d — CRT file metadata on the shared VFS (Q24) and registry value deletion

Based on integration commit `ca2cd17`. The initial implementation arrived as **WIP (untested)**; a fresh verifier
reviewed, fixed and completed it. **Tier 1 is green** on the final implementation; only documentation/commit
housekeeping followed the final gates. No push, web, game-file use, dependency/ABI change, engine-specific path,
assertion weakening or new skip. See [the contract](../../platforms/win32/CONTRACTS.md#crt-metadata-directories-and-paths-on-the-shared-vfs-k6d).

## Defect and implementation

Q24: `GetFileAttributesW` recognized `C:\GAME` and a newly created directory while `_wstat64` returned
`-1/ENOENT`. The CRT consulted its private FILE nodes and asset opens instead of the kernel's metadata index;
i386 did not even have CRT errno helpers.

- **One implementation** in `w32_fs.h`: drive/root/dot/cwd resolution, case-insensitive keys with displayed case,
  shipped/mutable nodes, times, stat, mkdir/rmdir, delete/move, chdir, open validation and fullpath. Both kernel32
  and CRT front ends call it. CRT-specific code in `w32_crt_fs.h` supplies errno translation and guest layouts.
  Registered once in the KERNEL table for both widths; seven superseded `crt.def` entries removed.
- **CRT families:** `_stat32/32i64/64i32/64`, `_wstat*`, `_fstat*`; legacy msvcrt `_stat/_stati64/_wstat/_wstati64/
  _fstat/_fstati64`; narrow/wide findfirst/findnext in all six forms plus findclose; access/access_s, mkdir/rmdir,
  chdir/getcwd/getdcwd/fullpath/getdrive/chdrive; remove/unlink/rename, including wide forms; i386 errno helpers.
  Explicit struct sizes/offsets are checked against the MinGW headers for both guest widths. Legacy stat aliases
  use 32-bit time on i386, 64-bit time on AMD64, per the reviewer-approved decision; UCRT uses explicit names.
- **Kernel32 agreement:** Create/RemoveDirectoryA/W, DeleteFileA/W, MoveFileA/W, Get/SetCurrentDirectoryA/W,
  GetFullPathNameA/W, GetFileAttributes[Ex]A/W, FindFirstFileW/ExW and FindNextFileW share those operations/index.
  Asset opens resolve relative to the same cwd. AMD64 hooks retain FILE-owned bytes across rename/remove and
  answer fstat; i386 character fds 0..2 are supported without pretending it has the AMD64 FILE layer.
- Non-root enumeration starts with `.` and `..`; root lists neither. Names preserve original case, attributes,
  sizes and distinct directory/parent timestamps. The old K2 `nested/*.*` count assertion was corrected from 2 to 4
  (`.`, `..`, two files), as approved, not relaxed.
- `fopen` rejects missing parents (`ENOENT`) and directories (`EACCES`) instead of creating chains. Closed
  process-local files can be deleted by kernel32 or CRT; shipped files remain read-only, open files deny deletion.
  Mutable file creation touches its indexed parent's write time; content writes touch the file, not the parent.
- Registry `RegDeleteValueA/W` now implement deletion via a zero-length storage tombstone (no storage-delete ABI).
  Queries see file-not-found; missing/denied/invalid handle returns 2/5/6. NULL/empty names both address the default
  value across A/W calls. Census status changed from stub to implemented; RegDeleteKey remains unsupported.
- `_findfirst*` failure is sign-extended to the guest intptr_t width in `w32_core.c`. Ordinary int returns are not
  required to fill the upper register bits. Minimal i386 normal-CRT startup adapters were added; its existing
  `_set_app_type` notification remains an explicitly counted stub.

## Verifier fixes and review

Critical review added and repaired defects beyond the original root-stat symptom:

1. Default-value deletion incorrectly rejected NULL while set/query accepted it. Both NULL and empty aliases now
   delete the same stored record, preserving siblings and allowing recreation.
2. Enumeration emitted the searched directory's times for both `.` and `..`. It now retains separate triples.
3. Anonymous tmpfile fstat fabricated current timestamps on every query. Node metadata is stable across queries;
   writes advance mtime while ctime stays fixed.
4. Wide fullpath allocation multiplied a narrowed count without checking overflow. Full size_t is retained on
   AMD64, capacity is checked before narrowing/multiplication, and unrepresentable allocations fail `ENOMEM`
   without writing. Boundary probes cover wrap counts and AMD64 counts above 32 bits.
5. Named mutable file creation did not update its indexed parent. Delayed creation now checks parent metadata
   through CRT, kernel32 and enumeration. Shipped-index initialization does not synthesize parent mutations.
6. Trailing separators were ignored in search and regular-file rename destinations. Searches fail with error 2,
   file moves to separator-terminated destinations with error 3, before mutation. These mappings are explicitly
   **INFERRED** and reviewer-approved. Fullpath retains a trailing separator; GetFullPathName returns a NULL
   file-part pointer for root/trailing results, with pointer-width A/W regressions.
7. The K2 generic invocation helper declares every export as returning uint64_t. Its `_wchdir/_wrmdir` checks
   incorrectly required full-width UINT64_MAX for **int** return values; they now assert signed low-32-bit -1.
   This repairs the wrong test ABI rather than sign-extending every int result or weakening the -1 assertion.
8. Fixture execution/oracle now runs **600 frames and requires both guests exited**, so delayed tmpfile and
   registry checks cannot be hidden behind an identical 300-frame prefix. Pipeline example oracles remain 300.
   Character-device fstat layouts are also checked on both widths.

The new dot/default-value regressions were executed against the earlier implementation and failed as intended
(`regressions-before.log`: 2 failed / 1 passed). The first focused attempt also encountered a missing x86-handles
build artifact and a stale/mismatched contracts oracle; these are not counted as green. A real example build and
all final focused/default tests followed the fixes. No correct assertion was removed, timeout raised, or skip added.

## Final verification

All heavy commands ran through the inherited machine-wide FIFO npm/npx gate, with no duplicate run or bypass.
Private raw logs are in `/Users/dev/projects/pi-work/scratch-K6d/verification/`; generated reports are ignored.
Final implementation was unchanged during the final Tier 1 sequence (UTC 03:28–03:44 on 2026-11-01).

| Gate | Actual final result / evidence |
|---|---|
| Focused handoff suites | **32/32 tests, 6/6 files**, no failures/skips (`focused-final.log`): crt-fs, integration-i3, contracts, handles, crt, win32-profile |
| `npm run doctor` | ready (`doctor-final.log`) |
| `CC=clang npm run lint` | ESLint, real host GCC and **24/24 example check-builds** pass (`lint-final.log`); Apple clang **21.0.0**, GCC **14.2.0** |
| `npm run typecheck` | pass (`typecheck-final.log`) |
| `npm test -- --reporter=verbose` | **576/576 tests, 53/53 files**, no failures/skips (`unit.log`) |
| `BGT_REQUIRE_WEBGPU=1 BGT_E2E_PORT=5214 npm run test:e2e` | **200 passed / 51 existing intentional skips / 0 failures / 0 flaky** (`e2e.log`, `reports/e2e-results.json`) |
| Both browser backends + auto | WebGL 2 **91 passed / 24 skipped**; WebGPU **101/26**; auto **8/1**. Neither backend unavailable. Developer `:5173` untouched. |
| Every pipeline CLI oracle, 300 frames | **20/20**, **6,000 identical frame pairs**, null errors, zero lifted interpreted instructions, empty profile/GL stub lists, success exits |
| CRT fixture, both widths/modes | i386 **251 checks**, AMD64 **330 checks**, each lifted and interpreted, no guest FAILs, zero lifted interpretation; both **600-frame** oracles identical and both guests exited |
| `npm run leakcheck` / `git diff --check` | clean; leakcheck rerun after final documentation/config cleanup |

Pipeline inventory was generated from **every** `examples/*/game.json` with a pipeline, not a historical list:
win32-conformance, win32-hello; x64-audio, x64-basics, x64-contracts, x64-cpp, x64-cpprt, x64-crt, x64-gl, x64-gui,
x64-handles, x64-input, x64-memory, x64-scale, x64-smoke, x64-sysdlls, x64-threads, x64-tls; x86-handles,
x86-threads. Each ran `npm run oracle -- examples/<id> 300` **after** unit/browser gates; reports were re-read and
validated (`verified-summary.json`). Four native examples (bench, gpu-readback, gpu-scenes, sample2d) have no guest
interpreter: oracle N/A, covered by builds/browser tests, not credited with differential evidence.

The temporary git-excluded `vitest.k6d.config.ts` (focused run without global setup) was **deleted**. The final
unmodified default suite did use its normal global setup. No local test config is committed.

## Independent review provenance

An actual separate fresh session performed read-only static review (`independent-review.md`), found the allocation,
parent-time and trailing-path bugs, and initially returned FAIL. Those findings were fixed with regressions.
A later attempted recheck failed due to provider availability; an inherited-fork recheck is **not** credited as
independent evidence. A final **genuinely fresh** session (bridge disabled, inherited fork arguments explicitly
cleared) inspected the final R1–R4 repairs, fixtures and int-width assertions and returned **PASS within static
scope / no concrete remaining blocker** (`independent-recheck.md`, `recheck-fresh-result.txt`). It ran no builds or
tests. Executable Tier 1 results above are the verifier's own runs, not attributed to a static reviewer.

## Fixture coverage and retained limits

`tests/fixtures/c/crt_fs.c` is original CC0, normally linked MinGW `-O2` for x86 and AMD64. It covers root/new/nested
stat and all layouts, directory nesting/case, enumeration names/order/attributes/sizes/times, cwd/path agreement,
rename/remove and unchanged state on failure, errno cases, fullpath capacities/pointers/allocation boundaries,
registry delete/missing/recreate/sibling/default/rights/invalid handles. AMD64 additionally covers named writes,
file and parent times, fstat, open-file sharing failures, content-preserving subtree moves, relative creation,
fopen errors and anonymous tmpfile metadata. The TypeScript test checks the complete name census and tombstones.

- **i386 still has no FILE layer** (`fopen`, `_open`, ...); mutable files are AMD64-only. Its fixture checks
  directories, shipped metadata and character fds; it is not advertised as full i386 stdio.
- Native Windows was not run. UCRT mappings for file-as-directory/invalid names, invalid drives, legacy msvcrt
  layout aliases and the newly selected trailing-path errors remain **INFERRED**, with approved choices documented.
- One drive; `C:\` aliases `C:\GAME`. ASCII paths, index-order enumeration, no short names, chmod/utime/futime,
  hard links or ACLs. The synthetic root/shipped timestamps remain the clock origin; mutable indexed directories
  track changes. Reads do not advance atime. No persistent writable kernel-file backend.
- Registry deletion leaves an empty storage entry; no RegDeleteKey family.
- Cold lifted i386 normal-CRT compilation is expensive; the existing test carries a 30-minute budget. Final warm
  unit execution was about 9 seconds per guest width. No native-device, remote-CI, game-playability or performance
  claim is made by these local Chromium/synthetic gates.
