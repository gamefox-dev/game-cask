/* SPDX-License-Identifier: MIT */
#ifndef W32_AUDIO_H
#define W32_AUDIO_H
#include "w32_com.h"
uint32_t w32_audio_method(uint32_t kind, uint32_t slot, uint32_t *nargs);
void w32_audio_pump(void);
void w32_audio_destroy(uint32_t state);
extern const w32_api_t w32_api_audio[];
extern const uint32_t w32_api_audio_n;
#endif
