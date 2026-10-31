# Lane K5b — bounded CRT FILE buffering (Q16)

Implementation **`1735e47`**, branch `lane/K5b`; this handoff is a documentation-only follow-up. No push,
web, system/dependency installs, game files, engine-specific paths or success stubs. External request evidence
was read in place, never copied into the repository. No target-game execution or startup/playability claim.

## Delivered contracts

- Shared AMD64 MSVCRT/UCRT/API-set FILE implementation: lazy **16 KiB default input read-ahead**, at most
  **64 KiB configured per backend**, freed on close/reopen. Bytes already owned by FILE return without another
  request/yield. Refills still use real deferred BGT requests, including when the host chunk cache is warm.
- Windows setvbuf modes `_IOFBF=0`, `_IOLBF=0x40` (Windows full-buffer behavior), `_IONBF=4`; actual caller-owned
  buffers, even-size rounding, BUFSIZ=512 setbuf, explicit output buffering/full flush/fflush/close/normal exit.
  Invalid modes/sizes fail EINVAL; otherwise valid sizes above the resource bound fail ENOMEM, not fake success.
  Default output remains write-through. All named writes still update the process-local VFS, not host storage.
- Logical physical-byte positions, signed Windows-long ftell versus `_ftelli64`, relative/end/>4 GiB seeks,
  fgetpos/fsetpos, rewind, independent sticky EOF/error, clearerr, one-byte/wide pushback, partial fread elements,
  and positioned read/write interleaving. Text CRLF/LF and control-Z; binary bytes unchanged. Wide binary character,
  string and formatted output use UTF-16LE; text wide I/O remains C/ASCII with EILSEQ for unavailable conversions.
- `_fileno`/`_fdopen` aliases share the backend and lifetime. Raw `_read`/`_lseek`/`_lseeki64` use the physical
  descriptor cursor, not ftell's buffered cursor. fflush/position synchronizes them. `_read` budgets source bytes
  before text translation, preserves descriptor control-Z EOF until seek, and accounts actual raw bytes read.
  `_setmode` supports `_O_TEXT`/`_O_BINARY`; unsupported Unicode modes/`ccs=` are rejected.
- Fixed an existing incorrect `x64-contracts` expectation: binary fwprintf now checks **all 12 UTF-16LE bytes**
  of six characters, rather than blessing six narrow bytes. No assertion, workload or skip policy was weakened.

### Strict slice / byte accounting

Minimal additive BGT imports: `asset_read_ahead`, `asset_consumed`, `asset_observed`; old range requests retain
unchanged semantics. This shared-runtime change was raised through the reviewer bridge; timeout selected the
stated default to implement the required additive accounting rather than overcount coverage.

Read-ahead stops at **both the current 64 KiB boundary and actual manifest chunk boundary**. It cannot enter an
adjacent omitted chunk just to fill a buffer. An omitted starting/demanded chunk still stops outside the slice.
Consumption expands packaging coverage only to actual manifest chunks (64 KiB for eager assets). Untouched
speculation is separate `readAhead` coverage / `crtReadAheadBytes` / `crtReadAheadRequests`, never packaging evidence.
`crtConsumedBytes` counts actual FILE/descriptor source bytes read, not translated output or chunk downloads;
pushback does not consume a source byte again. Actual non-LF lookahead after CR is an **observed dependency**:
`crtObservedBytes` counts it separately and packaging retains it. Zero-length and beyond-EOF records add nothing.

The regression records, packages and replays CR at offset 65535 with non-LF at 65536; deliberately missing data
still raises OutsideDataRange. CRLF scanning restores physical positions by replaying only the translated consumed
prefix, rather than adding translated counts to physical cookies. Separate integrity-failure tests verify ferror,
not apparent EOF/success, zero consumed/read-ahead bytes, clearerr and rewind.

## Fixture and measured before/after

Original CC0 source: `tests/fixtures/c/crt_buffer.c`; generated synthetic data stays in ignored test output.
Common binary cases compile with host cc and run against native libc; the exact same source runs as a normally
linked `-O2` Windows PE through the pipeline. Windows-specific expectations are known-contract assertions,
**not Windows-native executions**; shared-core oracles are not independent Windows compatibility proof.

| Workload | Requests / updates |
|---|---|
| Same first 4096 byte reads, `_IONBF` (measured prior unbuffered-cost comparator, not a parent-commit timing) | **4096 requests / 4097 updates** |
| Same first 4096 byte reads, default FILE buffering | **1 request / 2 updates**, 4096 consumed bytes, 16384 read-ahead bytes |
| Sequential 262181-byte fgetc loop, with regular ungetc/position checks | **exactly 17 fills** = ceil(262181/16384) |
| Entire mixed fixture, also fread/seeks/aliases/scanning/text/wide/output/error checks | **39 read-ahead requests / 49 updates** |

Bound: **one deferred yield per nonempty buffer refill**, shortened at chunk boundaries; zero I/O yields for
owned bytes. Default aligned sequential input needs at most four fills per 64 KiB source chunk (one per 16 KiB),
not one per character. CPU-quantum yields are separate. The full expanded fixture asserts **≤50 read-ahead
requests / ≤64 updates**; individual descriptor operations are intentionally unbuffered. Final measured totals:
**262276 source bytes consumed, 2 observed bytes, 327899 read-ahead bytes**. Source chunk downloads are a different
counter. Native checksums: small **3329521664**, large **4121885618**, zero fixture failures. The fixture also has
an identical 300-frame differential oracle and a successful strict-package replay.

Compact developer evidence: ignored `reports/crt-buffer.json`, `reports/K5b-oracles.json`, `.scratch-K5b/` logs.

## Final gates (implementation commit above)

All final broad checks ran **serially**, with no source edits during them:

| Check | Result |
|---|---|
| doctor | ready |
| lint | ESLint, real **GCC 14.2.0**, all **24 example check-builds** pass |
| typecheck | pass |
| npm test | **528 tests / 48 files**, zero failures/skips |
| BGT_REQUIRE_WEBGPU=1 npm run test:e2e, owned port **5206** | **200 passed / 51 unchanged intentional skips / 0 failures**, zero flaky |
| browser split | WebGL2 **91/24 skipped**, WebGPU **101/26 skipped**, auto **8/1 skipped** |
| leakcheck / diff --check | clean |
| explicit pipeline CLI oracles | **20 × 300 = 6000 identical frame pairs**, errors null, lifted interp_insns=0, empty stub lists |

Oracle inventory: x64-audio, basics, contracts, cpp, cpprt, crt, gl, gui, handles, input, memory, scale, smoke,
sysdlls, threads, tls; x86-handles, threads; win32-conformance, hello. Native bench/gpu-readback/gpu-scenes/sample2d
have no interpreter oracle; their build/browser/known-result coverage is not called a differential self-oracle.
The final unit/browser runs overwrite some oracle report filenames with other workloads; the three affected
examples were explicitly rerun at 300 afterward and the 20 reports validated into `reports/K5b-oracles.json`.

Earlier red runs are retained, not disguised: a build observed an intermediate edited header, one full run used
mismatched implementation generations, a concurrent CLI/unit GL oracle comparison failed, and a temporary bundled
debug script was picked up by ESLint. The debug output was removed; final **serial** npm test/lint/browser runs
passed unchanged assertions. No ENOSPC occurred. Temporary source/native fixtures are removed by tests; reusable
compiler caches and compact evidence remain. No files outside this lane were cleaned or servers reused.

## Independent validation and remaining scope

Three real **fresh independent sessions** ran, not a claimed unexecuted delegation. The first found five concrete
issues (translation dependencies, sticky-error/EOF, stdout flush order, raw text quota, zero-byte coverage). The
second confirmed those repairs and found physical scanning-position and descriptor byte-accounting gaps. All
seven were repaired with fixture assertions. The final session independently executed extracted-current-source
C probes, native common-source checks and actual host/VFS/RangeFiles probes: **PASS within bounded scope**.
Negative controls removing each last repair failed 6 position and 11 accounting assertions. That reviewer did
not run broad/browser suites; the green gates above are developer evidence. Full review logs remain ignored.

**Open boundary:** concurrent access to the **same FILE/backend is not internally serialized**. Existing LIFO
native scheduler continuations can deadlock if a blocking FILE lock is added alone; callers must serialize such
access. This was raised through the reviewer bridge; timeout selected the documented bounded-scope default,
not a claim of Windows thread-safe stdio. General parked-native continuation switching plus FILE locks remains
scheduler/CRT work. Different FILEs retain normal cooperative scheduling.

Other existing limits: shared CRT is AMD64-only, C/ASCII text locale, no Unicode ccs/_O_U8TEXT/_O_U16TEXT,
no persistent filesystem writes or general Windows stdio compatibility. Formatted scanning still gathers the
input using its preexisting bounded-host-arena strategy; this lane fixes translation/position correctness, not
an unrestricted multi-GB streaming scanf implementation. No game-speed, target-boot, physical-device or universal
Windows/native parity claim follows from these synthetic fixtures.
