/* K75: Win32 profile APIs whose behaviour depends on the caller's EFLAGS (the fast emitter's observed-flags set). MIT.
 * Kept beside the emitter, not in platforms/win32: lifted code generation depends on the architecture and this list,
 * never on profile headers (tests/unit/incremental-build.test.ts).
 * They store X.flags in a CONTEXT (w64_context_save): RtlCaptureContext directly; RaiseException, RtlUnwindEx
 * (outside a dispatch) and the heap APIs that raise STATUS_NO_MEMORY under HEAP_GENERATE_EXCEPTIONS through
 * unwind_exception's initial context. Every other profile API ignores and preserves EFLAGS (x86_callback64 restores
 * them around guest callbacks). The fast lifter (lift64_fast.h) makes EFLAGS exact at calls to exactly
 * these imports; tests/unit/lift-fast.test.ts checks this list against the profile sources (platforms/win32). */
#ifndef LIFT64_EFLAGS_H
#define LIFT64_EFLAGS_H
#define W32_EFLAGS_OBSERVERS "RtlCaptureContext", "RaiseException", "RtlUnwindEx", "HeapCreate", "HeapAlloc", "HeapReAlloc"
#endif
