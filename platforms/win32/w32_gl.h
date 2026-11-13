/* SPDX-License-Identifier: MIT — LANE-GL */
#ifndef W32_GL_H
#define W32_GL_H
#include "w32_int.h"
extern const w32_api_t w32_api_gl[];
extern const uint32_t w32_api_gl_n;
extern uint64_t w32_gl_calls, w32_gl_draws, w32_gl_state_changes, w32_gl_pipelines, w32_gl_unimplemented, w32_gl_approximations;
extern uint64_t w32_gl_buffer_respec_reused, w32_gl_buffer_respec_resized, w32_gl_buffer_respec_grew, w32_gl_buffer_respec_shrank;
/* Compatibility debug metrics: live/peak are GL charged spans; reserved is cumulative
 * backing requested by GL. All free backing is now reusable by every consumer. */
#define w32_gl_frontend_bytes (x86_host_stats[XH_GL].used)
#define w32_gl_frontend_peak (x86_host_stats[XH_GL].peak)
#define w32_gl_frontend_reserved (x86_host_stats[XH_GL].backing_requested)
#define w32_gl_frontend_allocations (x86_host_stats[XH_GL].allocations)
#define w32_gl_frontend_frees (x86_host_stats[XH_GL].frees)
#define w32_gl_frontend_oom (x86_host_stats[XH_GL].oom)
int w32_gl_active(void);
const char *w32_gl_stubs_json(void);
const char *w32_gl_objects_json(void);
const char *w32_gl_approximations_json(void);
#endif
