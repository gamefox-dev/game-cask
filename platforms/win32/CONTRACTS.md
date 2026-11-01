# Bounded existing-DLL contracts (K2)

These are OS/CRT contracts, not engine detection or game behavior. `examples/x64-contracts` is original CC0,
normal MinGW-target `-O2`/CRT startup. Its named assertions check outputs, errors, ownership and callbacks;
`tests/unit/contracts.test.ts` also checks both-width registry resolution and actual denied memory accesses in
lifted/interpreted execution. Browser tests inject pointer movement and require one hover and one leave.
Availability is not unrestricted Windows compatibility.

## Memory and startup

`VirtualProtect` validates every page and allocation boundary before changing anything, writes the first page's
previous protection, and maintains per-page PAGE_NOACCESS/READONLY/READWRITE/EXECUTE/EXECUTE_READ/EXECUTE_READWRITE
metadata. Accessors and lifted operand/block guards enforce data permissions; dispatch checks execution permission.
`VirtualQuery` distinguishes free, private and image mappings; returns a region starting at the requested page,
bounded by allocation identity and identical protection. AllocationProtect retains the original allocation policy.
The preexisting loader/heap mappings remain legacy RWX; this does **not** claim PE section-specific DEP or native
Windows address-space layout. Guard/copy-on-write/cache modifiers fail ERROR_NOT_SUPPORTED. Invalid flags/lengths
fail ERROR_INVALID_PARAMETER; unmapped/cross-allocation protection ranges fail ERROR_INVALID_ADDRESS. Outputs are
unchanged on failure. Guest access violations stop with a diagnostic; general guest SEH access-violation delivery,
self-modifying code and reservation-only/decommit transitions are not implemented. VirtualAlloc supports page-rounded
commit(+reserve), zero initialization and separate allocations; VirtualFree supports exact MEM_RELEASE only.

`__iob_func` exposes contiguous 48-byte Win64 MSVCRT FILE records (flags at 24, descriptor at 28), sharing backends
with the UCRT table. `_amsg_exit` terminates immediately with 255, without atexit handlers. `__lconv_init` initializes
the unsigned-character sentinel representation. `__C_specific_handler` handles scope search/filter/termination
callbacks through the Win64 ABI and the existing original-context unwind machinery; it is not a general MSVC C++
personality implementation. The fixture directly tests scope search, negative filter and abnormal-finally callbacks.

## CRT files, formatting and locks

Added descriptor bridges `_read`, `_write`, `_close`, `_fdopen`, `_fileno`, `_get_osfhandle`, `_lseeki64`,
`_filelengthi64`, `_fstat64`, `_wstat64`, `_wfsopen`, `freopen_s`, `remove`, `_wunlink`, `_wrename`, `_wchdir`,
`_wrmdir`; wide/format/string bridges `fwprintf`, `getwc`, `putwc`, `perror`, `_scprintf`, `_vscprintf`,
`_vsnprintf_s`, `_ultoa`, `strcpy_s`, `wcscpy_s`, `_memicmp`, `wcsftime`; `_getpid`, `_beginthread`, `_lock`,
`_unlock`. The shared CRT registry covers msvcrt/ucrt/API-set aliases on AMD64, not a second per-DLL FILE model.

FILE buffering (K5b): default immutable input read-ahead is **16 KiB per backend**, allocated lazily and freed on
close/reopen. Refills retain deferred request/update visibility, including cached source chunks. `setvbuf` accepts
Windows `_IOFBF=0`, `_IOLBF=0x40` (Windows treats it as full buffering) and `_IONBF=4`; caller-owned buffers are
actually used. Configured buffers are 2..65536 bytes (rounded down to even, as MSVCRT does); larger otherwise valid
sizes fail ENOMEM at the profile's per-stream resource bound rather than silently ignoring the requested buffer.
Invalid modes/sizes fail EINVAL. `setbuf` uses Windows BUFSIZ=512, NULL disables buffering. Explicit output buffering flushes on
full buffer, fflush, seek, close, normal exit or direction changes; default output is write-through. Mutable input
uses the same owned-buffer/position machinery without asynchronous requests. Partial fread elements, sticky EOF,
error/clearerr, one pushback, 64-bit positions, relative/end seeks and rewind preserve logical physical positions
rather than exposing the read-ahead cursor. Seek discards pushback and EOF; rewind additionally clears errors.

Binary streams preserve bytes. Text mode translates CRLF to LF, LF output to CRLF, and recognizes control-Z input;
positions are physical byte cookies suitable for fgetpos/fsetpos and absolute seek. The locale remains C/ASCII:
wide text I/O rejects non-ASCII with EILSEQ; binary fgetwc/fputwc/fwprintf use UTF-16LE units. Unicode `ccs=` modes
and `_O_U8TEXT`/`_O_U16TEXT` are not implemented; `_setmode` supports `_O_TEXT` and `_O_BINARY` only.
Input/output switches at an explicit positioning operation/fflush obey update-stream rules; automatic internal
synchronization also prevents speculative bytes from corrupting mutable writes. Callers must still follow C's
position/flush requirements when switching directions or mixing FILE and descriptor I/O. Low-level `_read`
requests a source-byte quota and then translates it; it does not refill to the translated destination quota.

Existing scheduler boundary: operations on **different** FILEs may yield/schedule normally; concurrent access to
the **same** FILE/backend is not internally serialized. Callers must serialize such access. Adding a blocking
FILE mutex alone can deadlock the scheduler's LIFO native continuations and is not claimed as Windows thread-safe
stdio. General parked-native continuation switching plus FILE locks is separate scheduler/CRT work.

Descriptor and FILE aliases share position; closing/reopening invalidates aliases. `_read`/`_lseek`/`_lseeki64`
use the underlying physical descriptor cursor, which can be ahead of ftell after read-ahead. `fflush(FILE*)`
synchronizes it to the logical position; raw operations invalidate buffered FILE bytes. `_fileno` itself does not
flush. Tests cover both an unsynchronized physical cursor and synchronized defined interleaving. Reopening standard output
redirects fputs/puts/printf/putchar through its new backend. FILE error/EOF flags are reflected in guest records.
Read failure is -1, not apparent EOF; invalid descriptor is EBADF. Wide time formatting counts UTF-16 units,
including surrogate pairs. Secure copies clear the destination on range failure. `_vsnprintf_s` supports
_TRUNCATE and bounded count. CRT buffer helpers honor successful memory protection changes.

Shipped files remain read-only; mutable/temp files live in process memory. `_wfsopen` accepts _SH_DENYNO;
deny modes fail EACCES rather than claiming unimplemented sharing. In-memory files without a kernel handle make
`_get_osfhandle` fail EBADF. Missing paths fail ENOENT, shipped writes/removal fail EACCES, duplicate rename targets
fail EEXIST. CRT and KERNEL32 directory changes/removal now share the VFS operations described in
[K6d](#crt-metadata-directories-and-paths-on-the-shared-vfs-k6d), including nested process-local directories.
No persistent writable filesystem or complete text-mode/locale parity.
The deterministic cooperative scheduler owns `_beginthread` lifetime/auto-close and recursive numbered CRT locks.
Suspend counts are independent of sleep/event wait state. Kernel thread priorities -2..2 use K1's bounded
scheduler weights 1..5; IDLE (-15) / TIME_CRITICAL (15) map to the endpoint weights, never host realtime.
GetThreadPriority preserves the requested Windows value. Repeated SetThreadPriority calls do not refill credits;
all runnable peers retain bounded turns. AVRT uses the same scheduler hook (last priority setter wins; reverting
AVRT restores the default scheduler weight). Asynchronous context editing/GetThreadContext fail
ERROR_NOT_SUPPORTED, not fake snapshots.

## VFS and kernel

A generated `bgt-file-index.txt` contains the build manifest's shipped assets/streams (module self-open names,
not loader artifacts). It is build output only. FindFirstFileW/ExW, FindNextFileW, FindClose enumerate that index,
process-created CRT files and process-created directories. Paths are case-insensitive ASCII, separators normalized;
`*`, `?`, `*.*` and extensionless `name.*` matches are supported. Search handles retain independent cursors and
patterns, exhaustion is ERROR_NO_MORE_FILES, invalid/closed handles ERROR_INVALID_HANDLE. FindFirstFileExW accepts
standard/basic info with name matching, not directory-only/device searches. DOS short-name generation and full
Unicode collation are not claimed. CreateDirectoryW creates process-local index entries; duplicate names fail
ERROR_ALREADY_EXISTS, missing parents ERROR_PATH_NOT_FOUND. DeleteFileA/W and CRT removal delete closed
process-local files through the same VFS operation; shipped files fail access denied, open mutable files fail
sharing violation, and missing names fail file/path not found.

Current-directory/environment size-query/short-buffer/case-insensitive variable update/delete contracts, virtual
C: drive mask, single-CPU affinity, virtual-clock GetTickCount64, UTC timezone/calendar conversion, unknown battery
status, US language/locale subset, DBCS lead-byte classification and system FormatMessageW messages are implemented.
FormatMessage supports allocate-buffer ownership through LocalFree, not arbitrary module/string-format insertion.
Kernel objects use the shared scheduler-owned handle table: threads, the current process, events, mutexes,
semaphores, read-only asset files, standard output/error endpoints and opened registry keys. Same-process
DuplicateHandle converts full-width current-process/current-thread pseudo-handles into distinct owned handles,
retains shared object identity/file position, honors SAME_ACCESS, CLOSE_SOURCE (including close-only NULL target),
desired access and independent inheritance flags. A valid owned source is closed on a failed duplication when
CLOSE_SOURCE is requested and the caller has source-process duplicate rights. Get/SetHandleInformation preserve
per-handle INHERIT/PROTECT_FROM_CLOSE; a protected ordinary close fails ERROR_ACCESS_DENIED. Invalid or stale
handles fail ERROR_INVALID_HANDLE without truncating AMD64 high bits; inaccessible output spans fail
ERROR_INVALID_PARAMETER without a write. A NULL DuplicateHandle output has Windows' legacy leaked-handle behavior.
OpenProcess supports this process (PID 1), OpenThread accepts scheduler thread IDs (not handles), and
GetProcessId/GetThreadId, priorities, suspend/resume, exit-code queries and waits resolve aliases to the same object
with access checks. Query-limited rights are supported; no impersonation/ACL or cross-process backend is claimed.
GetExitCodeProcess reports STILL_ACTIVE while running; TerminateProcess validates PROCESS_TERMINATE and uses its
second argument as the exit code. Closed thread aliases never destroy a running scheduler task. Live threads retain
identity without handles; a terminated thread cannot be reopened after its last handle is gone. Mixed waits retain
thread/process/event/semaphore/mutex/file semantics; registry keys are nonwaitable and require RegCloseKey
(CloseHandle has Windows' documented ineffective-success registry exception). Registry value access checks respect
alias query/set rights; registry paths remain process-local. File rights cannot be escalated beyond an opened
read-only asset; unsupported writes fail access denied. Standard endpoints are profile log/input endpoints, not
host Windows consoles. Named cross-process objects, mappings and pipes remain unavailable. The table retains the
profile's bounded **1023 concurrent handles and object identities**, separate from **64 lifetime scheduler threads**.
Closed slots and unreferenced disposable objects are reclaimed. Running thread identities survive zero handles;
completed unreferenced threads are reclaimed. As on Windows, a closed numeric handle may later be reused.
See [THREADS.md](THREADS.md). GetTempFileNameW supports nonzero-unique name construction only; automatic file creation fails access
denied. Hardware-profile/physical-volume data and external processes/pipes/vectored handlers do not exist here.

## USER/GDI and shell/WinMM

One virtual primary monitor exposes screen/work rectangles, display mode and EnumDisplayMonitors callback with
full-width LPARAM. The US keyboard layout/list/name/activation and set-1 MapVirtualKey subset are deterministic.
Raw Input lists the same mouse/keyboard pseudo-devices used in event headers, with size queries, checked structure
sizes and invalid-handle errors. Clipboard byte HGLOBALs are process-local: opening does not transfer ownership,
emptying does; close/reopen retains data, and unsupported non-memory formats fail. No host clipboard permission is
invented. TrackMouseEvent supports client hover/leave, query/cancel, 400ms default and a 4px hover rectangle, driven
by BGT pointer input. Nonclient tracking fails ERROR_NOT_SUPPORTED. Icon construction copies mono mask/color
bitmaps into GDI-owned icon objects, GetIconInfo returns independent bitmap copies and centered icon hotspots;
DestroyIcon enforces ownership/lifetime. GPU-only bitmap histories unavailable for copying fail explicitly.
DrawIconEx is not imported by this requested group and was not added.

Failure-only entries are annotated `FAPI`/`TF` in the **runtime** tables. The census retains implemented dispatch
status but adds `capability:"failure-only"`, distinct from null-handler `stub` and genuinely `unknown` imports:

| Facility / APIs | Explicit result / reason |
|---|---|
| GetCurrentHwProfileA; GetDiskFreeSpaceExA/GetVolumeInformationW; AddVectoredExceptionHandler | FALSE/NULL, ERROR_NOT_SUPPORTED: no Windows hardware registry, physical volume or vectored handler delivery |
| RemoveVectoredExceptionHandler | zero: no valid registration exists |
| AttachConsole; GetConsoleScreenBufferInfo; SetConsoleCtrlHandler/Mode/TextAttribute | FALSE, ERROR_INVALID_HANDLE: no attached Windows console |
| CreatePipe/CreateProcessW | FALSE, ERROR_NOT_SUPPORTED: no external process/pipe backend |
| ReplaceFileW | FALSE, ERROR_ACCESS_DENIED: no kernel writable replacement operation |
| GetThreadContext/SetThreadContext | FALSE, ERROR_NOT_SUPPORTED: no asynchronous context backend |
| ShellExecuteW | SE_ERR_NOASSOC (31), ERROR_NO_ASSOCIATION: no shell association/launcher |
| SHGetKnownFolderPath | HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND), NULL output: no known-folder registry |
| SHFileOperationW | DE_ACCESSDENIEDSRC: no shell mutation service |
| DragQueryFileW | zero, ERROR_INVALID_HANDLE: no HDROP source; DragAcceptFiles is void, no source is fabricated |
| CreatePolygonRgn | NULL, counted unsupported: rectangular region representation cannot preserve polygon masks |
| CreateIconFromResource, FlashWindowEx, SetWindowRgn, RegisterTouchWindow | FALSE/NULL, ERROR_NOT_SUPPORTED: no resource-icon decoder, taskbar flash, polygon window mask or touch registration backend |
| GetTouchInputInfo/CloseTouchInputHandle | FALSE, ERROR_INVALID_HANDLE: no touch handle can exist |
| midiInOpen/GetDevCapsA | MMSYSERR_BADDEVICEID, NULL output for open: zero MIDI input devices |
| midiInClose/Start/Stop/GetID | MMSYSERR_INVALHANDLE: no open MIDI input handle |

midiInGetNumDevs truthfully returns zero; midiInGetErrorTextA validates codes/buffers. timeBeginPeriod/EndPeriod
validate 1..1000ms and balance per-period references (invalid/unmatched: TIMERR_NOCANDO); these are virtual timer
requests, not host scheduling promises. Every requested name has a named fixture check, including rejection paths.

## Import census

`tools/x86/imports-coverage.mjs` expands the runtime tables with the C preprocessor, using the actual ordered
w32_find_api table inventory plus scheduler, architecture-specific CRT/data and Win64 dispatch precedence. COM,
audio, Raw Input, GL and thread APIs are included. DLL registration is checked first; runtime currently has a
shared symbol namespace across registered system DLLs, and the census intentionally mirrors it. Width-aware
GetProcAddress probes cover every registry name and one genuinely absent name. Neither registration nor a matched
oracle establishes universal semantic support, and failure-only annotations are not reported as successful stubs.

## CRT metadata, directories and paths on the shared VFS (K6d)

KERNEL32 and the CRT use **one** process-local index (`w32_fs.h`): shipped manifest entries are read-only, everything
else is process memory. Both front ends call the same `w32_fs_*` operations and differ only in error translation
(Win32 error -> UCRT errno) and guest struct layouts; there is no second CRT-private directory or file table.
Registered once in the KERNEL table, so both guest widths and every DLL alias (msvcrt, ucrtbase, api-ms-win-crt-*)
resolve the same implementation (`_errno`/`_get_errno`/`_set_errno` are added for i386, where the shared AMD64 CRT is
absent). The old `crt.def` entries for `_fstat64`, `_wstat64`, `remove`, `_wunlink`, `_wrename`, `_wchdir`, `_wrmdir`
were removed.

| Area | Functions |
|---|---|
| stat | `_stat32/32i64/64i32/64`, `_wstat*`, `_fstat*`; msvcrt aliases `_stat/_stati64/_wstat/_wstati64/_fstat/_fstati64` |
| find | `_findfirst/_findnext` and `_wfind*` in every variant (`""`, `i64`, `32`, `32i64`, `64i32`, `64`), `_findclose` |
| directories/paths | `_mkdir/_wmkdir`, `_rmdir/_wrmdir`, `_chdir/_wchdir`, `_getcwd/_wgetcwd`, `_getdcwd/_wgetdcwd` (drive 0 or 3), `_fullpath/_wfullpath`, `_getdrive`, `_chdrive(3)` |
| files | `remove/_wremove/_unlink/_wunlink`, `rename/_wrename`, `_access/_waccess/_access_s/_waccess_s` |
| KERNEL32 (same operations) | `CreateDirectoryA/W`, `RemoveDirectoryA/W`, `DeleteFileA/W`, `MoveFileA/W`, `Get/SetCurrentDirectoryA/W`, `GetFullPathNameA/W`, `GetFileAttributesExA/W` (level 0), `GetFileAttributesA/W`, `FindFirstFileW/ExW`, `FindNextFileW`, `FindClose` |

**Layouts** (identical for both widths; checked against zig/clang MinGW headers by `_Static_assert` in the fixture):
`_stat32` 36 bytes, `_stat32i64` 48, `_stat64i32` 48, `_stat64` 56 (`st_dev`@0, `st_ino`@4, `st_mode`@6, `st_nlink`@8,
`st_uid`@10, `st_gid`@12, `st_rdev`@16, then size and the three times); `_finddata*` 280/288/296/304 and `_wfinddata*`
540/544/560/560. Legacy aliases: msvcrt.dll's `_stat/_fstat/_stati64` use the 32-bit-time layouts on i386 and the
64-bit-time layouts on AMD64; UCRT has no plain `_stat` (its headers name `_stat32`/`_stat64i32`/...).

**Values.** `st_mode` follows UCRT: directories `_S_IFDIR` 0x4000 + rwx, regular files `_S_IFREG` + read (+ write unless
FILE_ATTRIBUTE_READONLY, + execute for `.exe/.com/.bat/.cmd`), with the user bits copied to group/other (writable file
0100666 = 0x81b6; shipped read-only file 0100444 = 0x8124; directory 040777 = 0x41ff); character devices (fd 0..2)
`_S_IFCHR` only. `st_dev = st_rdev = 2` (drive C), `st_nlink = 1`, `st_uid = st_gid = st_ino = 0`. Sizes are exact index
sizes; creation/write/access times are the virtual clock (`filetime_now`, advanced by frames and `Sleep`), shipped entries
carry the clock origin. Content writes update the file's `st_mtime`; directory-entry creation/removal/rename
updates the parent's write time. Reads do not touch times. Anonymous temporary files retain their own stable
creation/access/write timestamps across `_fstat` queries. Enumeration's `.` and `..` carry the directory's and
its parent's respective timestamps. 32-bit time/size fields
fail with `EOVERFLOW` instead of truncating. Original case is preserved in enumeration and `_fullpath` (lookup stays
case-insensitive). Non-root directories enumerate `.` and `..` first; the volume root (`C:\GAME`, aliased by `C:\`) lists
neither, as before. Order is index order (manifest order, then creation order), not collated.

**errno** (Win32 error from the shared operation through the UCRT `_dosmaperr` table): missing file/parent `ENOENT`;
`_mkdir` existing file or directory `EEXIST`; `_rmdir` non-empty `ENOTEMPTY`; shipped assets, directories passed to
`remove`, the root, the current directory and files with open handles `EACCES` (open handles are a sharing violation,
as CRT `fopen` shares read/write but not delete); `rename` onto an existing name `EEXIST`, into itself `EACCES`;
`_access` mode bits other than 2/4 `EINVAL`, write on read-only `EACCES`; names with `<>"|` or wildcards and ERROR_DIRECTORY
(`_rmdir`/`_chdir` on a file) `EINVAL` (the table has no entry: INFERRED); `_stat`/`_access` report every lookup failure
as `ENOENT`. `fopen` now requires an existing parent directory (`ENOENT`) and fails `EACCES` on directories (previously
it silently created the missing chain).

**Current directory.** One `C:\GAME[\dir]` current directory is shared by `_chdir`, `SetCurrentDirectory`, `GetCurrentDirectory`,
`_getcwd`, `_fullpath`, `GetFullPathName` and every relative path in kernel and CRT calls (including asset opens).
Typed case and trailing separators are retained in fullpath results. `GetFullPathName` returns a NULL file-part
pointer for a root or trailing-separator result. `..` above the root stays at the root; `C:\` aliases `C:\GAME`;
other drives do not exist. Search patterns ending in a separator fail with Win32 error 2 / `ENOENT` (INFERRED error
mapping; FindFirstFile forbids trailing separators). Moving a regular file to a separator-terminated destination
fails before mutation with Win32 error 3 / `ENOENT` (INFERRED). NULL-output CRT path allocations validate the full
`size_t` count before narrowing/multiplying and return `ENOMEM` if that allocation cannot be represented/satisfied.

**Registry.** `RegDeleteValueA/W` delete from the profile's registry store: the BGT ABI v0.2 has no storage delete, so a
value is replaced by a zero-length record, which `RegQueryValueEx` reports as `ERROR_FILE_NOT_FOUND` exactly like a
never-set value (storage keeps an empty entry). NULL and empty value names both address the unnamed/default value,
including across A/W set/query/delete calls. Missing values return 2, a read-only key handle 5, invalid handles 6,
and denied or failed deletes change nothing. The census entry is `implemented` (no longer `stub`). `RegDeleteKey*`
are not implemented (the store cannot enumerate subvalues) and remain unknown imports that fault by name.

**Limits.** i386 has no FILE layer (`fopen`, `_open`, ...), so mutable files exist only for AMD64 guests; i386 fixtures
create/stat/rename/remove directories and read shipped files. ASCII paths only (non-ASCII becomes `?`, a wildcard).
Paths of 260 or more characters fail creation operations with `ENOENT`. No short names, no ADS, no hard links
(`st_nlink` is always 1), no permissions beyond the read-only attribute, no `_chmod/_utime/_futime`. UCRT mappings
marked INFERRED above were not verified against a native Windows run.
