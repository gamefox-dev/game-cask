/* Misbehaving game variants for host tests; select with -DVARIANT=n. */
#include "bgt.h"
BGT_DEFINE_IO(io)
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) {
    (void)p;
#if VARIANT == 1
    io.logical_width = 0; /* invalid size */
#elif VARIANT == 5
    io.logical_width = 99999; io.logical_height = 10;
#else
    io.logical_width = 64; io.logical_height = 64;
#endif
#if VARIANT == 2
    BGT_LOG_LITERAL(BGT_LOG_INFO, "probe");
    return BGT_E_UNSUPPORTED;
#endif
    return BGT_OK;
}
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) {
    (void)dt;
#if VARIANT == 3
    bgt_abort(BGT_E_STATE, "deliberate abort", 16);
#elif VARIANT == 4
    __builtin_trap();
#elif VARIANT == 6
    /* hostile ranges: must return errors, never touch memory outside the module */
    char buf[4];
    int32_t a = bgt_asset_read(1, (void *)(uintptr_t)0xfffffff0u, 64);
    int32_t b = bgt_storage_write("k", 1, (const void *)(uintptr_t)0xfffffff0u, 64);
    int32_t c = bgt_submit_commands((const void *)(uintptr_t)0xfffffff0u, 64);
    int32_t d = bgt_storage_write("bad key!", 8, buf, 4);
    int32_t e = bgt_asset_open("../etc/passwd", 13);
    if (a == BGT_E_BOUNDS && b == BGT_E_BOUNDS && c == BGT_E_BOUNDS && d == BGT_E_INVALID && e == BGT_E_INVALID)
        BGT_LOG_LITERAL(BGT_LOG_INFO, "hostile-ok");
    else
        BGT_LOG_LITERAL(BGT_LOG_ERROR, "hostile-unexpected");
#endif
}
BGT_EXPORT(bgt_render) void bgt_render(void) {}
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
