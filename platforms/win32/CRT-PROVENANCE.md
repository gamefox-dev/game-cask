# CRT backend provenance and boundaries

The Win64 bridge files (`w32_crt*`, `crt.def`) are original MIT kit code. They adapt Windows LLP64,
UTF-16, va_list, callbacks, FILE tokens, deterministic process state and guest pointers. No application
or engine input contributed to these implementations.

Numeric formatting/parsing, UTC calendar conversion and binary32/binary64 math are **linked from the
installed Zig 0.13.0 wasm32-wasi toolchain libc/libm**. They are not hand-written approximations and are
not downloaded dependencies. Toolchain sources and notices are under Zig's `libc/wasi`, `libc/musl`
and `libc/include/wasm-wasi-musl`. Musl is MIT (Rich Felker et al.); individual math implementations
also carry permissive Sun/FreeBSD/Arm notices. Redistributors must retain the toolchain's applicable
libc/libm notices, as with the compiler's MinGW/libc++ runtime linked into source-built PE fixtures.
No copied libc source is maintained in this repository.

WASI is a **link-time implementation detail**, not an additional runtime capability. The bridge
provides deterministic/private implementations of the libc backend's random/fd hooks; no WASI imports,
host files, environment or wall clock are exposed. Tests require every final wasm import to be from
`bgt`. Host malloc uses a bounded, reusable 64 MiB arena; guest malloc uses the guest heap.

The surface is intentionally not universal Windows compatibility: C locale/ASCII multibyte conversion,
UTC local time and an empty environment; shipped profile files are read-only, with separate in-memory
CRT write/temp files (not persistent storage). Extended precision, positional printf, secure/locale
families not present in `crt.def`, multithreading and MSVC-specific exception personalities remain gaps.
Unknown static imports still fault with full DLL!symbol; dynamic lookup returns NULL. Classification
in the import census is implementation availability, not a guarantee every caller or flag is supported.
