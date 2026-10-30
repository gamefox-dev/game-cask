/*
 * Win32 platform profile — public interface used by the generated port driver
 * (tools/build/pipeline.mjs writes it). A Win32 port then consists of game.json + optional
 * overrides; this profile + the lifted modules do the rest.
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef W32_H
#define W32_H

#include <stdint.h>
#include "bgt.h"
#include "x86.h"

typedef struct {
    const char *name;        /* module file name as imported, e.g. "cards.dll" */
    const char *asset;       /* VFS asset path of the original image */
    uint32_t base;           /* load address (== the --base it was lifted at) */
    const x86_lifted_entry_t *lifted;
    uint32_t nlifted;
    int is_main;
} w32_module_cfg_t;

typedef struct {
    const w32_module_cfg_t *modules;
    uint32_t nmodules;
    const char *command_line; /* ANSI, without the program name */
    int32_t default_w, default_h;
    /* system DLLs the profile implements (platforms/win32/dlls.json; entries ending in '*' are prefixes) */
    const char *const *sys_dlls;
    uint32_t nsys_dlls;
} w32_config_t;

typedef struct {
    uint32_t api_calls, stub_calls, stubs_distinct;
    char stubs[24][40];
    uint32_t gdi_ops, gdi_approx_rop, gdi_unsupported, gdi_getpixel_noread, mono_color_blits;
    uint32_t gdi_pixel_reads, gdi_cpu_replays, gdi_replay_compactions;
    uint32_t messages, paints, timers_fired, yields, peek_yields;
    uint32_t targets_lost;
} w32_metrics_t;

int32_t w32_boot(const w32_config_t *cfg, bgt_io_t *io);
/* bgt_update: runs the guest; blocks (bgt_yield) inside the guest's message loop */
void w32_update(void);
/* bgt_render: flushes deferred GDI drawing and presents the desktop */
void w32_render(void);
/* JSON metrics for bgt_metrics (combines x86 and win32 counters) */
const char *w32_metrics_json(void);
uint32_t w32_state_hash(void);
/* short JSON for bgt_debug_state */
const char *w32_debug_json(void);

#endif
