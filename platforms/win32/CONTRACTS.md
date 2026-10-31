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

Descriptor and FILE aliases share position; closing/reopening invalidates aliases. Reopening standard output
redirects fputs/puts/printf/putchar through its new backend. FILE error/EOF flags are reflected in guest records.
Read failure is -1, not apparent EOF; invalid descriptor is EBADF. Wide time formatting counts UTF-16 units,
including surrogate pairs. Secure copies clear the destination on range failure. `_vsnprintf_s` supports
_TRUNCATE and bounded count. CRT buffer helpers honor successful memory protection changes.

Shipped files remain read-only; mutable/temp files live in process memory. `_wfsopen` accepts _SH_DENYNO;
deny modes fail EACCES rather than claiming unimplemented sharing. In-memory files without a kernel handle make
`_get_osfhandle` fail EBADF. Missing paths fail ENOENT, shipped writes/removal fail EACCES, duplicate rename targets
fail EEXIST. `_wrmdir` fails EACCES (directory deletion not supported). `_wchdir`/SetCurrentDirectoryW currently
accept only the virtual C:\\GAME root. No persistent writable filesystem or complete text-mode/locale parity.
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
ERROR_ALREADY_EXISTS, missing parents ERROR_PATH_NOT_FOUND. DeleteFileW cannot delete CRT-owned mutable nodes
through the kernel handle layer and fails access denied (missing names: file not found); CRT removal is supported.

Current-directory/environment size-query/short-buffer/case-insensitive variable update/delete contracts, virtual
C: drive mask, single-CPU affinity, virtual-clock GetTickCount64, UTC timezone/calendar conversion, unknown battery
status, US language/locale subset, DBCS lead-byte classification and system FormatMessageW messages are implemented.
FormatMessage supports allocate-buffer ownership through LocalFree, not arbitrary module/string-format insertion.
GetHandleInformation reports ordinary file-handle flags; SetHandleInformation cannot enable inheritance/protect-close
and returns ERROR_NOT_SUPPORTED. DuplicateHandle validates the source then fails ERROR_NOT_SUPPORTED; no fake alias.
GetExitCodeProcess accepts the current process pseudo-handle and reports STILL_ACTIVE. Other process handles are
not fabricated. GetTempFileNameW supports nonzero-unique name construction only; automatic file creation fails access
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
| OpenProcess | NULL, ERROR_INVALID_PARAMETER for absent PID; current PID unsupported |
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
