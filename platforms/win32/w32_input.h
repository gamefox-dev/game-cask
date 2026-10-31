/* SPDX-License-Identifier: MIT */
#ifndef W32_INPUT_H
#define W32_INPUT_H
#include "w32_int.h"
void w32_input_pump(void);
uint32_t w32_input_vk(uint32_t hid);
void w32_input_post(uint32_t hwnd, uint32_t msg, uint32_t wp, uint32_t lp);
extern const w32_api_t w32_api_input[];
extern const uint32_t w32_api_input_n;
#endif
