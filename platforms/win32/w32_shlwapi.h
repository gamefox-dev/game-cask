/* LANE-K1 — SPDX-License-Identifier: MIT */
#ifndef W32_SHLWAPI_H
#define W32_SHLWAPI_H
#include "w32_int.h"
/* Shared namespace query. On success attrs receives Win32 FILE_ATTRIBUTE_*.
 * Integration: extend this implementation to K2's writable files/directories;
 * callers must not open files or infer existence from available handle slots. */
int w32_path_exists(const char *path, uint32_t *attrs);
extern const w32_api_t w32_api_shlwapi[];
extern const uint32_t w32_api_shlwapi_n;
#endif
