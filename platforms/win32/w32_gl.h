/* SPDX-License-Identifier: MIT — LANE-GL */
#ifndef W32_GL_H
#define W32_GL_H
#include "w32_int.h"
extern const w32_api_t w32_api_gl[];
extern const uint32_t w32_api_gl_n;
extern uint64_t w32_gl_calls, w32_gl_draws, w32_gl_state_changes, w32_gl_pipelines, w32_gl_unimplemented;
int w32_gl_active(void);
const char *w32_gl_stubs_json(void);
#endif
