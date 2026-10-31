/* LANE-K1: same VFS namespace and path normalization as CreateFileW.
 * SPDX-License-Identifier: MIT */
#include "w32_shlwapi.h"
#include "w32_sysdll.h"
#include "w32_thread.h"
int w32_path_exists(const char *path, uint32_t *attrs) {
    /* LANE-K1/K2 integration seam: existing immutable VFS namespace only. */
    uint32_t h = w32_file_open_str(path, 1);
    if (!h) return 0;
    w32_file_close_h(h);
    if (attrs) *attrs = 0x80; /* FILE_ATTRIBUTE_NORMAL */
    return 1;
}
static uint32_t exists(void) {
    /* SHLWAPI does not promise to set last error. Preserve it across the probe. */
    uint32_t saved = *w32_thread_error();
    if (!w32_sys_string(ARG64(0),1,260)) return 0;
    char path[260]; w32_gstr(ARG(0), 1, path, sizeof path);
    uint32_t found = (uint32_t)w32_path_exists(path, 0);
    *w32_thread_error() = saved; return found;
}
#define API(n,a,f) {n,a,0,f}
const w32_api_t w32_api_shlwapi[] = { API("PathFileExistsW",1,exists) };
const uint32_t w32_api_shlwapi_n = sizeof w32_api_shlwapi / sizeof w32_api_shlwapi[0];
